//! 占位回复：模型网关还没接上（#7）时，把「会话是一种人类可读的时间线」这个
//! 模型先立起来。它不做任何推理，也不读档案。

/// 「假回复」：把用户这句话复述一遍，并说明现在还没有模型。
pub fn reply(text: &str) -> String {
    let gist: String = text.trim().chars().take(40).collect();
    format!("（还没有接上模型）我先把这句记下来：「{gist}」。工单 #7 会把它换成真的回答。")
}
