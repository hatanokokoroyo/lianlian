#!/usr/bin/env bash
# 检查中文译本是否落后于上游 skill 原文。
# 用法：scripts/check-skills-zh.sh [--strict]
#   退出码 0：全部一致（或只有未译项）；1：有译本 hash 与 lock 不符（--strict 时未译也算失败）
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - "$@" <<'PY'
import json, pathlib, re, sys

strict = '--strict' in sys.argv
lock = json.load(open('skills-lock.json'))['skills']
zh_dir = pathlib.Path('docs/skills-zh')

translated, stale, missing, not_needed = [], [], [], []
for name, meta in sorted(lock.items()):
    p = zh_dir / f'{name}.md'
    upstream = pathlib.Path(f'.agents/skills/{name}/SKILL.md')
    if not upstream.exists():
        not_needed.append(name)
        continue
    if not p.exists():
        missing.append(name)
        continue
    m = re.search(r'对应上游 hash：`([0-9a-f]+)`', p.read_text(encoding='utf-8'))
    want = meta['computedHash'][:16]
    if not m:
        stale.append((name, '未记录 hash'))
    elif not want.startswith(m.group(1)) and m.group(1) != want:
        stale.append((name, f'{m.group(1)} → {want}'))
    else:
        translated.append(name)

print(f'✓ 已译且同步：{len(translated)}')
print(f'✗ 需重译（上游已变）：{len(stale)}')
for n, why in stale:
    print(f'    {n}  ({why})')
print(f'· 未译：{len(missing)}')
print('    ' + ' '.join(missing) if missing else '')
if not_needed:
    print(f'· 未安装（跳过）：{len(not_needed)}  ' + ' '.join(not_needed))
sys.exit(1 if stale or (strict and missing) else 0)
PY
