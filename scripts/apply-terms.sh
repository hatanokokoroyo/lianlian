#!/usr/bin/env bash
# 给 docs/skills-zh/*.md 里的关键术语补上英文原词：接缝 → 接缝（seam）
# 每个术语在每个文件中只标注第一次出现；幂等，重复运行不再增加。
# 术语表见 docs/skills-zh/terms.tsv。用法：scripts/apply-terms.sh [file...]
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - "$@" <<'PY'
import pathlib, re, sys

pairs = []
for line in pathlib.Path('docs/skills-zh/terms.tsv').read_text(encoding='utf-8').splitlines()[1:]:
    if '\t' not in line:
        continue
    zh, en = (x.strip() for x in line.split('\t')[:2])
    if zh and en:
        pairs.append((zh, en))
pairs.sort(key=lambda t: -len(t[0]))          # 长词优先：先「垂直切片」后「切片」

targets = [pathlib.Path(a) for a in sys.argv[1:]] or sorted(pathlib.Path('docs/skills-zh').glob('*.md'))
changed = []

for p in targets:
    if p.suffix != '.md' or p.name in ('README.md',):
        continue
    text = orig = p.read_text(encoding='utf-8')

    # 1) 先把本术语表产生的标注全部摘掉，回到干净状态
    for zh, en in pairs:
        text = text.replace(f'{zh}（{en}）', zh)

    # 2) 每个术语只标注第一次出现（跳过已经紧跟中文括号的位置）
    #    以及跳过构成更长术语的位置：避免「阻塞」命中「阻塞边」
    for zh, en in pairs:
        pattern = re.compile(re.escape(zh) + r'(?!（)')
        for m in pattern.finditer(text):
            longer = [z for z, _ in pairs if z != zh and z.startswith(zh) and text.startswith(z, m.start())]
            if longer:
                continue
            text = text[:m.end()] + f'（{en}）' + text[m.end():]
            break

    if text != orig:
        p.write_text(text, encoding='utf-8')
        changed.append(p.name)

print(f'更新 {len(changed)} 个文件' + ('：' + ' '.join(changed) if changed else ''))
PY
