GitHub: #30
Status: resolved
Type: task
Blocked by: 28

# 30: 我的数据子页与根页摘要

**What to build:** 把基本属性、训练条件、本地数据从档案根页搬进独立子页；根页“我的数据”显示四行摘要：基本属性、测量、训练条件、本地数据。保存基本属性/训练条件或删除测量后，根页摘要更新。测量页与设置页保持现有功能，只调整根页入口。

**Blocked by:** 28

**Status:** resolved

- [x] 根页四行摘要可进入各自子页；测量/设置仍可进入。
- [x] 基本属性与训练条件保存后根页摘要更新；训练条件缺项摘要正确。
- [x] 本地数据子页显示现有容量表，根页只显示已用总量摘要。
- [x] 系统返回键与页面返回从各子页回到根页。
- [x] 更新 App/Profile/Measurements/Navigation/Storage 测试；`nsh check` / `nsh test` 通过。

## Comments

- 2026-11-17 交付：基本属性、训练条件、本地数据搬进独立子页；根页「我的数据」四行显示摘要与动作词。
- 验证：App/Profile/Measurements/Navigation/Storage 测试已改为子页路径；保存后返回根页摘要会更新，全量测试通过。
