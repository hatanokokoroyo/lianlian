//! 五个工具的声明（#9 三个 + #10 的 `propose_findings` + #12 的 `generate_plan`）：
//! 名字、描述、JSON Schema。
//!
//! 描述是给模型看的提示词的一部分，改它等于改行为。工具集宁少不多：加一个工具
//! 要走 spec（`propose_findings` 在 #10，`generate_plan` 在 #12）。

use serde_json::{Value, json};

use crate::domain::plan::{MAX_EXERCISES, MAX_REVIEW_WEEKS, MAX_SETS};
use crate::domain::tool::{
    CORRECT_FINDING, GENERATE_PLAN, PROPOSE_FINDINGS, RECORD_FINDING, SEARCH_EVIDENCE,
};

/// 请求体里 `tools` 的值。
pub fn specs() -> Vec<Value> {
    vec![
        search_spec(),
        record_spec(),
        correct_spec(),
        propose_spec(),
        plan_spec(),
    ]
}

fn search_spec() -> Value {
    json!({
        "type": "function",
        "name": SEARCH_EVIDENCE,
        "description": "检索依据日志：这个部位以前是怎么判的、当时的原话与验证反馈。写档案之前必须先查这个部位。",
        "parameters": {
            "type": "object",
            "properties": {
                "site": { "type": "string", "description": "部位 id（词表里的 kebab-case，如 gluteus-medius）" },
                "axis": {
                    "type": "string",
                    "enum": ["tension", "symmetry", "mobility", "pain", "stability"],
                    "description": "只看测过这条轴的记录"
                },
                "from": { "type": "string", "description": "起始日期，YYYY-MM-DD（含）" },
                "to": { "type": "string", "description": "结束日期，YYYY-MM-DD（含当天）" },
                "contains": { "type": "string", "description": "关键词，只查四段原文" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 20, "description": "最多几条，默认 20，超过 20 也只给 20" }
            },
            "additionalProperties": false
        }
    })
}

fn record_spec() -> Value {
    json!({
        "type": "function",
        "name": RECORD_FINDING,
        "description": "在档案上写一条判定（只追加）。用户已经口头确认、置信度高时用；批量或低置信度走提议。写之前必须先 search_evidence 这个词部位。",
        "parameters": {
            "type": "object",
            "properties": {
                "site": { "type": "string", "description": "部位 id，必须在词表里" },
                "side": { "type": "string", "enum": ["left", "right"], "description": "左右成对的部位必填，中线结构不要带" },
                "confidence": { "type": "integer", "minimum": 0, "maximum": 100, "description": "0–100；低于 60 视为推测" },
                "values": {
                    "type": "object",
                    "description": "至少一条轴的取值",
                    "properties": {
                        "tension": { "type": "string", "enum": ["weak", "normal", "tight"] },
                        "symmetry": { "type": "string", "enum": ["left-weak", "right-weak", "symmetric"] },
                        "mobility": { "type": "string", "enum": ["limited", "normal"] },
                        "pain": { "type": "integer", "minimum": 0, "maximum": 10, "description": "0 表示无痛" },
                        "stability": { "type": "string", "enum": ["poor", "normal"] }
                    },
                    "additionalProperties": false,
                    "minProperties": 1
                },
                "evidence": evidence_schema()
            },
            "required": ["site", "confidence", "values", "evidence"],
            "additionalProperties": false
        }
    })
}

fn correct_spec() -> Value {
    json!({
        "type": "function",
        "name": CORRECT_FINDING,
        "description": "更正一条已有判定：resolve = 追加一条正常判定（已经好了），retract = 撤回（当时判错了，必须写理由）。写之前必须先 search_evidence 那个部位。",
        "parameters": {
            "type": "object",
            "properties": {
                "finding": { "type": "integer", "description": "要更正的判定编号（search_evidence 或档案里能查到）" },
                "action": { "type": "string", "enum": ["resolve", "retract"] },
                "reason": { "type": "string", "description": "retract 必填：错在哪一句话" },
                "evidence": evidence_schema()
            },
            "required": ["finding", "action", "evidence"],
            "additionalProperties": false
        }
    })
}

fn propose_spec() -> Value {
    json!({
        "type": "function",
        "name": PROPOSE_FINDINGS,
        "description": "一次想改多条，或把握不大时用：生成一张待审的卡（最多 8 项），用户逐项勾选、可以展开看依据。写进档案要等用户接受。",
        "parameters": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "要改的几项，1–8 项，每项和 record_finding 的参数一样",
                    "minItems": 1,
                    "maxItems": 8,
                    "items": {
                        "type": "object",
                        "properties": {
                            "site": { "type": "string", "description": "部位 id，必须在词表里" },
                            "side": { "type": "string", "enum": ["left", "right"] },
                            "confidence": { "type": "integer", "minimum": 0, "maximum": 100, "description": "低于 60 的项默认不勾" },
                            "values": {
                                "type": "object",
                                "properties": {
                                    "tension": { "type": "string", "enum": ["weak", "normal", "tight"] },
                                    "symmetry": { "type": "string", "enum": ["left-weak", "right-weak", "symmetric"] },
                                    "mobility": { "type": "string", "enum": ["limited", "normal"] },
                                    "pain": { "type": "integer", "minimum": 0, "maximum": 10 },
                                    "stability": { "type": "string", "enum": ["poor", "normal"] }
                                },
                                "additionalProperties": false,
                                "minProperties": 1
                            },
                            "evidence": evidence_schema()
                        },
                        "required": ["site", "confidence", "values", "evidence"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["items"],
            "additionalProperties": false
        }
    })
}

fn plan_spec() -> Value {
    json!({
        "type": "function",
        "name": GENERATE_PLAN,
        "description": "排出 / 调整训练计划：频次规则 + 动作清单（每个动作挂它对应的判定编号）+ 复查日（默认 4 周）。同一时刻只有一个生效计划，再调一次就是新版本，旧版本只读可查。训练条件不齐时会被拒绝——先追问补齐，不要编。",
        "parameters": {
            "type": "object",
            "properties": {
                "frequency": {
                    "type": "object",
                    "description": "频次规则：unit = per-week 时 count 是每周几次（1–7）；unit = every-n-days 时 count 是每几天一次（2–7）。",
                    "properties": {
                        "unit": { "type": "string", "enum": ["per-week", "every-n-days"] },
                        "count": { "type": "integer", "minimum": 1, "maximum": 7 }
                    },
                    "required": ["unit", "count"],
                    "additionalProperties": false
                },
                "exercises": {
                    "type": "array",
                    "description": "动作清单，1–12 个。每个动作都要挂一条已有的判定（它的理由）。",
                    "minItems": 1,
                    "maxItems": MAX_EXERCISES,
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "动作名（中文），如「臀桥」" },
                            "sets": { "type": "integer", "minimum": 1, "maximum": MAX_SETS, "description": "组数" },
                            "reps": { "type": "integer", "minimum": 1, "maximum": 999, "description": "每组多少次或多少秒" },
                            "unit": { "type": "string", "enum": ["times", "seconds"], "description": "reps 是次数还是秒数，默认 times" },
                            "finding": { "type": "integer", "description": "这个动作对应的判定编号（search_evidence 里能查到）" }
                        },
                        "required": ["name", "sets", "reps", "finding"],
                        "additionalProperties": false
                    }
                },
                "review_in_weeks": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_REVIEW_WEEKS,
                    "description": "复查日放在几周后，默认 4 周"
                }
            },
            "required": ["frequency", "exercises"],
            "additionalProperties": false
        }
    })
}

/// 四段依据的 Schema：写判定时必填，缺一段工具层会拒绝。
fn evidence_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "user_said": { "type": "string", "description": "用户说法要点：他自己的原话要点" },
            "test_and_feedback": { "type": "string", "description": "验证方案与反馈：让他做了什么、看到什么现象" },
            "reasoning": { "type": "string", "description": "推理：这两段怎么推出这条判定" },
            "uncertainty": { "type": "string", "description": "不确定之处：还没排除什么；没提到的段写「未涉及」" }
        },
        "required": ["user_said", "test_and_feedback", "reasoning", "uncertainty"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_are_exactly_five_tools_and_their_names_match_the_domain() {
        let names: Vec<String> = specs()
            .iter()
            .map(|spec| spec["name"].as_str().expect("有名字").to_owned())
            .collect();
        // 字面量而不是常量自比：模型看到的名字变了，这条测试才该红。
        assert_eq!(
            names,
            vec![
                "search_evidence",
                "record_finding",
                "correct_finding",
                "propose_findings",
                "generate_plan"
            ]
        );
    }

    #[test]
    fn function_fields_sit_at_the_top_level_of_the_tool_object() {
        // Responses 格式：name / parameters 在工具对象顶层，不是 OpenAI chat 的嵌套
        // `function` 里（DeepSeek 文档明写这一点）。
        for spec in specs() {
            assert_eq!(spec["type"], "function");
            assert!(spec.get("function").is_none(), "别套 function 一层");
            assert!(spec["parameters"]["type"] == "object");
        }
    }

    #[test]
    fn the_plan_tool_asks_for_the_frequency_the_exercises_and_their_findings() {
        let plan = specs()
            .into_iter()
            .find(|spec| spec["name"] == "generate_plan")
            .expect("有 generate_plan");
        let properties = &plan["parameters"]["properties"];
        assert_eq!(properties["frequency"]["required"], json!(["unit", "count"]));
        let exercise = &properties["exercises"]["items"];
        assert_eq!(
            exercise["required"],
            json!(["name", "sets", "reps", "finding"])
        );
        assert_eq!(properties["exercises"]["maxItems"], MAX_EXERCISES);
        assert_eq!(
            properties["review_in_weeks"]["maximum"],
            MAX_REVIEW_WEEKS
        );
    }

    #[test]
    fn the_search_tool_advertises_the_hard_limit() {
        let search = &specs()[0];
        assert_eq!(search["parameters"]["properties"]["limit"]["maximum"], 20);
        assert_eq!(
            search["parameters"]["properties"]["axis"]["enum"]
                .as_array()
                .expect("枚举")
                .len(),
            5
        );
    }

    #[test]
    fn writing_tools_require_all_four_evidence_sections() {
        // 除了 search_evidence，其余三个都要四段；`propose_findings` 的四段在每一项里。
        let evidence_of = |spec: &Value| {
            if spec["name"] == "propose_findings" {
                spec["parameters"]["properties"]["items"]["items"]["properties"]["evidence"].clone()
            } else {
                spec["parameters"]["properties"]["evidence"].clone()
            }
        };
        for spec in specs()
            .iter()
            .filter(|spec| spec["name"] != "search_evidence" && spec["name"] != "generate_plan")
        {
            let evidence = evidence_of(spec);
            let required: Vec<&str> = evidence["required"]
                .as_array()
                .expect("必填四段")
                .iter()
                .map(|name| name.as_str().expect("段名"))
                .collect();
            assert_eq!(
                required,
                vec!["user_said", "test_and_feedback", "reasoning", "uncertainty"]
            );
        }
    }
}
