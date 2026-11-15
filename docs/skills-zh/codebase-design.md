> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/codebase-design/SKILL.md`
> 对应上游 hash：`d40f025dc1b0f202`
> 来源：`mattpocock/skills`

# 代码库设计（Codebase Design）

设计**深模块（deep module）**：一个小的接口（interface）后面藏着大量行为，坐落在干净的接缝（seam）上，通过那个接口可测。凡是正在设计或重构代码的地方，都用这套语言与这些原则。目标是：调用者获得杠杆（leverage），维护者获得局部性（locality），所有人获得可测性。

## 词汇

严格使用这些术语：不要替换成「component」「service」「API」或「boundary」。语言一致正是全部要点。

**Module（模块（module））**：任何带有 interface 与 implementation 的东西。刻意做成尺度无关：一个函数、类、包，或横跨多层的切片（slice）。_避免用_：unit、component、service。

**Interface（接口）**：调用者要正确使用该模块所必须知道的一切：类型签名，但也包括不变量、顺序约束、错误模式、必需配置、性能特征。_避免用_：API、signature（太窄，只指类型层面的表面）。

**Implementation（实现）**：模块内部的东西，它的代码主体。与 **Adapter** 区分：一个东西可以是实现很大的小适配器（一个 Postgres 仓储），也可以是实现很小的大适配器（内存里的假实现）。话题是接缝时用「adapter」，否则用「implementation」。

**Depth（深度（depth））**：接口上的杠杆。调用者（或测试）每学一单位接口能驱动多少行为。模块的行为大量藏在很小接口后面时，它是**深**的；接口几乎和实现一样复杂时，它是**浅**的。

**Seam（接缝）** _(Michael Feathers)_：一个你可以在不编辑那个位置的前提下改变行为的地方；模块接口所在的*位置*。接缝放在哪是它自己的设计决策，与接缝后面放什么不同。_避免用_：boundary（与 DDD 的限界上下文混淆）。

**Adapter（适配器（adapter））**：在接缝上满足某个接口的具体东西。它描述的是*角色（role）*（占哪个槽），不是实质（里面是什么）。

**Leverage（杠杆）**：调用者从深度中得到的东西。每学一单位接口就多得一份能力。一份实现回报到 N 个调用点与 M 个测试。

**Locality（局部性）**：维护者从深度中得到的东西。改动、bug、知识、验证集中在一处，而不是散到调用者当中。修一次，处处已修。

## 深与浅

**深模块** = 小接口 + 大量实现：

```
┌─────────────────────┐
│   Small Interface   │  ← 方法少、参数简单
├─────────────────────┤
│                     │
│  Deep Implementation│  ← 复杂逻辑被藏起来
│                     │
└─────────────────────┘
```

**浅模块** = 大接口 + 少量实现（要避免）：

```
┌─────────────────────────────────┐
│       Large Interface           │  ← 方法多、参数复杂
├─────────────────────────────────┤
│  Thin Implementation            │  ← 只是往下转发
└─────────────────────────────────┘
```

设计接口时问自己：

- 能减少方法数量吗？
- 能简化参数吗？
- 能把更多复杂度藏进去吗？

## 原则

- **深度是接口的属性，不是实现的属性。** 深模块内部可以由小的、可 mock 的、可替换的部件组成；它们只是不属于接口。模块可以有**内部接缝**（实现私有，供自己的测试用），以及位于接口处的**外部接缝**。
- **删除测试（deletion test）。** 想象把这个模块删掉。如果复杂度消失了，它只是个转发层；如果复杂度在 N 个调用者那里重新出现，它在挣自己的饭。
- **接口就是测试表面。** 调用者与测试跨过同一个接缝。如果你想测到接口*之后*，模块大概是形状不对。
- **一个适配器意味着假想的接缝，两个适配器才是真接缝。** 除非确有东西在接缝两侧变化，否则别引入接缝。

## 为可测性而设计

好接口让测试变得自然：

1. **接收依赖，不要自己创建依赖。**

   ```typescript
   // 可测
   function processOrder(order, paymentGateway) {}

   // 难测
   function processOrder(order) {
     const gateway = new StripeGateway();
   }
   ```

2. **返回结果，不要产生副作用。**

   ```typescript
   // 可测
   function calculateDiscount(cart): Discount {}

   // 难测
   function applyDiscount(cart): void {
     cart.total -= discount;
   }
   ```

3. **表面面积要小。** 方法更少 = 需要的测试更少；参数更少 = 测试准备更简单。

## 关系

- 一个 **Module** 恰好有一个 **Interface**（它对调用者与测试呈现的表面）。
- **Depth** 是 **Module** 的属性，相对它的 **Interface** 衡量。
- **Seam** 是 **Module** 的 **Interface** 所在之处。
- **Adapter** 坐在 **Seam** 上，满足那个 **Interface**。
- **Depth** 为调用者产生 **Leverage**，为维护者产生 **Locality**。

## 被否弃的表述

- **把深度当成「实现行数 / 接口行数」的比值**（Ousterhout）：会奖励把实现灌水。我们改用「深度即杠杆」。
- **把「Interface」当成 TypeScript 的 `interface` 关键字或类的公开方法**：太窄；这里的接口包含调用者必须知道的一切事实。
- **「Boundary」**：与 DDD 的限界上下文混淆。请说 **seam** 或 **interface**。

## 深入

- **在给定依赖的前提下加深一簇模块**，见 [DEEPENING.md](../../.agents/skills/codebase-design/DEEPENING.md)：依赖分类（category）、接缝纪律、以「替换而非分层」的方式测试。
- **探索替代接口**，见 [DESIGN-IT-TWICE.md](../../.agents/skills/codebase-design/DESIGN-IT-TWICE.md)：起并行 subagent 用几种截然不同的方式设计接口，再按深度、局部性与接缝位置做比较。
