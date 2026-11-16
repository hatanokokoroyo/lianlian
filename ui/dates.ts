// 时间的显示格式。库里一律存 Unix 毫秒，界面按本地时区显示；测试里也是本地时区。

/** Unix 毫秒 → `11-14`（折线图的横轴）。 */
export function shortDate(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

/** Unix 毫秒 → `11月14日 20:30`。 */
export function fullDate(at: number): string {
  const date = new Date(at);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hour}:${minute}`;
}
