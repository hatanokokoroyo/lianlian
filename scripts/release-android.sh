#!/usr/bin/env bash
# 触发云端构建，等它跑完，再把产物下载到 dist/。
#
#   scripts/release-android.sh "修好了打卡日期"
#   scripts/release-android.sh --dry-run "先验证流水线"
set -euo pipefail

workflow=android-apk.yml
dry_run=false
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=true
  shift
fi

notes="${1:-}"
if [ -z "$notes" ]; then
  echo "用法: $0 [--dry-run] <更新说明>" >&2
  exit 1
fi

# 版本号以 nsh.json 为准：没提升版本就发版，工作流会在 tag 已存在时拒绝。
version=$(python3 -c 'import json; print(json.load(open("nsh.json"))["version"])')
echo "版本 v${version}，dry-run=$dry_run"

gh workflow run "$workflow" --ref "$(git rev-parse --abbrev-ref HEAD)" \
  -f notes="$notes" -F dry_run="$dry_run"

# 拿到刚触发的这次运行：run list 有延迟，而且可能先看到上一次，
# 所以只认「触发之后创建」的那条。
since=$(python3 -c 'import datetime
now = datetime.datetime.now(datetime.timezone.utc)
print((now - datetime.timedelta(seconds=10)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
run_id=""
for _ in $(seq 1 20); do
  run_id=$(gh run list --workflow "$workflow" --limit 10 \
    --json databaseId,createdAt \
    --jq "[.[] | select(.createdAt >= \"$since\")][0].databaseId // empty" 2>/dev/null || true)
  [ -n "$run_id" ] && break
  sleep 3
done
if [ -z "$run_id" ]; then
  echo "没能定位到刚触发的构建，去 Actions 页面看" >&2
  exit 1
fi

if ! gh run watch "$run_id" --exit-status; then
  echo "构建失败：$(gh run view "$run_id" --json url --jq .url)" >&2
  exit 1
fi

if [ "$dry_run" = true ]; then
  mkdir -p dist
  gh run download "$run_id" -n apk -D dist
  echo "产物在 dist/"
else
  echo "已发布 v${version}：$(gh release view "v${version}" --json url --jq .url)"
fi
