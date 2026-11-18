window.SLIDES = window.SLIDES || [];
window.SLIDES.push(
  {
    id: "p01", section: "定位", time: "0:30", kind: "cover",
    html: `
      <p class="eyebrow">ask-matt · 一张路由表</p>
      <h1>37 个 skill，<br>怎么选？</h1>
      <p class="lede">不是背命令，是认处境。</p>
      <div class="coverRow">
        <span class="pill">22 页</span>
        <span class="pill">30–35 分钟</span>
        <span class="pill">2026-11</span>
      </div>
      <p class="foot">会选，比会背重要。</p>
    `,
    note: "今天不逐条讲 37 个 skill。只讲一张能带走的地图，再用我们自己项目的三次原型，说明这张地图怎么落到屏幕上。"
  },
  {
    id: "p02", section: "定位", time: "1:00", kind: "default",
    html: `
      <p class="eyebrow">先认处境</p>
      <h2>你现在手上是什么？</h2>
      <div class="routeGrid">
        <a class="route" href="#p03"><b>有想法，要做出来</b><span>主流程 · 从磨想法开始</span></a>
        <a class="route" href="#p11"><b>别人提了问题</b><span>triage · 先验证再 brief</span></a>
        <a class="route" href="#p11"><b>东西坏了</b><span>diagnosing-bugs · 先有红灯</span></a>
        <a class="route" href="#p10"><b>大得看不见路</b><span>wayfinder · 先画地图</span></a>
      </div>
      <p class="foot">点一个，deck 跳到那条路；四张卡就是四个入口。</p>
    `,
    note: "我们先不看目录。你手上是什么，就点哪个；这份 deck 本身就是一个 router。点“有想法”去主干，点“别人提了”去入口章，点“坏了”看诊断，点“看不见路”看 wayfinder。"
  },
  {
    id: "p03", section: "地图", time: "2:00", kind: "default",
    html: `
      <p class="eyebrow">主干</p>
      <h2>主干不是一条线</h2>
      <p class="lede">它是一条能被四个问题岔开的路。岔路不是例外，是常态。</p>
      <div class="flow">
        <div class="node"><b>磨想法</b><small>grill-with-docs</small></div>
        <span class="arw">→</span>
        <div class="node"><b>出规格</b><small>to-spec</small></div>
        <span class="arw">→</span>
        <div class="node"><b>拆工单</b><small>to-tickets</small></div>
        <span class="arw">→</span>
        <div class="node"><b>实现</b><small>implement / implement-spec</small></div>
        <span class="arw">→</span>
        <div class="node"><b>评审收尾</b><small>code-review · pr · retro</small></div>
      </div>
      <div class="forkline"><span>在这些地方分岔</span></div>
      <div class="forks">
        <div class="fork gold"><b>需要一个可跑的答案</b><small>handoff ⇄ prototype</small></div>
        <div class="fork rust"><b>一个会话装不下</b><small>wayfinder → to-spec</small></div>
        <div class="fork rust"><b>问题不是你提的</b><small>triage</small></div>
        <div class="fork green"><b>东西坏了</b><small>diagnosing-bugs</small></div>
      </div>
    `,
    note: "主干是 grill-with-docs 磨想法，to-spec 出规格，to-tickets 拆工单，然后 implement 或 implement-spec 实现，code-review 收评审，pr 写 PR，retro 复盘。但真正要记的不是这条线，是四个岔口：需要跑一下才能答的，去原型；一个会话装不下的，去 wayfinder 或拆票；不是你提的问题，去 triage；说不清的坏，去 diagnosing-bugs。"
  },
  {
    id: "p04", section: "地图", time: "0:45", kind: "wide",
    html: `
      <p class="eyebrow">分支特征 · 查阅页</p>
      <h2>先看这四列，再决定走哪条</h2>
      <table class="tbl">
        <thead>
          <tr><th>分支</th><th>触发</th><th>会话与上下文</th><th>关键产物</th><th>远端</th><th>典型失败</th></tr>
        </thead>
        <tbody>
          <tr><td><b>单会话</b></td><td>想清楚就能做</td><td>1 个窗口</td><td>代码 + 提交</td><td>可选</td><td>没留痕，别人接不了</td></tr>
          <tr><td><b>多会话</b></td><td>一窗装不下</td><td>每票一窗</td><td>spec + 工单 + 集成分支</td><td>必需，可降级</td><td>规格没定接缝，返工</td></tr>
          <tr><td><b>原型</b></td><td>需要可跑的答案</td><td>出去 / 回来</td><td>变体 + 结论</td><td>无</td><td>做成了 demo，没结论</td></tr>
          <tr><td><b>迷雾</b></td><td>路还看不见</td><td>一票一会话</td><td>map + 决策票</td><td>必需，原生阻塞</td><td>直接开工，边走边丢</td></tr>
          <tr><td><b>外部问题</b></td><td>别人提的 issue/PR</td><td>1</td><td>标签 + brief</td><td>必需</td><td>把已 ready 的再 triage</td></tr>
          <tr><td><b>硬 bug</b></td><td>说不清、偶发、回归</td><td>1</td><td>回归测试</td><td>无</td><td>没红灯就开始猜</td></tr>
        </tbody>
      </table>
      <p class="foot">三列决定今天的排班：会话数、上下文策略、关键产物。</p>
    `,
    note: "不逐行念。只看三列：会话数、上下文策略、关键产物。这三列决定你今天怎么排班：是继续在一个窗口里推，还是切票、开新窗口、或者先去做原型。"
  },
  {
    id: "p05", section: "地图", time: "1:30", kind: "default",
    html: `
      <p class="eyebrow">上下文卫生</p>
      <h2>一个会话装得下吗？</h2>
      <div class="cols2">
        <div class="card">
          <div class="k">主流程的铁律</div>
          <ul class="ticks">
            <li><b>1–3 步同一窗口</b><span>磨想法 → 出规格 → 拆工单，不能断</span></li>
            <li><b>每个 implement 全新</b><span>票是自包含的，上一票的上下文可丢</span></li>
            <li><b>retro 在 clear 之前</b><span>它要看的是这一场会话</span></li>
            <li><b>smart zone 约 150k</b><span>逼近就在阶段边界压缩，不要降智硬推</span></li>
          </ul>
        </div>
        <div class="card">
          <div class="k">阶段边界 · 从上往下排除</div>
          <ol class="steps">
            <li><b>Continue</b><span>下一步还需要这一段</span></li>
            <li><b>/clear</b><span>这里的上下文对下一步无价值</span></li>
            <li><b>/handoff</b><span>换 harness / 目录 / 同事 / 中途分叉</span></li>
            <li><b>Subagent</b><span>范围紧窄，只要一份报告</span></li>
            <li><b>/compact</b><span>默认，位于决策树底部</span></li>
          </ol>
        </div>
      </div>
      <p class="foot">默认是 compact，不是 handoff；handoff 买的是可携带性。</p>
    `,
    note: "主流程最容易错的是上下文：磨想法、出规格、拆工单这三步必须连着，不然 spec 会丢掉访谈里的 why。到了实现，每张票重新开始，因为票是自包含的。窗口逼近 150k 就在最近的阶段边界压缩。阶段边界的默认选择是 compact；handoff 只用于换 harness、换目录、交给同事，或者阶段中途分叉。"
  },
  {
    id: "p06", section: "分支", time: "1:00", kind: "default",
    html: `
      <p class="eyebrow">分支 · 单会话</p>
      <h2>最快的一条：聊清楚就做</h2>
      <div class="flow four">
        <div class="node"><b>磨想法</b><small>grill-with-docs</small></div>
        <span class="arw">→</span>
        <div class="node"><b>实现</b><small>implement / tdd</small></div>
        <span class="arw">→</span>
        <div class="node"><b>评审</b><small>code-review</small></div>
        <span class="arw">→</span>
        <div class="node"><b>复盘</b><small>retro</small></div>
      </div>
      <div class="cols2 mt">
        <div class="card">
          <div class="k">产物</div>
          <p class="bigline">代码 + 提交</p>
          <p class="muted">可能再加一份 PR 正文。</p>
        </div>
        <div class="card">
          <div class="k">不产生</div>
          <p class="bigline">spec · 工单 · 集成分支</p>
          <p class="muted">代价：后来要多人接手，得补一次纸面。</p>
        </div>
      </div>
    `,
    note: "这是最短的一条：聊清楚，直接做，评审，复盘。它没有 spec 和 ticket，所以快；代价是没有纸面痕迹。如果后来要多人接手，或者要跨会话继续，就得补 spec——那时候你已经多花了一次上下文。"
  },
  {
    id: "p07", section: "分支", time: "2:00", kind: "default",
    html: `
      <p class="eyebrow">分支 · 多会话</p>
      <h2>先把接缝定下来，再把活切开</h2>
      <div class="cols2">
        <div class="card">
          <div class="k">to-spec</div>
          <h3>规格不是文档，是决定</h3>
          <ul class="ticks">
            <li>问题 / 方案 / 长用户故事</li>
            <li>实现决策 / 测试决策 / 不在范围</li>
            <li><b>先定测试接缝</b><span>优先已有、尽量高、理想只有一个</span></li>
            <li>不写文件路径和代码片段</li>
          </ul>
        </div>
        <div class="card">
          <div class="k">to-tickets</div>
          <h3>垂直切片，不是层切片</h3>
          <div class="vslice">
            <div class="layers"><span>schema</span><span>API</span><span>UI</span></div>
            <div class="cut"></div>
          </div>
          <ul class="ticks">
            <li>每片穿过所有层、自身可演示、装进一个窗口</li>
            <li>每票声明<b>阻塞边</b>；宽重构走 expand–contract</li>
            <li>发布前盘问：粒度 / 边 / 合并或再拆</li>
          </ul>
        </div>
      </div>
    `,
    note: "spec 不写文件路径和代码片段，因为它们很快过期。真正要先定的是接缝：从哪儿测，能测到什么，漏掉什么。接缝确认完，再写 spec。拆票不是按层拆，是按垂直切片拆：每一票自己就能演示。宽重构是例外，一次机械改动炸遍全库，走 expand–contract：先加新形态，再分批迁移，最后删旧的。"
  },
  {
    id: "p08", section: "分支", time: "1:30", kind: "wide",
    html: `
      <p class="eyebrow">分支 · 实现</p>
      <h2>两种实现，差别是谁编排</h2>
      <table class="tbl compare">
        <thead><tr><th></th><th>implement</th><th>implement-spec</th></tr></thead>
        <tbody>
          <tr><td>谁编排</td><td>你</td><td>你编排，subagent 执行</td></tr>
          <tr><td>上下文</td><td>每票一个新窗口</td><td>每票一个 subagent</td></tr>
          <tr><td>并行</td><td>无</td><td>按 frontier 并行</td></tr>
          <tr><td>分支</td><td>当前分支</td><td>集成分支 + 每票 worktree</td></tr>
          <tr><td>收尾</td><td>每票 code-review</td><td>集成分支一次 code-review</td></tr>
          <tr><td>共同点</td><td colspan="2"><code>tdd</code> 建代码，<code>code-review</code> 收口</td></tr>
        </tbody>
      </table>
      <p class="foot">不是项目大小，是你愿意付哪种成本：逐票驱动，还是并行后合并。</p>
    `,
    note: "差别不是项目大小，是谁来编排。你愿意一票一票驱动、每票之间 clear，就用 implement。你愿意把任务图交给它、自己盯 frontier 和合并，就用 implement-spec。后者快，但要付 worktree 和合并的成本；前者慢，但每一票的上下文最干净。"
  },
  {
    id: "p09", section: "分支", time: "2:00", kind: "default",
    html: `
      <p class="eyebrow">分支 · 原型</p>
      <h2>原型只回答一个问题</h2>
      <div class="cols2">
        <div class="stack">
          <div class="card">
            <div class="k">问题 · 状态 / 逻辑</div>
            <h3>这个模型感觉对吗？</h3>
            <p class="muted">单文件 HTML：自由操作按钮 + 分页引导走查。</p>
          </div>
          <div class="card">
            <div class="k">问题 · UI</div>
            <h3>它该长什么样？</h3>
            <p class="muted">同一路由多套变体：URL 参数 + 浮动底栏切换。</p>
          </div>
          <div class="handoffLoop">
            <span>handoff 出去</span><b>→</b><span>prototype</span><b>→</b><span>handoff 回来</span>
          </div>
        </div>
        <div class="card">
          <div class="k">六条规则</div>
          <ol class="rules">
            <li><b>标明 throwaway</b><span>从第一天起</span></li>
            <li><b>一条命令能跑</b><span>双击或一个 task</span></li>
            <li><b>默认不持久化</b><span>状态在内存里</span></li>
            <li><b>不抛光</b><span>没有测试和抽象</span></li>
            <li><b>暴露状态</b><span>每次操作后打印</span></li>
            <li><b>做完留存</b><span>答案回填，原型进分支</span></li>
          </ol>
        </div>
      </div>
    `,
    note: "原型不是“做个 demo”，是回答一个问题。问题的形状决定原型的形状：逻辑问题做成能按键的单页，UI 问题做成同一条路由上的多个变体。六条规则里最重要的是两条：从第一天就标明是 throwaway，以及做完必须留下结论。否则你会得到一堆漂亮 HTML，但没人记得它回答了什么。"
  },
  {
    id: "p10", section: "分支", time: "1:30", kind: "default",
    html: `
      <p class="eyebrow">分支 · 迷雾</p>
      <h2>wayfinder 产出决策，不产出交付物</h2>
      <div class="cols2">
        <div class="card mapCard">
          <div class="k">map · 一张共享地图</div>
          <div class="mapRow"><span>Destination</span><em>到哪算到</em></div>
          <div class="mapRow"><span>Notes</span><em>领域与标准偏好</em></div>
          <div class="mapRow"><span>Decisions so far</span><em>已解票的一行摘要</em></div>
          <div class="mapRow"><span>Not yet specified</span><em>还说不清的雾</em></div>
          <div class="mapRow"><span>Out of scope</span><em>不在这张地图上</em></div>
        </div>
        <div class="stack">
          <div class="cols2 tight">
            <div class="mini"><b>research</b><span>AFK</span></div>
            <div class="mini"><b>prototype</b><span>HITL</span></div>
            <div class="mini"><b>grilling</b><span>HITL</span></div>
            <div class="mini"><b>task</b><span>HITL / AFK</span></div>
          </div>
          <div class="card">
            <div class="k">frontier</div>
            <p class="bigline">未关闭 · 无阻塞 · 无认领</p>
            <p class="muted">一次只解一票（research 除外）；地图清晰后交棒 <code>to-spec</code>。</p>
          </div>
        </div>
      </div>
    `,
    note: "wayfinder 产出的是决策，不是交付物。它把“从这里到目的地”画成一张共享地图，一次解一个决策票。每解一票，雾往后退一点，新票才长出来。地图清晰之后不要直接开工，先交给 to-spec 把互链的决策压成可构建计划，否则会丢掉关联细节。"
  },
  {
    id: "p11", section: "分支", time: "2:00", kind: "default",
    html: `
      <p class="eyebrow">入口与盲区</p>
      <h2>三种“不是从想法开始”的活</h2>
      <div class="cols3">
        <div class="card">
          <div class="k">triage · 别人提的</div>
          <ul class="ticks">
            <li>五状态：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix</li>
            <li>先验证说法，再 grill，再写 brief</li>
            <li>拒绝的需求进 <code>.out-of-scope/</code></li>
          </ul>
        </div>
        <div class="card">
          <div class="k">diagnosing-bugs · 坏了</div>
          <ul class="ticks">
            <li><b>先有一条已经变红的命令</b></li>
            <li>再最小化、假设、仪器、回归测试</li>
            <li>没有正确接缝，本身就是发现</li>
          </ul>
        </div>
        <div class="card">
          <div class="k">独立工具</div>
          <p class="mono small">grill-me · research · to-questionnaire · wizard · teach · wait-what · writing-for-agents</p>
          <p class="muted">不接主干，按需单独用。</p>
        </div>
      </div>
      <div class="blindspot">
        <div class="k">盲区 · ask-matt 覆盖 26/37</div>
        <p class="mono">chief-of-staff · claude-handoff · loop-me · writing-beats / fragments / shape · migrate-to-shoehorn · scaffold-exercises · setup-pre-commit · setup-ts-deep-modules · git-guardrails-claude-code</p>
      </div>
    `,
    note: "这两个入口最容易混。triage 只处理不是你提的问题；to-tickets 产出的票已经是 ready-for-agent，不要再 triage。diagnosing-bugs 的纪律是反直觉的：没有一条已经在这个 bug 上变红的命令，不许开始猜。最后一行是盲区：ask-matt 不是全覆盖，11 个 skill 它没路由；不是不重要，是需要你知道它们存在。"
  }
);
