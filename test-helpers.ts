// `nsh test` 的测试文件共用一个进程，也就共用同一个临时库（见 README「踩过的坑」）。
// 所以每个文件都从「可能是干净的，也可能已经被前面的文件走过引导」这个前提出发。
import type { App } from "nsh/test";

/** 如果还在引导里，就把它走完；已经走完就什么都不做。 */
export async function ensureOnboarded(app: App) {
  if (!app.shows("id:onboarding-next")) {
    return;
  }
  await app.type("id:basics-age", "32");
  await app.press("id:onboarding-next");
  await app.waitFor("id:training-days-3");
  await app.press("id:training-days-3");
  await app.press("id:training-minutes-30");
  await app.press("id:training-place-home");
  await app.press("id:training-equipment-band");
  await app.press("id:onboarding-next");
  await app.waitFor("id:onboarding-step-3");
  await app.press("id:onboarding-next");
  await app.waitFor("id:tab-today");
}

/** 把所有带「删除」的测量都删掉（列表里每次点最上面那条，再确认）。 */
export async function deleteAllMeasurements(app: App) {
  for (let guard = 0; guard < 50 && app.count("text:删除") > 0; guard += 1) {
    await app.press("text:删除 >> nth=0");
    await app.waitFor("text:确认删除");
    await app.press("text:确认删除");
    await app.wait(100);
  }
}
