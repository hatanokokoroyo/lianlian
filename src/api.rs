//! TSX 的入口：这里用到的类型会被 nsh 生成成 `native.d.ts` 里的声明，
//! 所以数据形状在这里定，界面只消费它。
//!
//! 写法约定：读用 `async fn`（要在任务里拿 app 私有目录），写回的失败用
//! `Option<String>` 表达——`None` 是成功，`Some(文案)` 是失败原因，界面直接显示。

use nsh_core::prelude::*;

use crate::domain::DomainError;
use crate::domain::basics::{AGE_RANGE, Basics, Sex};
use crate::domain::measurement::{
    HEIGHT_CM_RANGE, MeasurementDraft, MeasurementKind, WEIGHT_KG_RANGE,
};
use crate::domain::training::{
    DAYS_PER_WEEK_RANGE, MINUTES_RANGE, Place, Readiness, TrainingContext,
};
use crate::domain::photo::{MAX_DIMENSION, PER_MESSAGE};
use crate::domain::{Photo, PhotoId};
use crate::llm::agent::{self, DeepSeekModel, StoreHost};
use crate::photos;
use crate::llm::deepseek::GatewayError;
use crate::llm::prompt::{Snapshot, assemble, assemble_with_turns, turns};
use crate::store::Store;
use crate::store::settings::{API_KEY, TOOL_ROUNDS};

/// 基本属性。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct BasicsView {
    /// `female` / `male`；`null` 是「不填」。
    pub sex: Option<String>,
    /// 年龄。
    pub age: Option<f64>,
    /// 身高，厘米：最新一条身高测量，不是可编辑的字段。
    pub height_cm: Option<f64>,
    /// 体重，千克：最新一条体重测量，不是可编辑的字段。
    pub weight_kg: Option<f64>,
    /// 基础疾病或旧伤，自由文本的清单。
    pub conditions: Vec<String>,
}

/// 训练条件。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct TrainingView {
    /// 每周能练几天。
    pub days_per_week: Option<f64>,
    /// 每次多久，分钟。
    pub minutes_per_session: Option<f64>,
    /// 在哪练：`home` / `gym` / `office` / `outdoor`。
    pub places: Vec<String>,
    /// 手边有什么：自由文本；`nothing` 表示「什么都没有」。
    pub equipment: Vec<String>,
}

/// 训练条件齐不齐。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ReadinessView {
    /// 四项都填了。
    pub ready: bool,
    /// 缺的项：`days-per-week` / `minutes-per-session` / `places` / `equipment`。
    pub missing: Vec<String>,
    /// 缺的项的中文名，直接进提示文案。
    pub missing_zh: Vec<String>,
}

/// 冷启动要读的全部状态。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ProfileView {
    /// 引导是否走完（没走完就显示引导，而不是空白页）。
    pub onboarded: bool,
    pub basics: BasicsView,
    pub training: TrainingView,
    pub readiness: ReadinessView,
    /// 本地库打不开时的原因；有值时界面应当提示而不是装作空档案。
    pub error: Option<String>,
}

/// 一条测量在界面上的样子。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct MeasurementView {
    /// 编号：删除时用它。
    pub id: f64,
    /// `height` / `weight`。
    pub kind: String,
    /// 数值，单位见同一序列的 `unit`。
    pub value: f64,
    /// Unix 毫秒；界面按本地时区显示日期。
    pub at: f64,
}

/// 一种测量（身高或体重）的序列。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SeriesView {
    /// `height` / `weight`。
    pub kind: String,
    /// 显示名：身高 / 体重。
    pub label: String,
    /// 单位：cm / kg。
    pub unit: String,
    /// 最新一条的值；没有测量时是 `null`。
    pub current: Option<f64>,
    /// 最新与最早的差；少于两条时是 `null`（看不出变化不等于没变化）。
    pub change: Option<f64>,
    /// 按时间升序，折线图从左到右画它。
    pub points: Vec<MeasurementView>,
}

/// 测量页要读的全部状态。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct MeasurementsView {
    pub weight: SeriesView,
    pub height: SeriesView,
    /// 读库失败的原因；有值时界面要提示而不是装作没有测量。
    pub error: Option<String>,
}

/// 测量的读写：追加一条、删掉一条、读两种序列。
#[module]
pub struct Measurements;

#[module]
impl Measurements {
    /// 读身高与体重的完整序列。
    pub async fn load() -> MeasurementsView {
        match Store::open_app() {
            Ok(store) => measurements_view(&store, None),
            Err(error) => empty_measurements_view(Some(error.to_string())),
        }
    }

    /// 显式记一条测量；返回失败原因，成功是 `null`。
    ///
    /// 与保存基本属性不同，这里即使数值和上一条相同也照样追加——用户是
    /// 主动「记一次」，不是改一个字段。
    pub async fn record(kind: String, value: f64) -> Option<String> {
        let Some(kind) = MeasurementKind::from_key(&kind) else {
            return Some(format!("不认识的测量种类：{kind}"));
        };
        let draft = MeasurementDraft {
            kind,
            value,
            at: nsh_core::time::unix_ms() as i64,
        };
        save(&Store::open_app(), |store| {
            store.record_measurement(draft.clone()).map(|_| ())
        })
    }

    /// 删掉一条测量；返回失败原因，成功是 `null`。
    pub async fn delete(id: f64) -> Option<String> {
        if !id.is_finite() || id < 0.0 {
            return Some(format!("测量编号不合法：{id}"));
        }
        save(&Store::open_app(), |store| {
            store.delete_measurement(crate::domain::measurement::MeasurementId(id as u64))
        })
    }
}

fn measurements_view(store: &Store, error: Option<String>) -> MeasurementsView {
    let mut errors: Vec<String> = error.into_iter().collect();
    MeasurementsView {
        weight: series_view(store, MeasurementKind::Weight, &mut errors),
        height: series_view(store, MeasurementKind::Height, &mut errors),
        // 读库失败要显示出来，不能装作「还没有测量」。
        error: join_errors(errors),
    }
}

fn series_view(store: &Store, kind: MeasurementKind, errors: &mut Vec<String>) -> SeriesView {
    let measurements = match store.measurements(kind) {
        Ok(measurements) => measurements,
        Err(error) => {
            errors.push(error.to_string());
            Vec::new()
        }
    };
    let trend = crate::domain::trend(measurements.clone());
    SeriesView {
        kind: kind.key().to_owned(),
        label: kind.zh().to_owned(),
        unit: kind.unit().to_owned(),
        current: trend.latest,
        change: trend.change,
        points: measurements
            .iter()
            .map(|measurement| MeasurementView {
                id: measurement.id.0 as f64,
                kind: kind.key().to_owned(),
                value: measurement.value,
                at: measurement.at as f64,
            })
            .collect(),
    }
}

fn join_errors(errors: Vec<String>) -> Option<String> {
    if errors.is_empty() {
        None
    } else {
        Some(errors.join("；"))
    }
}

fn empty_measurements_view(error: Option<String>) -> MeasurementsView {
    let empty = |kind: MeasurementKind| SeriesView {
        kind: kind.key().to_owned(),
        label: kind.zh().to_owned(),
        unit: kind.unit().to_owned(),
        current: None,
        change: None,
        points: Vec::new(),
    };
    MeasurementsView {
        weight: empty(MeasurementKind::Weight),
        height: empty(MeasurementKind::Height),
        error,
    }
}

/// 会话列表里的一行。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ConversationView {
    pub id: f64,
    /// 第一条用户消息派生的标题；还没说话时是「新会话」。
    pub title: String,
    /// 最后一次活动，Unix 毫秒。
    pub updated_at: f64,
    pub archived: bool,
    /// 最后一条消息的摘要（最多 40 字）。
    pub preview: String,
    /// 消息条数。
    pub message_count: f64,
}

/// 一条消息。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct MessageView {
    pub id: f64,
    /// `user` / `assistant`。
    pub role: String,
    pub text: String,
    /// 这条消息带的照片编号（`#8`：最多一张，界面用 `Photos.data` 取图）。
    pub photos: Vec<f64>,
    /// Unix 毫秒。
    pub at: f64,
}

/// 会话列表：未归档与已归档分开，界面把归档的折叠起来。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ConversationListView {
    pub active: Vec<ConversationView>,
    pub archived: Vec<ConversationView>,
    pub error: Option<String>,
}

/// 一个会话的正文。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ConversationDetailView {
    pub id: f64,
    pub title: String,
    /// 按时间升序；界面从下往上读。
    pub messages: Vec<MessageView>,
    /// 这个会话的说明（裁剪过历史 / 撞上工具轮次上限）；没有就是 `null`。
    pub notice: Option<String>,
    /// 等用户审的那张提议卡；没有就是 `null`。
    pub pending_proposal: Option<ProposalView>,
    /// 已应用的提议（可撤销）。
    pub accepted_proposals: Vec<ProposalView>,
    pub error: Option<String>,
}

/// 依据日志的一段。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct EvidenceSectionView {
    pub name: String,
    pub text: String,
}

/// 提议卡里的一项（界面照着它渲染一行）。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ProposalItemView {
    /// 第几项（0 起）；接受、拒绝时用它。
    pub index: f64,
    /// 部位 id。
    pub site: String,
    /// 部位中文名。
    pub site_zh: String,
    /// 侧别（`left` / `right`），中线结构是 `null`。
    pub side: Option<String>,
    /// 侧别中文（左 / 右）。
    pub side_zh: Option<String>,
    /// 五轴取值的可读串（「张力 弱；活动度 受限」）。
    pub values: String,
    /// 置信度 0–100。
    pub confidence: f64,
    /// 低于阈值：标题旁标「低置信度」。
    pub low_confidence: bool,
    /// 默认勾选吗。
    pub selected_by_default: bool,
    /// `pending` / `accepted` / `rejected`。
    pub state: String,
    /// 四段依据（可展开）。
    pub evidence: Vec<EvidenceSectionView>,
}

/// 一张提议卡。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ProposalView {
    pub id: f64,
    pub at: f64,
    /// `pending` / `accepted` / `dismissed`。
    pub status: String,
    pub items: Vec<ProposalItemView>,
}

/// 一轮对话的失败，按「出路」分类（ADR-0001：错误处理自己来）。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ChatErrorView {
    /// `retryable`（断网/超时/429）/ `config`（key 无效或无额度）/ `request`（请求本身有问题）。
    pub kind: String,
    /// 给用户看的一句话。
    pub message: String,
    /// 还能原地重试吗；`config` 只能去设置。
    pub can_retry: bool,
}

/// 发一条消息的结果：落库之后的全部消息。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SendResultView {
    pub messages: Vec<MessageView>,
    /// 有值时这一轮没有落库（用户那句话仍在输入框里，不丢）。
    pub error: Option<ChatErrorView>,
}

/// 会话与消息：新建、续聊、归档、删除。
#[module]
pub struct Conversations;

#[module]
impl Conversations {
    /// 读列表（未归档 + 已归档）。
    pub async fn list() -> ConversationListView {
        match Store::open_app() {
            Ok(store) => conversation_list_view(&store, None),
            Err(error) => ConversationListView {
                active: Vec::new(),
                archived: Vec::new(),
                error: Some(error.to_string()),
            },
        }
    }

    /// 新开一个会话，返回它的编号。
    pub async fn create() -> f64 {
        match Store::open_app() {
            Ok(store) => store
                .create_conversation(now_ms())
                .map(|conversation| conversation.id.0 as f64)
                .unwrap_or(0.0),
            Err(_) => 0.0,
        }
    }

    /// 打开一个会话（含全部消息）。
    pub async fn open(id: f64) -> ConversationDetailView {
        match Store::open_app() {
            Ok(store) => conversation_detail_view(&store, id, None),
            Err(error) => empty_detail_view(id, Some(error.to_string())),
        }
    }

    /// 发一条消息：装配 → 工具循环 → 成功才把这一轮整个落库。
    ///
    /// 失败时什么都不写：用户打了一半的字在界面里，重试只会重发这一轮，不会
    /// 在时间线上留下半条对话。三类失败各有出路（见 `ChatErrorView`）。
    pub async fn send(id: f64, text: String, photo: Option<f64>) -> SendResultView {
        let store = match Store::open_app() {
            Ok(store) => store,
            Err(error) => return failure(GatewayError::Config(error.to_string())),
        };
        let conversation = crate::domain::ConversationId(id as u64);

        // 会话必须存在；消息不能是空白（同一条规则在领域层再校验一次）。
        if store.conversation(conversation).ok().flatten().is_none() {
            return failure(GatewayError::Request(format!("找不到编号 {id} 的会话。")));
        }
        // 这一轮要发出去的照片：必须存在、且属于这个会话。
        let attached = match photo {
            Some(raw) => match attached_photo(&store, &photos::photos_dir(), conversation, raw) {
                Ok(photo) => Some(photo),
                Err(message) => return failure(GatewayError::Request(message)),
            },
            None => None,
        };
        let user_item = match &attached {
            Some(photo) => crate::domain::StoredItem::user_with_photo(&text, photo.0.id),
            None => crate::domain::StoredItem::user(&text),
        };
        let user_item = match user_item {
            Ok(item) => item,
            Err(error) => return failure(GatewayError::Request(error.to_string())),
        };

        // key 缺失是配置问题，连请求都不发。
        let key = store.setting(API_KEY).ok().flatten().unwrap_or_default();
        if key.trim().is_empty() {
            return failure(GatewayError::Config(
                "还没填 DeepSeek 的 API key。去设置里填一把，它只存在这台设备上。".to_owned(),
            ));
        }

        let history = store.items(conversation).unwrap_or_default();
        let snapshot = snapshot(&store, conversation);
        let at = now_ms();
        let rounds = store
            .setting(TOOL_ROUNDS)
            .ok()
            .flatten()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(agent::DEFAULT_MAX_ROUNDS);
        let model = DeepSeekModel { key };

        let photo_data_url = attached
            .as_ref()
            .map(|(_, url)| url.clone());
        let assembly = assemble(&snapshot, &history, &text, photo_data_url.as_deref());
        let mut host = StoreHost::new(&store, conversation, at);
        // 这一轮要挂在会话上的说明（裁剪过历史 / 撞上工具轮次上限）。
        let mut notice: Option<String> = None;
        let outcome = match agent::run_turn(&model, &mut host, assembly.items.clone(), rounds).await
        {
            Ok(outcome) => outcome,
            // 超长：丢掉最旧的几轮重发一次。只有在这一轮还没往档案里写过东西时
            // 才重发——写过了再重发会把同一条判定写两遍。
            Err(GatewayError::TooLong(_)) if !host.wrote() => {
                let total = turns(&history);
                if total == 0 {
                    return failure(GatewayError::TooLong(
                        "这一轮本身就超过了模型上下文上限，先删短一点再发。".to_owned(),
                    ));
                }
                let keep = total / 2;
                let trimmed =
                    assemble_with_turns(&snapshot, &history, &text, keep, photo_data_url.as_deref());
                let mut retry_host = StoreHost::new(&store, conversation, at);
                match agent::run_turn(&model, &mut retry_host, trimmed.items, rounds).await {
                    Ok(outcome) => {
                        notice = Some(if keep == 0 {
                            "会话太长了，这次没带历史；建议新开一个会话。".to_owned()
                        } else {
                            format!("会话太长了，这次只带了最近 {keep} 轮对话；建议新开一个会话。")
                        });
                        outcome
                    }
                    Err(error) => return failure(error),
                }
            }
            Err(GatewayError::TooLong(_)) => return failure(GatewayError::Request(
                "这一轮太长，跑到一半就超了上下文；已经写进档案的判定保留，建议新开会话接着说。"
                    .to_owned(),
            )),
            Err(error) => return failure(error),
        };

        // 撞上工具轮次上限也要说清楚，别让用户以为对话正常收尾了；正常收尾就把
        // 上一轮留下的说明清掉（那句话说的是上一轮，不是这一轮）。
        let notice = outcome.notice.clone().or(notice);
        let _ = store.set_conversation_notice(conversation, notice.as_deref());

        // 整轮一次落库：用户那句（可能带照片）、工具往返、回复。中途失败一条都不写。
        let mut items = vec![user_item];
        items.extend(outcome.items);
        match store.append_turn(conversation, items, at) {
            Ok(_) => SendResultView {
                messages: store
                    .messages(conversation)
                    .unwrap_or_default()
                    .iter()
                    .map(message_view)
                    .collect(),
                error: None,
            },
            // 回复已经到了但落库失败：别装作成功，也别把用户那句抹掉。
            Err(error) => failure(GatewayError::Config(format!("回复落库失败：{error}"))),
        }
    }

    /// 归档 / 取消归档；返回失败原因，成功是 `null`。
    pub async fn set_archived(id: f64, archived: bool) -> Option<String> {
        save(&Store::open_app(), |store| {
            store.set_conversation_archived(crate::domain::ConversationId(id as u64), archived)
        })
    }

    /// 删除会话、它的消息正文与照片（依据日志保留，照片一起删，见 ADR-0005 修订）。
    pub async fn delete(id: f64) -> Option<String> {
        match Store::open_app() {
            Ok(store) => delete_conversation(&store, &photos::photos_dir(), id),
            Err(error) => Some(error.to_string()),
        }
    }
}

/// 界面上的编号是 `f64`（JsObject 的约定），但只接受非负整数。
fn whole(value: f64, field: &str) -> Result<u64, String> {
    if !value.is_finite() || value.fract() != 0.0 || value < 0.0 {
        return Err(format!("{field} 不合法：{value}"));
    }
    Ok(value as u64)
}

/// 这一轮附带的照片：编号合法、属于这个会话、字节读得出来，就给出（行，data URL）。
fn attached_photo(
    store: &Store,
    dir: &std::path::Path,
    conversation: crate::domain::ConversationId,
    raw: f64,
) -> Result<(Photo, String), String> {
    if !raw.is_finite() || raw < 1.0 {
        return Err(format!("照片编号不合法：{raw}"));
    }
    let id = PhotoId(raw as u64);
    let photo = store
        .photo(id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("找不到编号 {} 的照片。", id.0))?;
    if photo.conversation != conversation {
        return Err("这张照片不属于这个会话。".to_owned());
    }
    let bytes =
        photos::load(dir, &photo.file).map_err(|error| format!("照片文件读不出来：{error}"))?;
    Ok((photo.clone(), photos::data_url(&photo.mime, &bytes)))
}

/// 一张照片在界面上的元数据。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct PhotoView {
    /// 编号：取图与发送时用它。
    pub id: f64,
    pub width: f64,
    pub height: f64,
    pub bytes: f64,
}

/// 选一张照片的结果：取消时 `photo` 是 `null`，不写任何东西。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct PickResultView {
    pub photo: Option<PhotoView>,
    /// 被系统选择器缩小过时的说明。
    pub notice: Option<String>,
    pub error: Option<String>,
}

/// 照片：从系统相册选一张、取回它的字节。
///
/// 缩放与 HEIC→JPEG 由系统选择器完成（`max_dimension`），这里只落盘与读回。
#[module]
pub struct Photos;

#[module]
impl Photos {
    /// 选一张照片，落进这个会话的私有目录；取消时什么都不留。
    pub async fn pick(conversation: f64) -> PickResultView {
        let fail = |message: String| PickResultView {
            photo: None,
            notice: None,
            error: Some(message),
        };
        let conversation = crate::domain::ConversationId(conversation as u64);
        // 校验完就关库：选择器可能开很久，别一直占着 redb 的写句柄。
        {
            let store = match Store::open_app() {
                Ok(store) => store,
                Err(error) => return fail(error.to_string()),
            };
            if store.conversation(conversation).ok().flatten().is_none() {
                return fail("找不到这个会话。".to_owned());
            }
        }
        let dir = photos::photos_dir();

        // `PickRequest` 是 non_exhaustive：从默认值出发再改。
        let mut request = nsh_core::picker::PickRequest::new(false, PER_MESSAGE);
        request.max_dimension = Some(DevicePixels(MAX_DIMENSION as i32));
        request.quality = Some(Percentage(0.85));
        request.format = nsh_core::picker::PickFormat::Compatible;
        let picked = pick_images(request).await;
        // 取消：不留文件、不落库。
        let Some(file) = picked.into_iter().next() else {
            return PickResultView {
                photo: None,
                notice: None,
                error: None,
            };
        };

        // 选好之后重新开库（此时才需要写）。
        let store = match Store::open_app() {
            Ok(store) => store,
            Err(error) => return fail(error.to_string()),
        };
        let id = match store.reserve_photo_id() {
            Ok(id) => id,
            Err(error) => return fail(error.to_string()),
        };
        let bytes = file.data.bytes();
        let file_name = match photos::save(&dir, id, &file.mime, bytes) {
            Ok(name) => name,
            Err(error) => return fail(format!("照片存不下来：{error}")),
        };
        let photo = Photo {
            id,
            conversation,
            file: file_name,
            mime: file.mime.clone(),
            width: file.size.width.0.max(1) as u32,
            height: file.size.height.0.max(1) as u32,
            bytes: bytes.len() as u64,
            at: now_ms(),
        };
        let saved = match store.insert_photo(photo) {
            Ok(photo) => photo,
            Err(error) => return fail(error.to_string()),
        };
        let notice = saved
            .was_scaled()
            .then(|| format!("照片按长边 {MAX_DIMENSION} 缩小了；原图没有存进设备。"));
        PickResultView {
            photo: Some(PhotoView {
                id: saved.id.0 as f64,
                width: f64::from(saved.width),
                height: f64::from(saved.height),
                bytes: saved.bytes as f64,
            }),
            notice,
            error: None,
        }
    }

    /// 取一张照片的 data URL（界面直接给 `Image` 的 `src`）；读不出来是 `null`。
    pub async fn data(id: f64) -> Option<String> {
        if !id.is_finite() || id < 1.0 {
            return None;
        }
        let store = Store::open_app().ok()?;
        let photo = store.photo(PhotoId(id as u64)).ok().flatten()?;
        let bytes = photos::load(&photos::photos_dir(), &photo.file).ok()?;
        Some(photos::data_url(&photo.mime, &bytes))
    }
}

/// 失败：一条消息都不落库，错误按出路分类。
fn failure(error: GatewayError) -> SendResultView {
    SendResultView {
        messages: Vec::new(),
        error: Some(ChatErrorView {
            kind: error.kind().to_owned(),
            message: error.message().to_owned(),
            can_retry: error.can_retry(),
        }),
    }
}

/// 装配要的当前状态：基本属性、最新测量、档案投影、训练条件、未结提议。
fn snapshot(store: &Store, conversation: crate::domain::ConversationId) -> Snapshot {
    Snapshot {
        basics: store.basics().unwrap_or_default(),
        height: store
            .latest_measurement(MeasurementKind::Height)
            .ok()
            .flatten(),
        weight: store
            .latest_measurement(MeasurementKind::Weight)
            .ok()
            .flatten(),
        projection: store.projection().unwrap_or_default(),
        training: store.training().unwrap_or_default(),
        // 生效计划进装配：模型要知道现在排到哪一版、复查日是哪天（#12）。
        plan: store.active_plan().ok().flatten(),
        // 未结提议要进装配：用户拒绝之后，模型得知道「第 2 项」指的是哪个部位。
        proposals: store
            .pending_proposal(conversation)
            .ok()
            .flatten()
            .map(|proposal| {
                proposal
                    .items
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        let site = crate::anatomy::site(&item.draft.site)
                            .map(|site| site.zh.to_owned())
                            .unwrap_or_else(|| item.draft.site.clone());
                        let side = item
                            .draft
                            .side
                            .map(|side| format!(" · {}", side.zh()))
                            .unwrap_or_default();
                        format!(
                            "第 {} 项：{site}{side}｜{}｜置信度 {}",
                            index + 1,
                            axis_values_text(&item.draft.values),
                            item.draft.confidence
                        )
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// 设置的读与写：DeepSeek 的 API key 与工具往返上限。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SettingsView {
    /// 是否已经有一把 key。
    pub has_key: bool,
    /// 打码后的样子（`sk-…abcd`），没填是 `null`。
    pub masked: Option<String>,
    /// 一轮对话里允许的工具往返轮数（1–128）。
    pub tool_rounds: f64,
    /// 轮数的下界（界面不要自己写死数字）。
    pub rounds_min: f64,
    /// 轮数的上界。
    pub rounds_max: f64,
    /// 下界与上界之间的默认值。
    pub rounds_default: f64,
    /// 读库失败的原因。
    pub error: Option<String>,
}

/// 档案页上的一个轴标签（五条轴都给，未测的也占一位）。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct AxisChipView {
    /// 机器键：`tension` / `symmetry` / `mobility` / `pain` / `stability`。
    pub axis: String,
    /// 中文名：张力 / 对称 / 活动度 / 疼痛 / 稳定性。
    pub label: String,
    /// 取值的可读串；未测是 `null`。
    pub value: Option<String>,
    /// 这条轴测过吗；没测的显示成虚线（契约 §6 的「未测」）。
    pub measured: bool,
    /// 这条轴落在异常取值上（紧 / 左弱 / 受限 / 疼痛 > 0）。
    pub abnormal: bool,
}

/// 时间线上的一条：一条判定或一次撤回。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct HistoryEntryView {
    /// `record`（写入）/ `resolve`（解决）/ `retract`（撤回）。
    pub kind: String,
    /// 这条判定的编号：撤回某一条时用它。
    pub finding: f64,
    /// Unix 毫秒。
    pub at: f64,
    /// 判定取值的可读串；撤回事件是空串。
    pub values: String,
    /// 撤回理由；判定是 `null`。
    pub reason: Option<String>,
    /// 这条判定就是当前生效的那条。
    pub current: bool,
    /// 这条事件写的四段依据（旧数据可能没有）。
    pub evidence: Vec<EvidenceSectionView>,
}

/// 档案页上一行：一个「部位 + 侧别」的当前状态。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SiteCardView {
    /// 部位 id。
    pub site: String,
    /// 部位中文名。
    pub site_zh: String,
    /// 侧别（`left` / `right`），中线结构是 `null`。
    pub side: Option<String>,
    /// 侧别中文（左 / 右）。
    pub side_zh: Option<String>,
    /// 当前状态的时间，Unix 毫秒。
    pub at: f64,
    /// 当前状态来自哪条判定；「已解决 / 撤回」用它。
    pub finding: f64,
    /// 那条判定的置信度。
    pub confidence: f64,
    /// 当前生效的那条是用户点的「标记已解决」（按动作判断，不看取值）：
    /// 显示成「已解决」，不再提供「标记已解决」。
    pub resolved: bool,
    /// 五条轴，按显示顺序。
    pub axes: Vec<AxisChipView>,
    /// 当前判定的四段依据。
    pub evidence: Vec<EvidenceSectionView>,
    /// 依据的时间；没有依据是 `null`。
    pub evidence_at: Option<f64>,
    /// 这个「部位 + 侧别」的全部事件，时间倒序。
    pub timeline: Vec<HistoryEntryView>,
}

/// 按区域（肌肉看首要肌群，骨骼看区域）分出来的一块。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SiteSectionView {
    /// 肌肉是肌群 id，骨骼是区域 id。
    pub id: String,
    /// 显示用的中文名。
    pub label: String,
    pub cards: Vec<SiteCardView>,
}

/// 一个肌群在一侧上的聚合（成员逐轴取最差值）。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct GroupWorstView {
    /// 肌群 id。
    pub id: String,
    /// 肌群中文名。
    pub zh: String,
    /// 聚合的侧别，中线成员是 `null`。
    pub side: Option<String>,
    pub side_zh: Option<String>,
    /// 聚合之后的五条轴。
    pub axes: Vec<AxisChipView>,
    /// 最差来自哪个部位（中文名）。
    pub source_site_zh: String,
    /// 最差那条判定的取值可读串。
    pub source_values: String,
    /// 有判定、参与聚合的成员数。
    pub member_count: f64,
}

/// 档案页要读的全部状态。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct FindingsView {
    /// 一共有多少行（一个「部位 + 侧别」一行）。
    pub total: f64,
    pub sections: Vec<SiteSectionView>,
    /// 有判定的肌群聚合；没判定的肌群不出现。
    pub groups: Vec<GroupWorstView>,
    /// 读库失败的原因；有值时界面要提示而不是装作空档案。
    pub error: Option<String>,
}

/// 档案条目的读写：读档案页的读模型，追加「已解决 / 撤回」两种更正。
#[module]
pub struct Findings;

#[module]
impl Findings {
    /// 读档案页：按区域分组的卡片、依据、时间线与肌群聚合。
    pub async fn load() -> FindingsView {
        match Store::open_app() {
            Ok(store) => findings_view(&store, None),
            Err(error) => empty_findings_view(Some(error.to_string())),
        }
    }

    /// 「标记已解决」：给这条判定的部位追加一条正常判定（历史仍在）；
    /// 返回失败原因，成功是 `null`。
    pub async fn resolve(finding: f64) -> Option<String> {
        let id = match whole(finding, "判定编号") {
            Ok(id) => crate::domain::FindingId(id),
            Err(message) => return Some(message),
        };
        save(&Store::open_app(), |store| resolve_at(store, id, now_ms()))
    }

    /// 「判定有误」：撤回这条判定，必须写理由；返回失败原因，成功是 `null`。
    pub async fn retract(finding: f64, reason: String) -> Option<String> {
        let id = match whole(finding, "判定编号") {
            Ok(id) => crate::domain::FindingId(id),
            Err(message) => return Some(message),
        };
        let reason = reason.trim().to_owned();
        if reason.is_empty() {
            return Some("撤回一条判定必须写理由：错在哪，下次才知道该信什么。".to_owned());
        }
        save(&Store::open_app(), |store| {
            retract_at(store, id, &reason, now_ms())
        })
    }
}

fn findings_view(store: &Store, error: Option<String>) -> FindingsView {
    let mut errors: Vec<String> = error.into_iter().collect();
    let events = match store.events() {
        Ok(events) => events,
        Err(error) => {
            errors.push(error.to_string());
            Vec::new()
        }
    };
    let evidence = match store.evidence_log() {
        Ok(evidence) => evidence,
        Err(error) => {
            errors.push(error.to_string());
            Vec::new()
        }
    };
    let page = crate::domain::ProfilePage::build(&events, &evidence);
    FindingsView {
        total: page.cards() as f64,
        sections: page
            .sections
            .iter()
            .map(|section| SiteSectionView {
                id: section.id.clone(),
                label: section.label.clone(),
                cards: section.cards.iter().map(site_card_view).collect(),
            })
            .collect(),
        groups: page.groups.iter().map(group_worst_view).collect(),
        error: join_errors(errors),
    }
}

fn empty_findings_view(error: Option<String>) -> FindingsView {
    FindingsView {
        total: 0.0,
        sections: Vec::new(),
        groups: Vec::new(),
        error,
    }
}

fn site_card_view(card: &crate::domain::SiteCard) -> SiteCardView {
    SiteCardView {
        site: card.site.clone(),
        site_zh: card.site_zh.clone(),
        side: card.side.map(|side| side.key().to_owned()),
        side_zh: card.side.map(|side| side.zh().to_owned()),
        at: card.at as f64,
        finding: card.from.0 as f64,
        confidence: f64::from(card.confidence),
        resolved: card.resolved(),
        axes: axis_chips(card.values),
        evidence: card
            .evidence
            .as_ref()
            .map(evidence_sections)
            .unwrap_or_default(),
        evidence_at: card.evidence.as_ref().map(|evidence| evidence.at as f64),
        timeline: card
            .history
            .iter()
            .map(|entry| HistoryEntryView {
                kind: entry.correction.key().to_owned(),
                finding: entry.finding.0 as f64,
                at: entry.at as f64,
                values: axis_values_text(&entry.values),
                reason: entry.reason.clone(),
                current: entry.current,
                evidence: entry
                    .evidence
                    .as_ref()
                    .map(evidence_sections)
                    .unwrap_or_default(),
            })
            .collect(),
    }
}

fn group_worst_view(group: &crate::domain::GroupWorst) -> GroupWorstView {
    GroupWorstView {
        id: group.id.clone(),
        zh: group.zh.clone(),
        side: group.side.map(|side| side.key().to_owned()),
        side_zh: group.side.map(|side| side.zh().to_owned()),
        axes: axis_chips(group.values),
        source_site_zh: group.source.site_zh.clone(),
        source_values: axis_values_text(&group.source.values),
        member_count: group.sites.len() as f64,
    }
}

/// 五条轴都占一位：没测的也出现，界面才知道要显示成虚线。
fn axis_chips(values: crate::domain::AxisValues) -> Vec<AxisChipView> {
    crate::domain::Axis::ALL
        .into_iter()
        .map(|axis| {
            let value = values.get(axis);
            AxisChipView {
                axis: axis.key().to_owned(),
                label: axis.zh().to_owned(),
                value: value.map(|value| value.zh()),
                measured: value.is_some(),
                abnormal: value.is_some_and(|value| !value.is_normal()),
            }
        })
        .collect()
}

fn evidence_sections(evidence: &crate::domain::Evidence) -> Vec<EvidenceSectionView> {
    evidence
        .sections()
        .iter()
        .map(|(name, text)| EvidenceSectionView {
            name: (*name).to_owned(),
            text: (*text).to_owned(),
        })
        .collect()
}

fn anatomy_zh(site: &str) -> String {
    crate::anatomy::site(site)
        .map(|site| site.zh.to_owned())
        .unwrap_or_else(|| site.to_owned())
}

/// 「标记已解决」：给同一个部位（同侧别）追加一条正常判定，连同四段依据。
///
/// 这是**用户**的动作，没有经过 agent 会话；四段照样写，但要如实说明「未经复查」，
/// 别让它冒充一次验证。
fn resolve_at(
    store: &Store,
    id: crate::domain::FindingId,
    at: i64,
) -> Result<(), crate::store::StoreError> {
    let target = store
        .finding(id)?
        .ok_or(crate::store::StoreError::Domain(
            crate::domain::DomainError::UnknownFinding(id),
        ))?;
    if store.retraction(id)?.is_some() {
        return Err(crate::store::StoreError::Domain(
            crate::domain::DomainError::AlreadyRetracted(id),
        ));
    }
    let site_zh = anatomy_zh(&target.site);
    let evidence = crate::domain::EvidenceDraft {
        kind: crate::domain::EvidenceKind::Resolve,
        site: target.site.clone(),
        side: target.side,
        finding: None,
        conversation: None,
        at,
        user_said: format!("用户在档案页把「{site_zh}」标记为已解决。"),
        test_and_feedback: "没有经过 agent 验证：这是用户在档案页直接点的。".to_owned(),
        reasoning: format!(
            "用户认为这条判定（{}）已经不再成立。",
            axis_values_text(&target.values)
        ),
        uncertainty: "未经复查；下次评估应当重新验证这个部位。".to_owned(),
    };
    store.record_with_evidence(crate::domain::FindingDraft::resolve(&target, at), evidence)?;
    Ok(())
}

/// 「判定有误」：撤回一条判定，连同四段依据（理由就是用户写的那句话）。
fn retract_at(
    store: &Store,
    id: crate::domain::FindingId,
    reason: &str,
    at: i64,
) -> Result<(), crate::store::StoreError> {
    let target = store
        .finding(id)?
        .ok_or(crate::store::StoreError::Domain(
            crate::domain::DomainError::UnknownFinding(id),
        ))?;
    let evidence = crate::domain::EvidenceDraft {
        kind: crate::domain::EvidenceKind::Retract,
        site: target.site.clone(),
        side: target.side,
        finding: None,
        conversation: None,
        at,
        user_said: format!("用户在档案页判定这条有误：{reason}"),
        test_and_feedback: "没有经过 agent 会话：这是用户在档案页直接点的。".to_owned(),
        reasoning: format!(
            "原判定（{}）被用户撤回，理由见上。",
            axis_values_text(&target.values)
        ),
        uncertainty: "用户没有给出可复核的测量；历史条目仍留在时间线里。".to_owned(),
    };
    store.retract_with_evidence(id, reason, at, evidence)?;
    Ok(())
}

/// 测试用入口：让每个测试文件从干净的库开始（`nsh test` 的多个文件共用一个进程）。
///
/// 不是产品功能——「清空本地数据」属于后续工单的重操作，界面不走这里。
#[module]
pub struct Testing;

#[module]
impl Testing {
    /// 清空本地库并重建空表；返回失败原因，成功是 `null`。
    pub async fn reset() -> Option<String> {
        match Store::open_app() {
            Ok(store) => store.reset_all().err().map(|error| error.to_string()),
            Err(error) => Some(error.to_string()),
        }
    }

    /// 把生效计划的复查日挪到昨天（只在界面测试里用：造出「复查日到了」）。
    /// 没有生效计划时什么都不做。
    pub async fn expire_plan() -> Option<String> {
        save(&Store::open_app(), |store| {
            store.set_active_plan_review_at(now_ms() - crate::domain::tool::DAY_MS)
        })
    }
}

/// 本机设置：DeepSeek 的 API key（打码读取）。
#[module]
pub struct Settings;

#[module]
impl Settings {
    /// 读设置（不返回 key 本身：界面只显示打码后的样子）。
    pub async fn load() -> SettingsView {
        match Store::open_app() {
            Ok(store) => {
                let rounds = store
                    .setting(TOOL_ROUNDS)
                    .ok()
                    .flatten()
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(agent::DEFAULT_MAX_ROUNDS);
                match store.setting(API_KEY) {
                    Ok(key) => settings_view(key, rounds, None),
                    Err(error) => settings_view(None, rounds, Some(error.to_string())),
                }
            }
            Err(error) => settings_view(None, agent::DEFAULT_MAX_ROUNDS, Some(error.to_string())),
        }
    }

    /// 保存工具往返上限：1–128 的整数（没有「无限制」）。
    pub async fn save_rounds(rounds: f64) -> Option<String> {
        if !rounds.is_finite() || rounds.fract() != 0.0 {
            return Some("轮数要是整数。".to_owned());
        }
        let rounds = rounds as i64;
        if !(1..=agent::MAX_ROUNDS_LIMIT as i64).contains(&rounds) {
            return Some(format!(
                "轮数要在 1–{} 之间；调太多只会让模型空转。",
                agent::MAX_ROUNDS_LIMIT
            ));
        }
        save(&Store::open_app(), |store| {
            store.set_setting(TOOL_ROUNDS, &rounds.to_string())
        })
    }

    /// 保存 key；返回失败原因，成功是 `null`。
    pub async fn save_key(key: String) -> Option<String> {
        let key = key.trim().to_owned();
        if key.is_empty() {
            return Some("key 不能是空白。要清除已保存的 key，用「清除」。".to_owned());
        }
        if key.chars().any(char::is_whitespace) {
            return Some("key 里不应该有空格或换行，检查一下有没有复制多行。".to_owned());
        }
        save(&Store::open_app(), |store| store.set_setting(API_KEY, &key))
    }

    /// 清除已保存的 key。
    pub async fn clear_key() -> Option<String> {
        save(&Store::open_app(), |store| store.delete_setting(API_KEY))
    }
}

fn settings_view(key: Option<String>, tool_rounds: usize, error: Option<String>) -> SettingsView {
    let masked = key.as_deref().map(mask_key);
    SettingsView {
        has_key: key.is_some_and(|key| !key.trim().is_empty()),
        masked,
        tool_rounds: tool_rounds as f64,
        rounds_min: 1.0,
        rounds_max: agent::MAX_ROUNDS_LIMIT as f64,
        rounds_default: agent::DEFAULT_MAX_ROUNDS as f64,
        error,
    }
}

/// 只露头尾：`sk-…abcd`。
fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "…".to_owned();
    }
    let head: String = chars.iter().take(3).collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

fn now_ms() -> i64 {
    nsh_core::time::unix_ms() as i64
}

fn message_view(message: &crate::domain::Message) -> MessageView {
    MessageView {
        id: message.id.0 as f64,
        role: message.role.key().to_owned(),
        text: message.text.clone(),
        photos: message.photos.iter().map(|photo| photo.0 as f64).collect(),
        at: message.at as f64,
    }
}

fn conversation_list_view(store: &Store, error: Option<String>) -> ConversationListView {
    let mut errors: Vec<String> = error.into_iter().collect();
    let conversations = match store.conversations() {
        Ok(conversations) => conversations,
        Err(error) => {
            errors.push(error.to_string());
            Vec::new()
        }
    };
    let view = |conversation: &crate::domain::Conversation| ConversationView {
        id: conversation.id.0 as f64,
        title: conversation.title.clone(),
        updated_at: conversation.updated_at as f64,
        archived: conversation.archived,
        preview: store
            .messages(conversation.id)
            .map(|messages| {
                messages
                    .last()
                    .map(|message| preview(&message.text))
                    .unwrap_or_else(|| "还没有消息".to_owned())
            })
            .unwrap_or_else(|_| "消息读取失败".to_owned()),
        message_count: store
            .messages(conversation.id)
            .map(|messages| messages.len() as f64)
            .unwrap_or(0.0),
    };
    ConversationListView {
        active: conversations
            .iter()
            .filter(|conversation| !conversation.archived)
            .map(&view)
            .collect(),
        archived: conversations
            .iter()
            .filter(|conversation| conversation.archived)
            .map(&view)
            .collect(),
        error: join_errors(errors),
    }
}

fn conversation_detail_view(
    store: &Store,
    id: f64,
    error: Option<String>,
) -> ConversationDetailView {
    let conversation = store
        .conversation(crate::domain::ConversationId(id as u64))
        .ok()
        .flatten();
    match conversation {
        Some(conversation) => {
            let mut errors: Vec<String> = error.into_iter().collect();
            let messages = match store.messages(conversation.id) {
                Ok(messages) => messages,
                Err(error) => {
                    errors.push(error.to_string());
                    Vec::new()
                }
            };
            let (pending_proposal, accepted_proposals) = match store.proposals(conversation.id) {
                Ok(proposals) => (
                    // 有没审的项就摆在卡里（接受过一部分的也一样）。
                    proposals
                        .iter()
                        .find(|proposal| proposal.has_pending_items())
                        .map(proposal_view),
                    // 「已关闭」不渲染成已应用；还有待审项的卡留在卡里（能继续勾），
                    // 只有审完了的才进摘要。
                    proposals
                        .iter()
                        .filter(|proposal| {
                            proposal.status == crate::domain::ProposalStatus::Accepted
                                && !proposal.has_pending_items()
                        })
                        .map(proposal_view)
                        .collect(),
                ),
                Err(error) => {
                    errors.push(error.to_string());
                    (None, Vec::new())
                }
            };
            ConversationDetailView {
                id,
                title: conversation.title.clone(),
                messages: messages.iter().map(message_view).collect(),
                notice: conversation.notice.clone(),
                pending_proposal,
                accepted_proposals,
                error: join_errors(errors),
            }
        }
        None => empty_detail_view(id, error.or_else(|| Some("找不到这个会话。".to_owned()))),
    }
}

fn empty_detail_view(id: f64, error: Option<String>) -> ConversationDetailView {
    ConversationDetailView {
        id,
        title: "新会话".to_owned(),
        messages: Vec::new(),
        notice: None,
        pending_proposal: None,
        accepted_proposals: Vec::new(),
        error,
    }
}

/// 一张卡在界面上的样子。
fn proposal_view(proposal: &crate::domain::Proposal) -> ProposalView {
    ProposalView {
        id: proposal.id.0 as f64,
        at: proposal.at as f64,
        status: proposal.status.key().to_owned(),
        items: proposal
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let site = crate::anatomy::site(&item.draft.site);
                ProposalItemView {
                    index: index as f64,
                    site: item.draft.site.clone(),
                    site_zh: site.map(|site| site.zh.to_owned()).unwrap_or_else(|| {
                        item.draft.site.clone()
                    }),
                    side: item.draft.side.map(|side| side.key().to_owned()),
                    side_zh: item.draft.side.map(|side| side.zh().to_owned()),
                    values: axis_values_text(&item.draft.values),
                    confidence: f64::from(item.draft.confidence),
                    low_confidence: item.draft.confidence < crate::domain::proposal::LOW_CONFIDENCE,
                    selected_by_default: item.default_selected(),
                    state: match item.state {
                        crate::domain::ItemState::Pending => "pending",
                        crate::domain::ItemState::Accepted => "accepted",
                        crate::domain::ItemState::Rejected => "rejected",
                    }
                    .to_owned(),
                    evidence: item
                        .evidence
                        .sections()
                        .iter()
                        .map(|(name, text)| EvidenceSectionView {
                            name: (*name).to_owned(),
                            text: (*text).to_owned(),
                        })
                        .collect(),
                }
            })
            .collect(),
    }
}

/// 删除一个会话：照片行与文件、提议，以及会话本身。
///
/// 依据日志**不删**（ADR-0005）：日志里会标注「来源会话已删除」。照片不是依据，
/// 所以连文件一起删（ADR-0005 修订）。
fn delete_conversation(store: &Store, photos_dir: &std::path::Path, id: f64) -> Option<String> {
    let conversation = crate::domain::ConversationId(id as u64);
    let removed = match store.delete_photos_of(conversation) {
        Ok(removed) => removed,
        Err(error) => return Some(error.to_string()),
    };
    if let Err(error) = store.delete_conversation(conversation) {
        return Some(error.to_string());
    }
    // 文件删不掉就留着：库行已经没了，界面再也看不到它们。
    for photo in removed {
        let _ = photos::remove(photos_dir, &photo.file);
    }
    None
}

/// 五轴取值的可读串：`张力 弱；活动度 受限`。
fn axis_values_text(values: &crate::domain::AxisValues) -> String {
    values
        .measured()
        .map(|axis| {
            format!(
                "{} {}",
                axis.zh(),
                values.get(axis).expect("measured 说有值").zh()
            )
        })
        .collect::<Vec<_>>()
        .join("；")
}

/// 提议卡的三个动作：接受选中、拒绝一项、撤销一次接受。
///
/// 拒绝会**自动发起一轮**（`#10` 的决策）：把「我拒绝了第 N 项（理由：…）」作为
/// 真实用户消息落库，模型必须在下一轮给出下一步。
#[module]
pub struct Proposals;

#[module]
impl Proposals {
    /// 接受选中的项：落判定 + 依据，卡变已应用。
    pub async fn accept(conversation: f64, proposal: f64, selected: Vec<f64>) -> Option<String> {
        let store = match Store::open_app() {
            Ok(store) => store,
            Err(error) => return Some(error.to_string()),
        };
        let id = match whole(proposal, "提议编号") {
            Ok(id) => crate::domain::ProposalId(id),
            Err(message) => return Some(message),
        };
        match store.proposal(id) {
            Ok(Some(card)) if card.conversation != crate::domain::ConversationId(conversation as u64) => {
                return Some("这张卡不属于这个会话。".to_owned());
            }
            Ok(None) => return Some("找不到这张提议卡。".to_owned()),
            Ok(Some(_)) => {}
            Err(error) => return Some(error.to_string()),
        }
        let mut indices: Vec<usize> = Vec::with_capacity(selected.len());
        for index in selected {
            match whole(index, "第几项") {
                Ok(index) => indices.push(index as usize),
                Err(message) => return Some(message),
            }
        }
        if indices.is_empty() {
            return Some("至少勾一项再接受；一项都不要就「拒绝」。".to_owned());
        }
        match store.accept_proposal(id, &indices, now_ms()) {
            // 接受改的是档案，不是会话正文：列表顺序不动。
            Ok(_) => None,
            Err(error) => Some(error.to_string()),
        }
    }

    /// 拒绝一项并说明理由：落 `rejection` 证据，然后把这句话作为用户消息发出去。
    pub async fn reject(
        conversation: f64,
        proposal: f64,
        index: f64,
        reason: String,
    ) -> SendResultView {
        let index = match whole(index, "第几项") {
            Ok(index) => index as usize,
            Err(message) => return failure(GatewayError::Request(message)),
        };
        // 写完就关库：redb 一个文件同时只容一个写句柄，紧接着的 `send` 还要开。
        let rejected = {
            let store = match Store::open_app() {
                Ok(store) => store,
                Err(error) => return failure(GatewayError::Config(error.to_string())),
            };
            store.reject_item(
                match whole(proposal, "提议编号") {
                    Ok(id) => crate::domain::ProposalId(id),
                    Err(message) => return failure(GatewayError::Request(message)),
                },
                index,
                &reason,
                now_ms(),
            )
        };
        if let Err(error) = rejected {
            return failure(GatewayError::Request(error.to_string()));
        }
        let reason = reason.trim();
        let text = if reason.is_empty() {
            format!("我拒绝了第 {} 项。", index + 1)
        } else {
            format!("我拒绝了第 {} 项，理由：{reason}", index + 1)
        };
        let result = Conversations::send(conversation, text.clone(), None).await;
        if result.error.is_some() {
            // 拒绝已经记下了，这句话也说出口了：这一轮没跑成，但不能让用户的话丢掉
            //（下一轮装配会带上它，模型仍能接上）。
            if let Ok(store) = Store::open_app() {
                let _ = store.append_message(
                    crate::domain::ConversationId(conversation as u64),
                    crate::domain::Role::User,
                    &text,
                    now_ms(),
                );
            }
        }
        result
    }

    /// 撤销一次接受：逐项撤回，卡回到待确认（可以重新勾）。
    pub async fn undo(proposal: f64, reason: String) -> Option<String> {
        if reason.trim().is_empty() {
            return Some("撤销要写一句错在哪：历史条目不会删，理由会留在依据日志里。".to_owned());
        }
        let id = match whole(proposal, "提议编号") {
            Ok(id) => crate::domain::ProposalId(id),
            Err(message) => return Some(message),
        };
        save(&Store::open_app(), |store| {
            store.undo_proposal(id, &reason, now_ms()).map(|_| ())
        })
    }
}

/// 摘要：压成一行，最多 40 个字。
fn preview(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut preview: String = line.chars().take(40).collect();
    if line.chars().count() > 40 {
        preview.push('…');
    }
    preview
}

/// 计划里的一个动作：名、处方，以及它对应哪条判定（档案页点它看时间线）。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct PlanExerciseView {
    /// 第几个（0 起）。
    pub index: f64,
    pub name: String,
    /// 「3×10」/「3×30 秒」。
    pub prescription: String,
    /// 部位 id。
    pub site: String,
    /// 部位中文名。
    pub site_zh: String,
    /// 侧别（`left` / `right`），中线结构是 `null`。
    pub side: Option<String>,
    pub side_zh: Option<String>,
    /// 这个动作对应哪条判定。
    pub finding: f64,
    /// 档案页找时间线用的写法（`{site}-{side}` / `{site}`）。
    pub slug: String,
}

/// 一份计划。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct PlanView {
    pub id: f64,
    /// 第几版（从 1 起）。
    pub version: f64,
    /// 「每周 3 次」/「每 2 天一次」。
    pub frequency: String,
    pub exercises: Vec<PlanExerciseView>,
    /// 生成时间，Unix 毫秒。
    pub at: f64,
    /// 复查日，Unix 毫秒。
    pub review_at: f64,
    /// 到复查日了吗（到了今日页顶部要提示）。
    pub review_due: bool,
}

/// 计划的读模型：生效的那一份 + 全部历史版本。
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct PlansView {
    pub active: Option<PlanView>,
    /// 全部版本，旧的在前：旧版本只读可查。
    pub versions: Vec<PlanView>,
    pub error: Option<String>,
}

/// 计划：读生效计划与历史版本（生成只走 agent 的 `generate_plan` 工具）。
#[module]
pub struct Plans;

#[module]
impl Plans {
    /// 读计划。`today` 是设备本地的今天（`YYYY-MM-DD`），用来判断复查日到没到。
    pub async fn load(today: String) -> PlansView {
        let today_end = end_of_day(&today).unwrap_or_else(now_ms);
        match Store::open_app() {
            Ok(store) => plans_view(&store, today_end, None),
            Err(error) => PlansView {
                active: None,
                versions: Vec::new(),
                error: Some(error.to_string()),
            },
        }
    }
}

fn plans_view(store: &Store, today_end: i64, error: Option<String>) -> PlansView {
    match store.plans() {
        Ok(plans) => PlansView {
            active: store
                .active_plan()
                .ok()
                .flatten()
                .map(|plan| plan_view(store, &plan, today_end)),
            versions: plans
                .iter()
                .map(|plan| plan_view(store, plan, today_end))
                .collect(),
            error,
        },
        Err(error) => PlansView {
            active: None,
            versions: Vec::new(),
            error: Some(error.to_string()),
        },
    }
}

fn plan_view(store: &Store, plan: &crate::domain::Plan, today_end: i64) -> PlanView {
    let exercises = plan
        .exercises
        .iter()
        .enumerate()
        .map(|(index, exercise)| {
            let finding = store.finding(exercise.finding).ok().flatten();
            let (site, side) = match &finding {
                Some(finding) => (finding.site.clone(), finding.side),
                None => (String::new(), None),
            };
            let site_zh = crate::anatomy::site(&site)
                .map(|site| site.zh.to_owned())
                .unwrap_or_else(|| site.clone());
            let slug = match side {
                Some(side) => format!("{site}-{}", side.key()),
                None => site.clone(),
            };
            PlanExerciseView {
                index: index as f64,
                name: exercise.name.clone(),
                prescription: exercise.prescription(),
                site: site.clone(),
                site_zh,
                side: side.map(|side| side.key().to_owned()),
                side_zh: side.map(|side| side.zh().to_owned()),
                finding: exercise.finding.0 as f64,
                slug,
            }
        })
        .collect();
    PlanView {
        id: plan.id.0 as f64,
        version: plan.version as f64,
        frequency: plan.frequency.zh(),
        exercises,
        at: plan.at as f64,
        review_at: plan.review_at as f64,
        review_due: plan.review_at <= today_end,
    }
}

/// 本地今天那一天的最后一毫秒（`YYYY-MM-DD` 解析不出来时退回现在）。
fn end_of_day(iso: &str) -> Option<i64> {
    crate::domain::tool::parse_date(iso).map(|start| start + crate::domain::tool::DAY_MS - 1)
}

/// 档案的读写：基本属性、训练条件、引导标记。
#[module]
pub struct Profile;

#[module]
impl Profile {
    /// 冷启动读一遍全部状态；库打不开时返回空档案并把原因放在 `error` 里。
    pub async fn load() -> ProfileView {
        match Store::open_app() {
            Ok(store) => match (store.basics(), store.training(), store.onboarded()) {
                (Ok(basics), Ok(training), Ok(onboarded)) => ProfileView {
                    onboarded,
                    readiness: readiness_view(&training.readiness()),
                    basics: measured_basics_view(&store, &basics),
                    training: training_view(&training),
                    error: None,
                },
                (basics, training, onboarded) => ProfileView {
                    onboarded: false,
                    basics: basics_view(&Basics::new(), None, None),
                    training: training_view(&TrainingContext::new()),
                    readiness: readiness_view(&TrainingContext::new().readiness()),
                    error: Some(
                        [basics.err(), training.err(), onboarded.err()]
                            .into_iter()
                            .flatten()
                            .map(|error| error.to_string())
                            .collect::<Vec<_>>()
                            .join("；"),
                    ),
                },
            },
            Err(error) => ProfileView {
                onboarded: false,
                basics: basics_view(&Basics::new(), None, None),
                training: training_view(&TrainingContext::new()),
                readiness: readiness_view(&TrainingContext::new().readiness()),
                error: Some(error.to_string()),
            },
        }
    }

    /// 保存基本属性；返回失败原因，成功是 `null`。
    pub async fn save_basics(
        sex: Option<String>,
        age: Option<f64>,
        height_cm: Option<f64>,
        weight_kg: Option<f64>,
        conditions: Vec<String>,
    ) -> Option<String> {
        let basics = match build_basics(sex, age, conditions) {
            Ok(basics) => basics,
            Err(message) => return Some(message),
        };
        // 身高体重是测量：填了且与最新一条不同，就追加一条；清空不删历史。
        let drafts = match body_measurements(height_cm, weight_kg) {
            Ok(drafts) => drafts,
            Err(message) => return Some(message),
        };
        let store = match Store::open_app() {
            Ok(store) => store,
            Err(error) => return Some(error.to_string()),
        };
        if let Err(error) = store.save_basics(&basics) {
            return Some(error.to_string());
        }
        for draft in drafts {
            let unchanged = store
                .latest_measurement(draft.kind)
                .ok()
                .flatten()
                .is_some_and(|latest| latest.value == draft.value);
            if unchanged {
                continue;
            }
            if let Err(error) = store.record_measurement(draft) {
                return Some(error.to_string());
            }
        }
        None
    }

    /// 保存训练条件；返回失败原因，成功是 `null`。
    pub async fn save_training(
        days_per_week: Option<f64>,
        minutes_per_session: Option<f64>,
        places: Vec<String>,
        equipment: Vec<String>,
    ) -> Option<String> {
        let training = match build_training(days_per_week, minutes_per_session, places, equipment) {
            Ok(training) => training,
            Err(message) => return Some(message),
        };
        save(&Store::open_app(), |store| store.save_training(&training))
    }

    /// 引导走完。
    pub async fn finish_onboarding() -> Option<String> {
        save(&Store::open_app(), |store| store.set_onboarded(true))
    }

    /// 训练条件齐不齐（下游判断用：不齐全就不该排计划）。
    pub async fn readiness() -> ReadinessView {
        match Store::open_app() {
            Ok(store) => match store.training() {
                Ok(training) => readiness_view(&training.readiness()),
                Err(_) => readiness_view(&TrainingContext::new().readiness()),
            },
            Err(_) => readiness_view(&TrainingContext::new().readiness()),
        }
    }
}

fn build_basics(
    sex: Option<String>,
    age: Option<f64>,
    conditions: Vec<String>,
) -> Result<Basics, String> {
    Ok(Basics {
        sex: parse_sex(sex.as_deref()),
        age: parse_age(age).map_err(|error| error.to_string())?,
        conditions: conditions
            .into_iter()
            .map(|condition| condition.trim().to_owned())
            .filter(|condition| !condition.is_empty())
            .collect(),
    })
}

fn build_training(
    days_per_week: Option<f64>,
    minutes_per_session: Option<f64>,
    places: Vec<String>,
    equipment: Vec<String>,
) -> Result<TrainingContext, String> {
    Ok(TrainingContext {
        days_per_week: parse_whole(days_per_week, "每周能练几天", DAYS_PER_WEEK_RANGE)
            .map_err(|error| error.to_string())?,
        minutes_per_session: parse_whole(minutes_per_session, "每次多久（分钟）", MINUTES_RANGE)
            .map_err(|error| error.to_string())?,
        places: places
            .iter()
            .filter_map(|place| Place::from_key(place))
            .collect(),
        equipment: equipment
            .into_iter()
            .map(|label| label.trim().to_owned())
            .filter(|label| !label.is_empty())
            .collect(),
    })
}

fn save(
    store: &Result<Store, crate::store::StoreError>,
    write: impl Fn(&Store) -> Result<(), crate::store::StoreError>,
) -> Option<String> {
    match store {
        Ok(store) => write(store).err().map(|error| error.to_string()),
        Err(error) => Some(error.to_string()),
    }
}

fn basics_view(basics: &Basics, height_cm: Option<f64>, weight_kg: Option<f64>) -> BasicsView {
    BasicsView {
        sex: basics.sex.map(|sex| sex.key().to_owned()),
        age: basics.age.map(f64::from),
        height_cm,
        weight_kg,
        conditions: basics.conditions.clone(),
    }
}

/// 基本属性里的「当前身高/体重」始终来自最新一条测量。
fn measured_basics_view(store: &Store, basics: &Basics) -> BasicsView {
    let height = store
        .latest_measurement(MeasurementKind::Height)
        .ok()
        .flatten()
        .map(|measurement| measurement.value);
    let weight = store
        .latest_measurement(MeasurementKind::Weight)
        .ok()
        .flatten()
        .map(|measurement| measurement.value);
    basics_view(basics, height, weight)
}

/// 表单里的身高体重 → 待追加的测量；留空就是「这次不记」。
fn body_measurements(
    height_cm: Option<f64>,
    weight_kg: Option<f64>,
) -> Result<Vec<MeasurementDraft>, String> {
    let at = nsh_core::time::unix_ms() as i64;
    let mut drafts = Vec::new();
    if let Some(value) = parse_metric(height_cm, "身高（厘米）", HEIGHT_CM_RANGE)
        .map_err(|error| error.to_string())?
    {
        drafts.push(MeasurementDraft {
            kind: MeasurementKind::Height,
            value,
            at,
        });
    }
    if let Some(value) = parse_metric(weight_kg, "体重（千克）", WEIGHT_KG_RANGE)
        .map_err(|error| error.to_string())?
    {
        drafts.push(MeasurementDraft {
            kind: MeasurementKind::Weight,
            value,
            at,
        });
    }
    Ok(drafts)
}

fn training_view(training: &TrainingContext) -> TrainingView {
    TrainingView {
        days_per_week: training.days_per_week.map(f64::from),
        minutes_per_session: training.minutes_per_session.map(f64::from),
        places: training
            .places
            .iter()
            .map(|place| place.key().to_owned())
            .collect(),
        equipment: training.equipment.clone(),
    }
}

fn readiness_view(readiness: &Readiness) -> ReadinessView {
    ReadinessView {
        ready: readiness.is_ready(),
        missing: readiness
            .missing()
            .iter()
            .map(|field| field.key().to_owned())
            .collect(),
        missing_zh: readiness
            .missing()
            .iter()
            .map(|field| field.zh().to_owned())
            .collect(),
    }
}

/// 性别：`None` 与空串都是「不填」，认不出来的键当作不填（界面只传合法键）。
fn parse_sex(raw: Option<&str>) -> Option<Sex> {
    raw.and_then(Sex::from_key)
}

/// 年龄：必须是 1–120 的整数。
fn parse_age(raw: Option<f64>) -> Result<Option<u8>, DomainError> {
    parse_whole(raw, "年龄", AGE_RANGE)
}

/// 身高/体重：有限数值且落在区间内。
fn parse_metric(
    raw: Option<f64>,
    field: &'static str,
    (min, max): (f64, f64),
) -> Result<Option<f64>, DomainError> {
    match raw {
        None => Ok(None),
        Some(value) if value.is_finite() && (min..=max).contains(&value) => Ok(Some(value)),
        Some(value) => Err(DomainError::OutOfRange {
            field,
            min,
            max,
            value,
        }),
    }
}

/// 整数型字段：小数与越界都拒。
fn parse_whole<T>(
    raw: Option<f64>,
    field: &'static str,
    (min, max): (T, T),
) -> Result<Option<T>, DomainError>
where
    T: Copy + PartialOrd + Into<f64> + TryFrom<u32>,
{
    let (min, max) = (min.into(), max.into());
    match raw {
        None => Ok(None),
        Some(value)
            if value.is_finite() && value.fract() == 0.0 && (min..=max).contains(&value) =>
        {
            T::try_from(value as u32).map_or_else(
                |_| {
                    Err(DomainError::OutOfRange {
                        field,
                        min,
                        max,
                        value,
                    })
                },
                |whole| Ok(Some(whole)),
            )
        }
        Some(value) => Err(DomainError::OutOfRange {
            field,
            min,
            max,
            value,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn views_carry_unfilled_fields_as_null_not_zero() {
        let view = basics_view(&Basics::new(), None, None);
        assert_eq!(view.sex, None);
        assert_eq!(view.age, None);
        assert_eq!(view.height_cm, None);
        assert!(view.conditions.is_empty());
    }

    #[test]
    fn readiness_view_lists_missing_fields_in_both_forms() {
        let view = readiness_view(&TrainingContext::new().readiness());
        assert!(!view.ready);
        assert_eq!(
            view.missing,
            vec![
                "days-per-week",
                "minutes-per-session",
                "places",
                "equipment"
            ]
        );
        assert_eq!(
            view.missing_zh,
            vec!["每周能练几天", "每次多久", "在哪练", "手边有什么"]
        );
    }

    #[test]
    fn integers_are_required_for_counting_fields() {
        assert_eq!(parse_whole(Some(3.0), "x", (1u8, 7u8)).unwrap(), Some(3));
        assert!(parse_whole(Some(3.5), "x", (1u8, 7u8)).is_err());
        assert!(parse_whole(Some(0.0), "x", (1u8, 7u8)).is_err());
        assert!(parse_whole(Some(f64::NAN), "x", (1u8, 7u8)).is_err());
        assert_eq!(parse_whole(None, "x", (1u8, 7u8)).unwrap(), None);
    }

    #[test]
    fn metrics_reject_nonsense_but_allow_blank() {
        assert_eq!(
            parse_metric(Some(168.0), "身高（厘米）", HEIGHT_CM_RANGE).unwrap(),
            Some(168.0)
        );
        assert_eq!(
            parse_metric(None, "体重（千克）", WEIGHT_KG_RANGE).unwrap(),
            None
        );
        assert!(parse_metric(Some(9.0), "身高（厘米）", HEIGHT_CM_RANGE).is_err());
    }

    #[test]
    fn sex_ignores_unknown_and_blank_values() {
        assert_eq!(parse_sex(Some("female")), Some(Sex::Female));
        assert_eq!(parse_sex(Some("")), None);
        assert_eq!(parse_sex(None), None);
    }
}

#[cfg(test)]
mod measurement_tests {
    use super::*;
    use crate::domain::{MeasurementDraft, MeasurementKind};
    use crate::store::tests::TempStore;

    fn record(store: &Store, kind: MeasurementKind, value: f64, at: i64) {
        store
            .record_measurement(MeasurementDraft { kind, value, at })
            .expect("记一条");
    }

    #[test]
    fn an_empty_series_is_empty_not_zero_and_has_no_change() {
        let temp = TempStore::new("api-measurements-empty");
        let view = measurements_view(temp.store(), None);
        assert_eq!(view.weight.current, None);
        assert_eq!(view.height.current, None);
        assert!(view.weight.points.is_empty());
        assert_eq!(view.error, None);
    }

    #[test]
    fn the_series_carries_points_in_time_order_and_the_change_between_ends() {
        let temp = TempStore::new("api-measurements-series");
        let store = temp.store();
        record(store, MeasurementKind::Weight, 74.6, 200);
        record(store, MeasurementKind::Weight, 74.2, 300);
        record(store, MeasurementKind::Weight, 75.0, 100);

        let view = measurements_view(store, None);
        assert_eq!(view.weight.current, Some(74.2));
        assert!((view.weight.change.expect("首尾的差") - -0.8).abs() < 1e-9);
        assert_eq!(
            view.weight
                .points
                .iter()
                .map(|point| point.at)
                .collect::<Vec<_>>(),
            vec![100.0, 200.0, 300.0]
        );
        assert!(view.height.points.is_empty());
    }

    #[test]
    fn basics_show_the_latest_measurement_as_the_current_value() {
        let temp = TempStore::new("api-measurements-basics");
        let store = temp.store();
        record(store, MeasurementKind::Weight, 62.4, 100);
        record(store, MeasurementKind::Weight, 63.1, 200);
        record(store, MeasurementKind::Height, 168.0, 150);

        let view = measured_basics_view(store, &Basics::new());
        assert_eq!(view.weight_kg, Some(63.1));
        assert_eq!(view.height_cm, Some(168.0));
    }

    #[test]
    fn a_blank_body_field_records_nothing_and_a_value_records_one_measurement() {
        let drafts = body_measurements(None, Some(62.4)).expect("合法");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].kind, MeasurementKind::Weight);
        assert!(body_measurements(None, None).expect("空").is_empty());
        assert!(body_measurements(Some(9.0), None).is_err());
    }
}

#[cfg(test)]
mod photo_tests {
    use super::*;
    use crate::store::tests::TempStore;

    #[test]
    fn an_attached_photo_must_exist_and_belong_to_this_conversation() {
        let temp = TempStore::new("api-photo-guard");
        let store = temp.store();
        let mine = store.create_conversation(100).expect("会话");
        let other = store.create_conversation(200).expect("别的会话");
        let id = store.reserve_photo_id().expect("拿号");
        let dir = std::env::temp_dir().join(format!("lianlian-photo-guard-{}", std::process::id()));
        let file = crate::photos::save(&dir, id, "image/jpeg", b"jpeg").expect("落盘");
        store
            .insert_photo(Photo {
                id,
                conversation: mine.id,
                file: file.clone(),
                mime: "image/jpeg".to_owned(),
                width: 4,
                height: 3,
                bytes: 4,
                at: 110,
            })
            .expect("插");

        let (photo, url) =
            attached_photo(store, &dir, mine.id, id.0 as f64).expect("自己的照片");
        assert_eq!(photo.id, id);
        assert_eq!(url, "data:image/jpeg;base64,anBlZw==");

        let other_side = attached_photo(store, &dir, other.id, id.0 as f64).unwrap_err();
        assert!(other_side.contains("不属于这个会话"), "{other_side}");
        let missing = attached_photo(store, &dir, mine.id, 999.0).unwrap_err();
        assert!(missing.contains("找不到"), "{missing}");

        let _ = crate::photos::remove(&dir, &file);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deleting_a_conversation_takes_its_photo_files_with_it() {
        let temp = TempStore::new("api-photo-delete");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let dir = std::env::temp_dir().join(format!("lianlian-photo-del-{}", std::process::id()));
        let id = store.reserve_photo_id().expect("拿号");
        let file = crate::photos::save(&dir, id, "image/jpeg", b"jpeg").expect("落盘");
        store
            .insert_photo(Photo {
                id,
                conversation: conversation.id,
                file: file.clone(),
                mime: "image/jpeg".to_owned(),
                width: 4,
                height: 3,
                bytes: 4,
                at: 110,
            })
            .expect("插");

        assert_eq!(delete_conversation(store, &dir, conversation.id.0 as f64), None);
        assert!(crate::photos::load(&dir, &file).is_err(), "文件跟着会话走了");
        assert!(store.photos_of(conversation.id).expect("列表").is_empty());
        assert_eq!(store.conversation(conversation.id).expect("读"), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_snapshot_carries_the_pending_proposal_so_the_model_knows_which_item_is_which() {
        use crate::domain::{
            AxisValue, AxisValues, EvidenceDraft, EvidenceKind, FindingDraft, Proposal,
            ProposalItem, ProposalId, Side, Tension,
        };
        let temp = TempStore::new("api-snapshot-proposal");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        let mut values = AxisValues::new();
        values.set(AxisValue::Tension(Tension::Weak));
        let item = ProposalItem::new(
            FindingDraft {
                site: "gluteus-medius".to_owned(),
                side: Some(Side::Left),
                values,
                confidence: 78,
                at: 110,
            },
            EvidenceDraft {
                kind: EvidenceKind::Record,
                site: "gluteus-medius".to_owned(),
                side: Some(Side::Left),
                finding: None,
                conversation: Some(conversation.id),
                at: 110,
                user_said: "蹲不下去".to_owned(),
                test_and_feedback: "靠墙踝背屈差 4 cm".to_owned(),
                reasoning: "背屈受限".to_owned(),
                uncertainty: "没排除髋".to_owned(),
            },
        );
        store
            .create_proposal(
                Proposal::new(ProposalId(0), conversation.id, 110, vec![item]).expect("卡"),
            )
            .expect("开卡");

        let snapshot = snapshot(store, conversation.id);
        assert_eq!(snapshot.proposals.len(), 1);
        let line = &snapshot.proposals[0];
        assert!(line.contains("第 1 项"), "{line}");
        assert!(line.contains("臀中肌"), "{line}");
        assert!(line.contains("置信度 78"), "{line}");
    }
}

#[cfg(test)]
mod conversation_tests {
    use super::*;
    use crate::domain::Role;
    use crate::store::tests::TempStore;

    #[test]
    fn the_list_splits_active_from_archived_and_summarizes_the_last_message() {
        let temp = TempStore::new("api-conversations-list");
        let store = temp.store();
        let active = store.create_conversation(100).expect("会话");
        store
            .append_message(active.id, Role::User, "右膝为什么响\n没有明显疼痛", 110)
            .expect("消息");
        let archived = store.create_conversation(200).expect("会话");
        store
            .append_message(archived.id, Role::User, "训练条件改一下", 210)
            .expect("消息");
        store
            .set_conversation_archived(archived.id, true)
            .expect("归档");

        let view = conversation_list_view(store, None);
        assert_eq!(view.active.len(), 1);
        assert_eq!(view.archived.len(), 1);
        assert_eq!(view.active[0].title, "右膝为什么响 没有明显疼痛");
        assert_eq!(view.active[0].preview, "右膝为什么响 没有明显疼痛");
        assert_eq!(view.active[0].message_count, 1.0);
        assert_eq!(view.archived[0].title, "训练条件改一下");
        assert_eq!(view.error, None);
    }

    #[test]
    fn an_open_conversation_carries_its_messages_in_order() {
        let temp = TempStore::new("api-conversations-open");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("会话");
        store
            .append_message(conversation.id, Role::User, "先说一句", 110)
            .expect("消息");
        store
            .append_message(conversation.id, Role::Assistant, "再说一句", 120)
            .expect("消息");

        let view = conversation_detail_view(store, conversation.id.0 as f64, None);
        assert_eq!(view.title, "先说一句");
        assert_eq!(
            view.messages
                .iter()
                .map(|message| (message.role.as_str(), message.text.as_str()))
                .collect::<Vec<_>>(),
            vec![("user", "先说一句"), ("assistant", "再说一句")]
        );
        assert_eq!(view.error, None);
    }

    #[test]
    fn opening_a_missing_conversation_says_so_instead_of_pretending() {
        let temp = TempStore::new("api-conversations-missing");
        let view = conversation_detail_view(temp.store(), 42.0, None);
        assert!(view.messages.is_empty());
        assert_eq!(view.error.as_deref(), Some("找不到这个会话。"));
    }

    #[test]
    fn previews_are_one_line_and_bounded() {
        assert_eq!(preview("  一\n二  三 "), "一 二 三");
        assert_eq!(preview(&"字".repeat(50)).chars().count(), 41);
    }
}

#[cfg(test)]
mod findings_tests {
    use super::*;
    use crate::domain::{
        Axis, AxisValue, AxisValues, EvidenceDraft, EvidenceKind, FindingDraft, Side, Tension,
    };
    use crate::store::tests::TempStore;

    fn record(store: &Store, at: i64) -> crate::domain::Finding {
        let mut values = AxisValues::new();
        values.set(AxisValue::Tension(Tension::Weak));
        store
            .record_with_evidence(
                FindingDraft {
                    site: "gluteus-medius".to_owned(),
                    side: Some(Side::Left),
                    values,
                    confidence: 78,
                    at,
                },
                EvidenceDraft {
                    kind: EvidenceKind::Record,
                    site: "gluteus-medius".to_owned(),
                    side: Some(Side::Left),
                    finding: None,
                    conversation: None,
                    at,
                    user_said: "走路久了左胯往下一沉".to_owned(),
                    test_and_feedback: "单腿站 30 秒，骨盆下沉 3cm".to_owned(),
                    reasoning: "臀中肌耐力不足".to_owned(),
                    uncertainty: "没排除髋屈肌".to_owned(),
                },
            )
            .expect("写一条")
            .0
    }

    #[test]
    fn a_card_carries_all_five_axes_and_the_four_sections() {
        let temp = TempStore::new("api-findings-view");
        record(temp.store(), 1_000);

        let view = findings_view(temp.store(), None);
        assert_eq!(view.total, 1.0);
        assert_eq!(view.sections.len(), 1);
        assert_eq!(view.sections[0].label, "臀肌群");
        let card = &view.sections[0].cards[0];
        assert_eq!(card.site_zh, "臀中肌");
        assert_eq!(card.side.as_deref(), Some("left"));
        assert_eq!(card.axes.len(), 5, "五条轴都占一位，未测的显示虚线");
        let tension = &card.axes[0];
        assert_eq!(tension.axis, "tension");
        assert!(tension.measured);
        assert!(tension.abnormal);
        assert!(!card.axes[4].measured, "稳定性没测");
        assert_eq!(
            card.evidence
                .iter()
                .map(|section| section.name.as_str())
                .collect::<Vec<_>>(),
            vec!["用户说法要点", "验证方案与反馈", "推理", "不确定之处"]
        );
        assert!(!card.resolved);
        assert_eq!(card.timeline.len(), 1);
        assert!(card.timeline[0].current);
        assert_eq!(view.error, None);
    }

    #[test]
    fn the_group_worst_names_the_member_it_came_from() {
        let temp = TempStore::new("api-findings-group");
        record(temp.store(), 1_000);

        let view = findings_view(temp.store(), None);
        let left = view
            .groups
            .iter()
            .find(|group| group.id == "gluteal-group" && group.side.as_deref() == Some("left"))
            .expect("左侧有判定");
        assert_eq!(left.zh, "臀肌群");
        assert_eq!(left.source_site_zh, "臀中肌");
        assert_eq!(left.source_values, "张力 弱");
        assert_eq!(left.member_count, 1.0);
        // 右侧没有判定：未测不是正常，不该出现。
        assert!(
            !view
                .groups
                .iter()
                .any(|group| group.id == "gluteal-group" && group.side.as_deref() == Some("right"))
        );
    }

    #[test]
    fn resolving_appends_a_normal_finding_with_its_own_evidence() {
        let temp = TempStore::new("api-findings-resolve");
        let store = temp.store();
        let finding = record(store, 1_000);

        resolve_at(store, finding.id, 2_000).expect("标记已解决");
        let view = findings_view(store, None);
        assert_eq!(view.total, 1.0, "部位还是那一行，不是新增一行");
        let card = &view.sections[0].cards[0];
        assert!(card.resolved, "最新取值是正常");
        assert_eq!(card.finding, 2.0, "当前状态来自新追加的那条（#1 是原判定）");
        assert_eq!(card.timeline.len(), 2, "原判定留在时间线里");
        assert_eq!(card.timeline[0].kind, "resolve", "这条来自「标记已解决」");
        assert_eq!(card.timeline[1].kind, "record");
        assert!(card.timeline[0].current, "时间线最上面是当前生效那条");
        assert_eq!(card.timeline[0].values, "张力 正常");
        assert!(!card.timeline[1].current);
        assert_eq!(card.timeline[1].values, "张力 弱");

        let log = store.evidence_log().expect("日志");
        assert_eq!(log.len(), 2);
        assert_eq!(log[1].kind, EvidenceKind::Resolve);
        assert_eq!(
            log[1].finding,
            Some(crate::domain::FindingId(finding.id.0 + 1)),
            "撤回日志指向原判定"
        );
        assert!(
            log[1].user_said.contains("标记为已解决"),
            "用户动作要如实写进依据：{}",
            log[1].user_said
        );
    }

    #[test]
    fn retracting_needs_a_reason_and_takes_the_card_off_the_archive() {
        let temp = TempStore::new("api-findings-retract");
        let store = temp.store();
        let finding = record(store, 1_000);

        let blank = retract_at(store, finding.id, "  ", 2_000).unwrap_err();
        assert!(
            blank.to_string().contains("必须写理由"),
            "空理由要被拒：{blank}"
        );
        assert_eq!(store.evidence_log().expect("日志").len(), 1, "失败不写日志");

        retract_at(store, finding.id, "把臀中肌看成臀小肌了", 2_000).expect("撤回");
        let view = findings_view(store, None);
        assert!(view.sections.is_empty(), "撤回到没有判定时整条消失");
        assert_eq!(view.total, 0.0);

        let log = store.evidence_log().expect("日志");
        assert_eq!(log.len(), 2);
        assert!(log[1].user_said.contains("把臀中肌看成臀小肌了"));
    }

    #[test]
    fn resolving_a_retracted_finding_is_refused() {
        let temp = TempStore::new("api-findings-resolve-retracted");
        let store = temp.store();
        let finding = record(store, 1_000);
        retract_at(store, finding.id, "看错了", 2_000).expect("撤回");

        let error = resolve_at(store, finding.id, 3_000).unwrap_err();
        assert!(error.to_string().contains("撤回"), "{error}");
        assert_eq!(store.findings().expect("判定").len(), 1, "没有追加新判定");
    }

    #[test]
    fn unknown_ids_are_refused_instead_of_writing_anything() {
        let temp = TempStore::new("api-findings-unknown");
        let missing = crate::domain::FindingId(999);
        assert!(resolve_at(temp.store(), missing, 1_000).is_err());
        assert!(retract_at(temp.store(), missing, "不存在", 1_000).is_err());
        assert!(temp.store().evidence_log().expect("日志").is_empty());
    }

    #[test]
    fn axes_keep_the_display_order_from_the_domain() {
        let chips = axis_chips(crate::domain::AxisValues::new());
        assert_eq!(
            chips
                .iter()
                .map(|chip| chip.axis.as_str())
                .collect::<Vec<_>>(),
            vec![
                Axis::Tension.key(),
                Axis::Symmetry.key(),
                Axis::Mobility.key(),
                Axis::Pain.key(),
                Axis::Stability.key()
            ]
        );
        assert!(chips.iter().all(|chip| !chip.measured), "空取值全是未测");
    }
}
