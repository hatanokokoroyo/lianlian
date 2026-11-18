window.SLIDES = window.SLIDES || [];
window.SLIDES.push(
  {
    id: "p12", section: "案例", time: "1:30", kind: "default",
    html: `
      <p class="eyebrow">案例 · 工具</p>
      <h2>OpenDesign 在哪一格</h2>
      <div class="cols2 odSplit">
        <div class="stack">
          <div class="role"><span class="k">人看</span><b>localhost:7456</b><em>看屏、批注、决定</em></div>
          <div class="role"><span class="k">agent 写</span><b>MCP 写屏</b><em>一屏一个 HTML，改完即看</em></div>
          <div class="role"><span class="k">git 存</span><b>版本真源</b><em>OD 不是真源</em></div>
          <p class="callout">它不替代任何 Matt 环节；它把 <code>/prototype</code> 的「做出来给人看」变便宜。</p>
        </div>
        <figure class="shot frame fit">
          <img src="assets/screens/od-workbench.png" alt="OpenDesign 工作台：左侧设计文件、中间对话、右侧实时预览">
          <figcaption>OpenDesign 工作台 · 左侧文件、中间对话、右侧预览（本项目）</figcaption>
        </figure>
      </div>
      <p class="foot">边界：OD 产出「看着对」；实现只认 <code>contract.md</code>。</p>
    `,
    note: "OpenDesign 是工作台，不是流程。它解决的是 UI 问题在对话里说不清的那一段：人在浏览器里看，agent 直接改同一份文件，改完刷新就能看。我们把 design/ 作为 OD 项目根，原地读写；一屏一个 HTML；Tailwind 4 + shadcn token；每个可交互元素带 data-testid；视口 360×800。它没有改变 Matt 的分支结构，只是把原型这一步的手更快、眼更准。"
  },
  {
    id: "p13", section: "案例", time: "2:30", kind: "default",
    html: `
      <p class="eyebrow">案例一 · 2026-11-15</p>
      <h2>三方向 → 九屏 → 契约</h2>
      <div class="caseGrid">
        <div class="timeline">
          <div class="tl"><span>20:19</span><b>3 个方向 × 2 屏</b><em>A 铁馆 · B 台账 · C 节拍</em></div>
          <div class="tl"><span>20:32</span><b>C 铺满 9 屏</b><em>可交互原型</em></div>
          <div class="tl"><span>20:40</span><b>五轴全显 + contract</b><em>token / 组件 / 状态 / testID</em></div>
          <p class="muted small">提交时间只说明迭代密度，不代表决策时间。</p>
        </div>
        <div class="shotGroups">
          <div>
            <div class="k">3 方向 · 每方向两屏</div>
            <div class="dirs">
              <div class="dirCol"><div class="dirLabel">A 铁馆</div>
                <img src="assets/screens/today-iron.png" alt="">
                <img src="assets/screens/profile-iron.png" alt="">
              </div>
              <div class="dirCol"><div class="dirLabel">B 台账</div>
                <img src="assets/screens/today-ledger.png" alt="">
                <img src="assets/screens/profile-ledger.png" alt="">
              </div>
              <div class="dirCol"><div class="dirLabel">C 节拍</div>
                <img src="assets/screens/today-pulse.png" alt="">
                <img src="assets/screens/profile-pulse.png" alt="">
              </div>
            </div>
          </div>
          <div>
            <div class="k">C · 9 屏</div>
            <div class="shots nine">
              <figure><img src="assets/screens/today-pulse.png" alt=""><figcaption>今日</figcaption></figure>
              <figure><img src="assets/screens/calendar-pulse.png" alt=""><figcaption>日历</figcaption></figure>
              <figure><img src="assets/screens/day-detail-pulse.png" alt=""><figcaption>日详情</figcaption></figure>
              <figure><img src="assets/screens/profile-pulse.png" alt=""><figcaption>档案</figcaption></figure>
              <figure><img src="assets/screens/conversation-list-pulse.png" alt=""><figcaption>会话</figcaption></figure>
              <figure><img src="assets/screens/conversation-pulse.png" alt=""><figcaption>对话</figcaption></figure>
              <figure><img src="assets/screens/measurements-pulse.png" alt=""><figcaption>趋势</figcaption></figure>
              <figure><img src="assets/screens/onboarding-pulse.png" alt=""><figcaption>引导</figcaption></figure>
              <figure><img src="assets/screens/settings-pulse.png" alt=""><figcaption>设置</figcaption></figure>
            </div>
          </div>
        </div>
      </div>
      <p class="foot">三方向是 throwaway 比较；九屏是视觉基准；contract 才是实现形态。</p>
    `,
    note: "同一天晚上，先三个方向各两屏，每屏都带真实状态，不是空壳；然后选 C，把 9 屏全铺出来；再往下，五轴全显，写 contract。这里要分清三样东西：三方向是 throwaway 比较；九屏是选定方向的铺全，已经是视觉基准；contract 才是它进入实现的形态。选完立刻收口，是为了不让漂亮原型变成第二套真源。"
  },
  {
    id: "p14", section: "案例", time: "3:00", kind: "default",
    html: `
      <p class="eyebrow">案例二 · 2026-11-17</p>
      <h2>档案 IA 改版：四变体选 D</h2>
      <div class="shots ia">
        <figure><img src="assets/screens/ia-a.png" alt=""><figcaption>A · 目录</figcaption></figure>
        <figure><img src="assets/screens/ia-b.png" alt=""><figcaption>B · 关注优先</figcaption></figure>
        <figure><img src="assets/screens/ia-c.png" alt=""><figcaption>C · 筛选</figcaption></figure>
        <figure><img src="assets/screens/ia-d.png" alt=""><figcaption>D · 组合</figcaption></figure>
      </div>
      <div class="caseBottom">
        <div class="card">
          <div class="k">结论</div>
          <p class="bigline">D · 组合</p>
          <p class="muted">计划 → 需处理肌群 → 全部区域 → 我的数据</p>
        </div>
        <div class="card">
          <div class="k">原型反过来纠正了模型</div>
          <p class="bigline">23 肌群 + 8 骨骼区域</p>
          <p class="muted">不是 8 个身体区域；原型只用了 10 个代表区域做样本。</p>
        </div>
        <div class="card">
          <div class="k">落地</div>
          <p class="mono">prototype.md → spec（30 条故事）→ #28–31 → 测试 → contract</p>
          <p class="muted">A/B/C 只作对比，不进实现。</p>
        </div>
      </div>
    `,
    note: "这次不是选风格，是选信息架构。四个变体只变根页结构：先看计划、先看异常、先筛选，还是组合。D 是把三者合成一页。最有价值的不是 D 本身，是原型逼出了一个领域事实：真实读模型是 23 个肌群加 8 个骨骼区域，不是 8 个身体区域；原型只用了 10 个代表区域做样本。如果根页想收成 8 个粗区域，那是另一个决策。原型不只改像素，它会改模型。"
  },
  {
    id: "p15", section: "案例", time: "2:00", kind: "default",
    html: `
      <p class="eyebrow">为什么是必要与助力</p>
      <h2>OpenDesign 让答案变便宜，Matt 让答案变可用</h2>
      <table class="tbl">
        <thead><tr><th>作用</th><th>Matt 产物</th><th>在本项目里的证据</th></tr></thead>
        <tbody>
          <tr><td><b>定坐标</b></td><td><code>GLOSSARY.md</code> / ADR</td><td>档案条目、部位、区域、五轴定住；23 肌群 + 8 骨骼区域</td></tr>
          <tr><td><b>定问题与答案</b></td><td><code>prototype</code> / <code>handoff</code> / <code>prototype.md</code></td><td>一条 URL 切四变体；回来的是结论，不是 842 行 HTML</td></tr>
          <tr><td><b>定落地</b></td><td><code>spec</code> / <code>tickets</code> / <code>contract</code> / <code>code-review</code></td><td>D 进 spec；30 条故事；#28–31；contract 锁 token 与 testID</td></tr>
        </tbody>
      </table>
      <div class="cols2 mt">
        <div class="callout"><b>必要</b><span>需要跑一下才能答的问题，散文答不了；没有轨道，原型只是死胡同。</span></div>
        <div class="callout green"><b>助力</b><span>变体更便宜、答案更清楚、落地更短；原型不再是一次性表演。</span></div>
      </div>
      <div class="evidence">
        <div><b>A5 · prototype.md</b><span>原型 842 行；结论 D 写进文件，A/B/C 不进实现。</span></div>
        <div><b>A6 · spec.md</b><span>「本 spec 采用已选定的 D · 组合 原型。」</span></div>
        <div><b>A4 · contract.md</b><span>「不许从原型里抄 HTML 结构、类名堆叠方式或 inline style。」</span></div>
      </div>
      <p class="quote">原型负责看见，Matt 负责看见之后不再走丢。</p>
    `,
    note: "没有 glossary，四个变体会变成四个产品；没有 prototype.md，842 行 HTML 会变成死胡同；没有 spec 和 tickets，D 只是一句“我们用 D 吧”；没有 contract，实现会去抄原型 HTML 的结构。所以原型不是 Matt 的替代品，它是 Matt 的一个分支；Matt 的产物是它的入口、出口和落地轨道。"
  },
  {
    id: "p16", section: "产物", time: "1:30", kind: "default",
    html: `
      <p class="eyebrow">目录</p>
      <h2>三类目录，三个权威</h2>
      <div class="cols2">
        <pre class="tree">/
├─ GLOSSARY.md              # 领域语言
├─ docs/adr/                # 难逆决策
├─ docs/agents/             # tracker / triage / domain
├─ .scratch/&lt;feature&gt;/      # agent 工作副本
│  ├─ spec.md
│  ├─ issues/NN-*.md
│  ├─ prototype.md
│  └─ map.md
├─ .out-of-scope/           # 拒绝的需求
├─ design/                  # 原型 + 视觉契约
│  ├─ screens/
│  ├─ tokens/
│  └─ contract.md
└─ src/ + screens/          # NSH 实现</pre>
        <div class="stack">
          <div class="card"><div class="k">知识</div><p class="bigline">GLOSSARY · ADR</p><p class="muted">长期、权威、给人也给 agent。</p></div>
          <div class="card"><div class="k">工作副本</div><p class="bigline">.scratch</p><p class="muted">agent 读的东西；换机器靠 git 带走。</p></div>
          <div class="card"><div class="k">视觉</div><p class="bigline">design</p><p class="muted">原型给人看；contract 给实现看。</p></div>
          <p class="callout">权威顺序：GitHub issue &gt; 本地镜像；<code>contract.md</code> &gt; 原型 HTML。</p>
        </div>
      </div>
    `,
    note: "这棵树只要记三类。知识类是 glossary、ADR、agent 约定；工作副本是 .scratch，它是 agent 读的东西；视觉类是 design，原型和契约。权威顺序要背下来：远端 issue 是编号权威，本地镜像是工作副本；contract 是实现唯一认的东西，原型 HTML 只是给人看的视觉基准。"
  },
  {
    id: "p17", section: "产物", time: "0:45", kind: "wide",
    html: `
      <p class="eyebrow">本地产物 · 查阅页</p>
      <h2>谁写、活多久、给谁看</h2>
      <table class="tbl compact">
        <thead><tr><th>产物</th><th>谁写</th><th>生命周期</th><th>入库</th><th>给谁看</th></tr></thead>
        <tbody>
          <tr><td><code>GLOSSARY.md</code> / ADR</td><td>grill-with-docs / domain-modeling</td><td>长期</td><td>是</td><td>团队 + agent</td></tr>
          <tr><td><code>spec.md</code></td><td>to-spec</td><td>到交付</td><td>是</td><td>agent + 团队</td></tr>
          <tr><td><code>issues/NN-*.md</code></td><td>to-tickets</td><td>到关闭</td><td>是</td><td>agent</td></tr>
          <tr><td><code>map.md</code></td><td>wayfinder</td><td>到交棒</td><td>是</td><td>团队</td></tr>
          <tr><td><code>prototype.md</code></td><td>prototype 回来时</td><td>长期</td><td>是</td><td>团队 + 未来 agent</td></tr>
          <tr><td>research 笔记</td><td>research</td><td>按需</td><td>视结论</td><td>agent</td></tr>
          <tr><td><code>contract.md</code></td><td>原型定稿后</td><td>长期</td><td>是</td><td>实现 + 评审</td></tr>
          <tr><td>handoff</td><td>handoff</td><td>一次会话</td><td><b>否</b>（<code>$TMPDIR</code>）</td><td>接手人</td></tr>
          <tr><td>架构报告</td><td>improve-codebase-architecture</td><td>一次</td><td><b>否</b>（<code>$TMPDIR</code>）</td><td>当前人</td></tr>
          <tr><td><code>.env</code> / secrets</td><td>wizard</td><td>长期</td><td><b>否</b></td><td>本机 / CI</td></tr>
        </tbody>
      </table>
    `,
    note: "只强调两行：handoff 和架构报告写在系统临时目录，不进仓库；它们是给当前这个人或接手人的，不是团队资产。.scratch 入库，但它是 agent 工作副本，不是团队文档——团队该看 GitHub issue。"
  },
  {
    id: "p18", section: "产物", time: "0:45", kind: "wide",
    html: `
      <p class="eyebrow">远端 · 查阅页</p>
      <h2>远端不止 GitHub</h2>
      <table class="tbl">
        <thead><tr><th>类别</th><th>谁用</th><th>是否必须</th><th>不可用时</th></tr></thead>
        <tbody>
          <tr><td><b>GitHub issue / PR</b></td><td>to-spec · to-tickets · triage · wayfinder · pr</td><td>语义上必须</td><td>本地先写 <code>GitHub: pending</code></td></tr>
          <tr><td><b>npm registry</b></td><td>setup-* · migrate-to-shoehorn</td><td>仅安装时</td><td>依赖已装则可继续</td></tr>
          <tr><td><b>web 一手资料</b></td><td>research · teach · diagnosing-bugs</td><td>质量依赖</td><td>标注「未核实」</td></tr>
          <tr><td><b>第三方后台</b></td><td>wizard</td><td>人工必须</td><td>改为人工清单</td></tr>
          <tr><td><b>Anthropic CLI</b></td><td>claude-handoff</td><td>可选</td><td>用普通 handoff</td></tr>
        </tbody>
      </table>
      <p class="callout mt">对工作流语义，tracker 是必须的；对单个 session，不是：双写 + <code>pending</code> 让工作不停。</p>
    `,
    note: "是否必须要分两层。对工作流语义，tracker 是必须的：编号、阻塞边、团队可见都靠它。对单个 session，不是必须的：本仓库双写，gh 不可用就写 pending，工作不停。另外，远端不止 GitHub：装依赖、查一手资料、点第三方后台，都是不同类别的远端。"
  },
  {
    id: "p19", section: "团队", time: "1:30", kind: "default",
    html: `
      <p class="eyebrow">团队协作</p>
      <h2>哪些文件该共享？</h2>
      <p class="lede">别只问「在不在 git 里」，问三个问题：它是权威吗？它随仓库走吗？它含敏感值吗？</p>
      <div class="matrix">
        <div></div>
        <div class="axis">随仓库走（clone 即得）</div>
        <div class="axis">靠外部服务 / 本机</div>
        <div class="axis v">权威</div>
        <div class="cell"><b>必须共享，且要 review</b><span>GLOSSARY.md · docs/adr/ · spec 镜像 · 工单镜像 · CODING_STANDARDS.md</span></div>
        <div class="cell"><b>必须共享，但只能给链接</b><span>GitHub issue / PR · 标签 · issue 编号</span></div>
        <div class="axis v">派生 / 临时</div>
        <div class="cell"><b>可入库，但不是权威</b><span>中文译本 · 这份 deck · cheatsheet · prototype 分支 · research 笔记</span></div>
        <div class="cell"><b>只本地，给接手人就够</b><span>handoff · 架构报告 · subagent 笔记 · 调试捕获 · .env</span></div>
      </div>
      <p class="callout mt">第三问单独一条：secrets 只共享配置方法，不共享值。</p>
    `,
    note: "别只问在不在 git 里。权威的、随仓库走的，必须共享并 review；权威的、靠服务的，给链接，比如 issue 和 PR；派生的、随仓库走的，可以入库，但要标明不是权威；派生的、不随仓库走的，只给接手人。最后，secrets 是另一条轴：方法可以共享，值永远不。"
  },
  {
    id: "p20", section: "团队", time: "0:45", kind: "wide",
    html: `
      <p class="eyebrow">本仓库落地 · 查阅页</p>
      <h2>原版是骨架，这里是适配层</h2>
      <table class="tbl">
        <thead><tr><th>事项</th><th>本仓库做法</th></tr></thead>
        <tbody>
          <tr><td>issue</td><td>GitHub 权威编号 + <code>.scratch</code> 镜像，双写</td></tr>
          <tr><td>自己提的 issue</td><td>跳过 <code>needs-triage</code>，直接 <code>ready-for-agent</code></td></tr>
          <tr><td>标签</td><td>五个 canonical，未改名</td></tr>
          <tr><td><code>gh</code></td><td>2.45.0；子 issue / 阻塞走 <code>gh api</code> + database id</td></tr>
          <tr><td>setup skill</td><td>已卸载；配置在 <code>AGENTS.md</code> + <code>docs/agents/</code></td></tr>
          <tr><td>并发</td><td>单 agent 顺序；wayfinder 例外，用 assignee 认领</td></tr>
        </tbody>
      </table>
      <p class="foot">skill 文本里让你跑 <code>/setup-matt-pocock-skills</code> 的地方，在本仓库可以忽略。</p>
    `,
    note: "这一页是原版 vs 我们。Matt 的原版是骨架，本仓库加了一层适配：双写、五个标签、自己提的跳过 triage、旧版 gh 的 API 回退。最重要的一句：skill 文本里让你跑 /setup-matt-pocock-skills 的地方，在本仓库可以忽略，配置已经在 AGENTS.md 和 docs/agents 里。"
  },
  {
    id: "p21", section: "收尾", time: "1:30", kind: "default",
    html: `
      <p class="eyebrow">误用</p>
      <h2>五个最常见的走错</h2>
      <div class="misuse">
        <div><b>1</b><span class="bad">triage 自己提的 / 已经 ready 的票</span><span class="good">只收别人提的；to-tickets 产物已 ready</span></div>
        <div><b>2</b><span class="bad">把 handoff 当默认的阶段边界</span><span class="good">默认是 compact；handoff 只买可携带性</span></div>
        <div><b>3</b><span class="bad">主流程 1–3 步中途 /clear</span><span class="good">磨想法 → 规格 → 工单同一窗口</span></div>
        <div><b>4</b><span class="bad">把 .scratch 当团队文档</span><span class="good">它是 agent 工作副本；团队看 GitHub issue</span></div>
        <div><b>5</b><span class="bad">把路由摘要当 skill 行为</span><span class="good">摘要只导航；执行前读 SKILL.md 原文</span></div>
      </div>
      <p class="quote">走错的共同点：把流程当命令，而不是当判断。</p>
    `,
    note: "每条给一个症状和纠正。triage 只收别人的；handoff 只用于换 harness、目录、同事或中途分叉；磨想法到拆工单这三步不能断；.scratch 是给 agent 的工作副本；摘要只用于导航，执行前读 SKILL.md 原文。"
  },
  {
    id: "p22", section: "收尾", time: "1:00", kind: "closing",
    html: `
      <p class="eyebrow">带走</p>
      <h2>一张纸，两个表</h2>
      <div class="closingGrid">
        <div class="paperMini">
          <div class="pmHead">matt-workflow · 带走件</div>
          <div class="pmTitle">处境 → 分支 → 第一步</div>
          <div class="pmRows">
            <span>有想法，能想清 · 单会话 · 磨想法</span>
            <span>一窗装不下 · 多会话 · 出规格</span>
            <span>需要跑一下 · 原型 · handoff 出去</span>
            <span>路看不见 · wayfinder · 画 map</span>
            <span>别人提的 · triage · 先验证</span>
          </div>
          <div class="pmTitle">产物 → 落点</div>
          <div class="pmRows">
            <span>GLOSSARY / ADR · 仓库根 / docs</span>
            <span>spec / tickets · .scratch</span>
            <span>contract · design/</span>
            <span>handoff · $TMPDIR</span>
          </div>
        </div>
        <div class="stack">
          <div class="card"><div class="k">三个入口</div><p class="mono small">SKILL.md 原文 · docs/agent-workflows.md · docs/skills-zh/</p></div>
          <div class="card"><div class="k">更新</div><p class="mono small">skills-lock.json → check-skills-zh.sh → audit-skills.mjs</p></div>
          <p class="quote">先认处境，再选 skill；<br>先留决策，再写代码。</p>
        </div>
      </div>
    `,
    note: "会后不用记 37 个名字，拿这张 A4 就够。要执行的时候，回到英文原文，不要背摘要。上游更新后先跑对账：锁文件、中文译本检查、skills.js 对账。最后一句：先认处境，再选 skill；先留决策，再写代码。"
  }
);
