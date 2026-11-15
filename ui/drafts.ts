// 表单草稿的生命周期：整个 app 只建一次。
//
// 为什么不在屏里 `newBasicsDraft(props.state.basics)`：保存后会 `refetch()`，父组件拿到
// 新状态再渲染时如果重建草稿，用户在这中间敲的字会被静默冲掉。草稿因此提到模块级，
// 由第一次读到的档案初始化；引导与档案页共用同一份，切 Tab 也不丢。
import type { ProfileView } from "lianlian/native";

import { newBasicsDraft, newTrainingDraft } from "./forms";
import type { BasicsDraft, TrainingDraft } from "./forms";

let basics: BasicsDraft | null = null;
let training: TrainingDraft | null = null;

export interface ProfileDrafts {
  basics: BasicsDraft;
  training: TrainingDraft;
}

/** 首次调用时按读到的档案建草稿，之后一直复用。 */
export function profileDrafts(state: ProfileView): ProfileDrafts {
  if (basics === null) {
    basics = newBasicsDraft(state.basics);
  }
  if (training === null) {
    training = newTrainingDraft(state.training);
  }
  return { basics: basics, training: training };
}
