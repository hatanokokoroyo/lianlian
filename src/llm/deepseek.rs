//! DeepSeek 的模型网关（OpenAI Responses 格式，无状态、多轮自拼）。
//!
//! ADR-0001：key 在设备上直连 `api.deepseek.com`。换后端只换这个文件里的
//! 实现，上层（`api::Conversations`）不认 HTTP。
//!
//! 失败按「出路」分类，而不是按状态码堆文案（design/contract.md §8）：
//! 可重试（断网 / 超时 / 429 / 5xx）、配置问题（key 无效、无额度）、请求问题
//! （超长等，需要裁剪后重发）。

use serde_json::{Value, json};

use super::prompt::Input;

/// Responses 端点。DeepSeek 的 base_url 没有 `/v1`。
pub const ENDPOINT: &str = "https://api.deepseek.com/responses";
/// 目前接 Responses API 的模型；换模型只改这里。
pub const MODEL: &str = "deepseek-flash";

/// 一次调用的失败，按用户能做什么分类。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayError {
    /// 断网、超时、429、5xx：原地重试就好。
    Retryable(String),
    /// key 无效 / 无额度 / 没填：只能去设置。
    Config(String),
    /// 输入超过上下文上限：裁掉最旧的历史再发一次。
    TooLong(String),
    /// 请求本身有问题（参数、格式），重试没用。
    Request(String),
}

impl GatewayError {
    /// 给界面分类用的键：`retryable` / `config` / `request`。
    pub fn kind(&self) -> &'static str {
        match self {
            GatewayError::Retryable(_) => "retryable",
            GatewayError::Config(_) => "config",
            GatewayError::TooLong(_) | GatewayError::Request(_) => "request",
        }
    }

    /// 能不能原地重试。
    pub fn can_retry(&self) -> bool {
        matches!(self, GatewayError::Retryable(_) | GatewayError::TooLong(_))
    }

    /// 给用户看的一句话。
    pub fn message(&self) -> &str {
        match self {
            GatewayError::Retryable(message)
            | GatewayError::Config(message)
            | GatewayError::TooLong(message)
            | GatewayError::Request(message) => message,
        }
    }
}

/// 请求体：模型 + 工具 + 输入 item 列表。
///
/// `reasoning.effort = "none"`：关闭思考模式，否则短回复会被思维链吃掉预算。
/// `tools` 每次都在：同一份状态装配两次要逐字节一致，工具列表也得是确定的。
pub fn request_body(items: &[Input]) -> Value {
    json!({
        "model": MODEL,
        "reasoning": { "effort": "none" },
        "input": items,
        "tools": super::tools::specs(),
        "tool_choice": "auto",
    })
}

/// 模型这次输出的一项。
#[derive(Debug, Clone, PartialEq)]
pub enum OutputItem {
    /// 可见正文。
    Message(String),
    /// 要求调用工具（`arguments` 是模型给的 JSON **字符串**，可能是坏的）。
    FunctionCall {
        call_id: String,
        name: String,
        arguments: String,
    },
    /// 认不出来的项（思考模式下的 reasoning 等）：原样留着，重放时照发。
    Raw(Value),
}

/// 把响应正文解析成输出项列表。
///
/// 关掉思考模式之后正常只会看到 `message` 与 `function_call`；别的类型一律进
/// `Raw`，不猜它的含义，也不丢——丢了会让下一轮的前缀对不上。
pub fn parse_output_items(status: u16, body: &str) -> Result<Vec<OutputItem>, GatewayError> {
    if !(200..=299).contains(&status) {
        return Err(classify(status, body));
    }
    let parsed: Value = serde_json::from_str(body)
        .map_err(|error| GatewayError::Request(format!("模型返回的不是合法 JSON：{error}")))?;

    let output = parsed
        .get("output")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut items = Vec::with_capacity(output.len());
    for item in output {
        match item.get("type").and_then(Value::as_str) {
            Some("message") => {
                let text = item
                    .get("content")
                    .and_then(Value::as_array)
                    .map(|parts| {
                        parts
                            .iter()
                            .filter(|part| {
                                part.get("type").and_then(Value::as_str) == Some("output_text")
                            })
                            .filter_map(|part| part.get("text").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .unwrap_or_default();
                if !text.is_empty() {
                    items.push(OutputItem::Message(text));
                }
            }
            Some("function_call") => {
                let field = |name: &str| {
                    item.get(name)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned()
                };
                let (call_id, name) = (field("call_id"), field("name"));
                if call_id.is_empty() || name.is_empty() {
                    return Err(GatewayError::Request(
                        "模型返回了一个缺 call_id 或 name 的 function_call。".to_owned(),
                    ));
                }
                items.push(OutputItem::FunctionCall {
                    call_id,
                    name,
                    arguments: field("arguments"),
                });
            }
            _ => items.push(OutputItem::Raw(item)),
        }
    }

    if items.is_empty() {
        let status = parsed
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let reason = parsed
            .get("incomplete_details")
            .and_then(|details| details.get("reason"))
            .and_then(Value::as_str)
            .unwrap_or("没有可见输出");
        return Err(GatewayError::Request(format!(
            "模型没有给出正文（{status}：{reason}）。"
        )));
    }
    Ok(items)
}

/// 解析成一段正文：只有消息时用它（`parse_output_items` 的薄包装）。
pub fn parse_response(status: u16, body: &str) -> Result<String, GatewayError> {
    let items = parse_output_items(status, body)?;
    Ok(items
        .into_iter()
        .filter_map(|item| match item {
            OutputItem::Message(text) => Some(text),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(""))
}

/// 状态码 → 出路。
pub fn classify(status: u16, body: &str) -> GatewayError {
    let detail = error_message(body);
    match status {
        401 | 403 => GatewayError::Config(format!(
            "DeepSeek 拒绝了这把 key（{status}）。去设置里换一把。{detail}"
        )),
        402 => GatewayError::Config(format!(
            "DeepSeek 账户没有可用额度（{status}）。充值或换 key 后再试。{detail}"
        )),
        408 | 409 | 429 => GatewayError::Retryable(format!(
            "请求被限流或超时（{status}），等一下再试。{detail}"
        )),
        500..=599 => GatewayError::Retryable(format!(
            "DeepSeek 服务出错（{status}），等一下再试。{detail}"
        )),
        400 | 422 if looks_too_long(body) => GatewayError::TooLong(format!(
            "这一轮连同历史超过了模型上下文上限（{status}）。已自动裁剪最旧的历史重发。{detail}"
        )),
        400 | 422 => GatewayError::Request(format!(
            "请求被拒绝（{status}），重试同样的内容没用。{detail}"
        )),
        _ => GatewayError::Request(format!("模型返回了未预期的状态 {status}。{detail}")),
    }
}

/// 超长请求的识别：不同网关的措辞不一样，认几个关键词。
pub fn looks_too_long(body: &str) -> bool {
    let body = body.to_lowercase();
    (body.contains("context") && (body.contains("length") || body.contains("window")))
        || body.contains("too long")
        || body.contains("too many tokens")
        || body.contains("maximum context")
        || body.contains("exceed")
}

/// 从错误正文里抠一句 `error.message`；抠不到就给个截断的原文。
fn error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|parsed| {
            parsed
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    parsed
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
        })
        .unwrap_or_else(|| body.chars().take(160).collect())
}

/// 真发一次请求，拿到这一轮输出项；测试不联网，走 `parse_output_items` 与装配的纯函数测试。
pub async fn send_turn(key: &str, items: &[Input]) -> Result<Vec<OutputItem>, GatewayError> {
    use nsh_core::prelude::HttpRequest;

    let body = request_body(items).to_string();
    let request = HttpRequest::post(ENDPOINT, body)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json");
    let response = nsh_core::prelude::fetch(request)
        .await
        .map_err(|message| GatewayError::Retryable(format!("网络请求失败：{message}")))?;
    parse_output_items(response.status(), &response.text())
}

/// 只要正文的那一次请求（没有工具往返时用它）。
pub async fn send(key: &str, items: &[Input]) -> Result<String, GatewayError> {
    Ok(send_turn(key, items)
        .await?
        .into_iter()
        .filter_map(|item| match item {
            OutputItem::Message(text) => Some(text),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body_with(text: &str) -> String {
        json!({
            "id": "resp_1",
            "object": "response",
            "status": "completed",
            "output": [{
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": text }]
            }]
        })
        .to_string()
    }

    #[test]
    fn a_completed_response_gives_its_output_text() {
        let text = parse_response(200, &body_with("先做踝背屈测试。")).expect("有正文");
        assert_eq!(text, "先做踝背屈测试。");
    }

    #[test]
    fn a_truncated_response_is_a_request_problem_not_a_retry() {
        let body = json!({
            "status": "incomplete",
            "incomplete_details": { "reason": "max_output_tokens" },
            "output": []
        })
        .to_string();
        let error = parse_response(200, &body).unwrap_err();
        assert_eq!(error.kind(), "request");
        assert!(!error.can_retry());
        assert!(error.message().contains("max_output_tokens"));
    }

    #[test]
    fn statuses_map_to_the_three_ways_out() {
        assert_eq!(classify(401, "{}").kind(), "config");
        assert_eq!(classify(402, "{}").kind(), "config");
        assert_eq!(classify(429, "{}").kind(), "retryable");
        assert_eq!(classify(503, "{}").kind(), "retryable");
        assert_eq!(
            classify(400, r#"{"error":{"message":"bad"}}"#).kind(),
            "request"
        );
        assert_eq!(classify(400, "{}").kind(), "request");
    }

    #[test]
    fn a_too_long_request_is_told_apart_from_other_bad_requests() {
        let too_long =
            r#"{"error":{"message":"This model's maximum context length is 1000000 tokens"}}"#;
        assert!(looks_too_long(too_long));
        assert_eq!(classify(400, too_long).kind(), "request");
        assert!(matches!(classify(400, too_long), GatewayError::TooLong(_)));
        assert!(!looks_too_long(r#"{"error":{"message":"invalid role"}}"#));
    }

    #[test]
    fn error_bodies_keep_their_message() {
        let body = r#"{"error":{"message":"Authentication Fails"}}"#;
        let error = classify(401, body);
        assert!(error.message().contains("Authentication Fails"));
        assert_eq!(error_message(r#"{"message":"plain"}"#), "plain".to_owned());
    }

    #[test]
    fn the_request_body_carries_the_input_tools_and_nothing_else() {
        let items = vec![Input::system("s"), Input::user("u")];
        let body = request_body(&items);
        assert_eq!(body["model"], MODEL);
        assert_eq!(body["input"].as_array().expect("数组").len(), 2);
        assert_eq!(body["reasoning"]["effort"], "none");
        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(body["tools"].as_array().expect("工具").len(), 5);
        assert_eq!(body["input"][0]["role"], "system");
    }

    #[test]
    fn a_function_call_item_is_kept_with_its_raw_arguments() {
        let body = json!({
            "status": "completed",
            "output": [
                {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_abc",
                    "name": "search_evidence",
                    "arguments": "{\"site\":\"soleus\"}",
                    "status": "completed"
                }
            ]
        })
        .to_string();
        let items = parse_output_items(200, &body).expect("解析");
        assert_eq!(
            items,
            vec![OutputItem::FunctionCall {
                call_id: "call_abc".to_owned(),
                name: "search_evidence".to_owned(),
                // 原文字符串：解析后再序列化会打乱前缀。
                arguments: "{\"site\":\"soleus\"}".to_owned(),
            }]
        );
        // 只有工具调用、没有正文也是合法的一轮。
        assert_eq!(parse_response(200, &body).expect("解析"), "");
    }

    #[test]
    fn unknown_output_items_are_kept_not_dropped() {
        let body = json!({
            "status": "completed",
            "output": [
                { "type": "reasoning", "summary": [] },
                { "type": "message", "content": [{ "type": "output_text", "text": "好" }] }
            ]
        })
        .to_string();
        let items = parse_output_items(200, &body).expect("解析");
        assert_eq!(items.len(), 2);
        assert!(matches!(items[0], OutputItem::Raw(_)));
        assert_eq!(items[1], OutputItem::Message("好".to_owned()));
    }
}
