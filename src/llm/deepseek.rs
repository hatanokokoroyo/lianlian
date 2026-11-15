//! DeepSeek 的模型网关（OpenAI Responses 格式，无状态、多轮自拼）。
//!
//! ADR-0001：key 在设备上直连 `api.deepseek.com`。换后端只换这个文件里的
//! 实现，上层（`api::Conversations`）不认 HTTP。
//!
//! 失败按「出路」分类，而不是按状态码堆文案（design/contract.md §8）：
//! 可重试（断网 / 超时 / 429 / 5xx）、配置问题（key 无效、无额度）、请求问题
//! （超长等，需要裁剪后重发）。

use serde_json::{json, Value};

use super::prompt::Item;

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

/// 请求体：模型 + 输入 item 列表。
///
/// `reasoning.effort = "none"`：关闭思考模式，否则短回复会被思维链吃掉预算。
pub fn request_body(items: &[Item]) -> Value {
    json!({
        "model": MODEL,
        "reasoning": { "effort": "none" },
        "input": items,
    })
}

/// 把响应正文解析成回复文本。
pub fn parse_response(status: u16, body: &str) -> Result<String, GatewayError> {
    if !(200..=299).contains(&status) {
        return Err(classify(status, body));
    }
    let parsed: Value = serde_json::from_str(body).map_err(|error| {
        GatewayError::Request(format!("模型返回的不是合法 JSON：{error}"))
    })?;

    let text = output_text(&parsed);
    if !text.is_empty() {
        return Ok(text);
    }
    // 200 但没有可见输出：截断或被内容安全挡下，都算请求问题（重试同一请求没用）。
    let status = parsed
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let reason = parsed
        .get("incomplete_details")
        .and_then(|details| details.get("reason"))
        .and_then(Value::as_str)
        .unwrap_or("没有可见输出");
    Err(GatewayError::Request(format!(
        "模型没有给出正文（{status}：{reason}）。"
    )))
}

/// 从响应里取 `output[].content[].text`（只取 `output_text`）。
pub fn output_text(parsed: &Value) -> String {
    parsed
        .get("output")
        .and_then(Value::as_array)
        .map(|output| {
            output
                .iter()
                .flat_map(|item| {
                    item.get("content")
                        .and_then(Value::as_array)
                        .map(Vec::as_slice)
                        .unwrap_or_default()
                })
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("output_text"))
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
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

/// 真发一次请求；测试不联网，走 `parse_response` 与装配的纯函数测试。
pub async fn send(key: &str, items: &[Item]) -> Result<String, GatewayError> {
    use nsh_core::prelude::HttpRequest;

    let body = request_body(items).to_string();
    let request = HttpRequest::post(ENDPOINT, body)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json");
    let response = nsh_core::prelude::fetch(request)
        .await
        .map_err(|message| GatewayError::Retryable(format!("网络请求失败：{message}")))?;
    parse_response(response.status(), &response.text())
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
        assert_eq!(classify(400, r#"{"error":{"message":"bad"}}"#).kind(), "request");
        assert_eq!(classify(400, "{}").kind(), "request");
    }

    #[test]
    fn a_too_long_request_is_told_apart_from_other_bad_requests() {
        let too_long = r#"{"error":{"message":"This model's maximum context length is 1000000 tokens"}}"#;
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
        assert_eq!(
            error_message(r#"{"message":"plain"}"#),
            "plain".to_owned()
        );
    }

    #[test]
    fn the_request_body_is_the_input_list_and_nothing_else() {
        let items = vec![Item::system("s"), Item::user("u")];
        let body = request_body(&items);
        assert_eq!(body["model"], MODEL);
        assert_eq!(body["input"].as_array().expect("数组").len(), 2);
        assert_eq!(body["reasoning"]["effort"], "none");
    }
}
