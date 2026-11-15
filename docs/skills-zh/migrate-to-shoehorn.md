> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/migrate-to-shoehorn/SKILL.md`
> 对应上游 hash：`a63549df6d5b5c65`
> 来源：`mattpocock/skills`

# 迁移到 Shoehorn（migrate-to-shoehorn）

## 为什么要用 shoehorn？

`shoehorn` 让你在测试里传部分数据，同时让 TypeScript 满意。它用类型安全的替代品取代 `as` 断言。

**只用于测试代码。** 绝不在生产代码里用 shoehorn。

`as` 在测试里的问题：

- 我们被训练成不该用它
- 必须手工写出目标类型
- 想故意传错类型时得写双重 `as`（`as unknown as Type`）

## 安装

```bash
npm i @total-typescript/shoehorn
```

## 迁移模式

### 需要属性的「大对象」

改前：

```ts
type Request = {
  body: { id: string };
  headers: Record<string, string>;
  cookies: Record<string, string>;
  // ...还有 20 个属性
};

it("gets user by id", () => {
  // 只关心 body.id，却必须伪造整个 Request
  getUser({
    body: { id: "123" },
    headers: {},
    cookies: {},
    // ...伪造全部 20 个属性
  });
});
```

改后：

```ts
import { fromPartial } from "@total-typescript/shoehorn";

it("gets user by id", () => {
  getUser(
    fromPartial({
      body: { id: "123" },
    }),
  );
});
```

### `as Type` → `fromPartial()`

改前：

```ts
getUser({ body: { id: "123" } } as Request);
```

改后：

```ts
import { fromPartial } from "@total-typescript/shoehorn";

getUser(fromPartial({ body: { id: "123" } }));
```

### `as unknown as Type` → `fromAny()`

改前：

```ts
getUser({ body: { id: 123 } } as unknown as Request); // 故意类型不对
```

改后：

```ts
import { fromAny } from "@total-typescript/shoehorn";

getUser(fromAny({ body: { id: 123 } }));
```

## 各用哪个

| 函数 | 适用场景 |
| --- | --- |
| `fromPartial()` | 传部分数据，且仍需通过类型检查 |
| `fromAny()` | 传故意错的数据（保留自动补全） |
| `fromExact()` | 强制完整对象（以后可换成 fromPartial） |

## 工作流

1. **收集需求** —— 问用户：
   - 哪些测试文件里的 `as` 断言正在造成问题？
   - 是不是大对象、只有部分属性相关？
   - 需不需要为测错误路径而故意传错数据？

2. **安装并迁移**：
   - [ ] 安装：`npm i @total-typescript/shoehorn`
   - [ ] 找出带 `as` 断言的测试文件：`grep -r " as [A-Z]" --include="*.test.ts" --include="*.spec.ts"`
   - [ ] `as Type` 换成 `fromPartial()`
   - [ ] `as unknown as Type` 换成 `fromAny()`
   - [ ] 补上来自 `@total-typescript/shoehorn` 的 import
   - [ ] 跑类型检查验证
