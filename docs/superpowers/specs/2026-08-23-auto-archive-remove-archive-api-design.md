# 任务完成自动归档与归档接口移除设计

## 背景与目标

当前 Feature Kanban 把生命周期完成与卡片归档拆成两次写入：`PATCH /api/cards/{cardId}` 保存 `completed / integrated` 快照，随仓库发布的 `feature-lifecycle` Skill 在删除 feature 分支后再调用 `PATCH /api/cards/{cardId}/archive`。同一归档接口也支撑看板详情中的手工“归档/取消归档”操作。

本次将“完成”设为归档的唯一触发条件：卡片接收 `completed / integrated` 快照时在同一个仓储事务内自动归档。独立归档接口、前端手工归档入口和 Skill 的二次归档调用全部删除。所有 Skill 看板 HTTP 调用使用精确 500ms 超时。

不对现有 SQLite 数据做回填、清理或兼容迁移。

## 方案选择

采用仓储快照派生方案。`CardRepository.createCard` 和 `CardRepository.updateCard` 依据本次输入的 `stage` 写入 `archived`：`completed` 写入 `1`，其他阶段写入 `0`。这使快照与归档标记在同一 SQLite 事务内提交，不存在完成态已保存但归档调用丢失的窗口。合法阶段回退仍通过后续非 `completed` 快照自动恢复为进行中。

不采用“路由更新后再调用 `setArchived`”，因为它保留两次写入与中间态；不采用“仅在前端把 completed 投影到已归档”，因为它会使服务端筛选、项目计数和持久化状态不一致。保留独立归档接口作为低侵入兼容层虽然改动更少，但不符合已批准的接口删除要求。

## 服务端与契约

`src/server/card-repository.ts` 将归档状态合并到创建和完整快照更新。删除可被路由或其他调用者任意设置归档位的 `setArchived` 方法。已存储记录不会在启动时被扫描或修改；它们只在收到新快照时按新规则写入。

`src/server/routes.ts` 删除 `PATCH /api/cards/{cardId}/archive` 分支。该路径之后落入现有 API 404 响应。`src/shared/lifecycle-validation.ts` 删除归档请求体校验器。`src/shared/lifecycle-contract.ts` 删除仅由该路由发布的 `card.archived` SSE 事件类型；完成快照仍发布 `card.updated`，已有定向刷新因此能把卡片从进行中投影移除并更新项目计数。

数据库表、`archived` 字段、`GET /api/cards?archived=...` 筛选、项目 `activeCount/archivedCount` 聚合和已归档视图保留不变。

## 看板交互

`web/src/app/core/card-api.service.ts` 删除 `setArchived` 调用和 `card.archived` 事件解析。`web/src/app/core/board-store.ts` 删除详情抽屉的归档请求协调。`web/src/app/board/card-detail.component.ts` 及其模板、样式删除归档输出和操作按钮；详情仍可从进行中或已归档视图打开。`web/src/app/board/board-page.component.html` 删除已失效的事件绑定。

进行中/已归档视图切换、项目与工具筛选、卡片详情、会话导航、spec 预览与 SSE 刷新机制都保留。前端不提供对未完成卡片手工归档或对完成卡片取消归档的途径。

## Feature Lifecycle Skill

仓库中可发布的 `skills/feature-lifecycle` 是本次同步对象。`SKILL.md`、`references/stage-5-integration.md` 和 `references/feature-kanban-api.md` 将统一表达：成功整合 base 后发起的 `completed / integrated` 完整 PATCH 会自动归档；清理 worktree 和 feature 分支后不再调用任何归档端点。`references/phase-2-lifecycle-plan.md` 和 API 参考中的调用约束统一为每次 Feature Kanban HTTP 调用精确 500ms 超时、丢弃响应、失败不记录不重试且不阻塞。

现有 PowerShell 示例的 `Invoke-RestMethod -TimeoutSec 2` 不能精确表达 500ms，因为该参数为整数秒。示例改用 `System.Net.Http.HttpClient`，将 `Timeout` 设为 `[TimeSpan]::FromMilliseconds(500)`，再直接发送内存中的 JSON 请求；必须在 `finally` 中释放 request/client，且不解析响应体。其他运行时使用等价的原生毫秒超时机制。

## 错误和运行边界

完成快照的归档与其他卡片字段一起事务提交；更新失败时两者一起回滚。非 `completed` 快照不识别原归档原因，始终把卡片设为进行中，以保留现有阶段回退语义。旧版客户端调用已删除的归档路由时收到 404；不增加兼容路由或数据修复。

Skill 对看板的任何 POST/PATCH 在 500ms 内未完成时按失败处理，丢弃该调用并继续本地生命周期，不启动、修复或重试看板服务。

## 变更面契约

交付目标是完成快照自动归档、删除独立归档 API 及手工交互，并同步仓库中的 Feature Lifecycle Skill 为 500ms 看板超时。

预计修改的生产面为：

- `src/server/card-repository.ts`：卡片创建与快照更新的归档派生语义，并删除手工归档写入入口。
- `src/server/routes.ts`、`src/shared/lifecycle-validation.ts`、`src/shared/lifecycle-contract.ts`：删除归档 REST 路由、请求体校验与专用 SSE 事件。
- `web/src/app/core/card-api.service.ts`、`web/src/app/core/board-store.ts`、`web/src/app/board/card-detail.component.ts`、`web/src/app/board/card-detail.component.html`、`web/src/app/board/card-detail.component.css`、`web/src/app/board/board-page.component.html`：删除手工归档的客户端协作与操作面。
- `skills/feature-lifecycle/SKILL.md`、`skills/feature-lifecycle/references/phase-2-lifecycle-plan.md`、`skills/feature-lifecycle/references/feature-kanban-api.md`、`skills/feature-lifecycle/references/stage-5-integration.md`：完成自动归档与精确 500ms 超时调用规则。

预计修改现有服务端、Angular 和 Skill 测试以替换过期的手工归档断言。生产业务状态转换已改变，因此测试策略触发；现有 `test/server/card-repository.test.ts`、`test/server/http-api.test.ts`、`web/src/app/core/board-store.spec.ts`、`web/src/app/board/board-page.component.spec.ts` 和 `test/skill/feature-lifecycle-reporting.test.ts` 已覆盖相同路径，因此只更新或删除其中过期用例，不新建测试文件。

受保护行为包括：八阶段快照契约及合法回退、完整 PATCH 最后写入者覆盖、看板非阻塞与不重试、回环与 Origin 安全边界、项目和工具筛选、已归档视图、项目可见性、会话历史与跳转、本地资源访问、SSE 定向刷新、Git/worktree 权威性以及 Skill Stage 4/5 的评审、验证、整合和清理门禁。

不新增生产模块、数据表、字段、迁移、权限、重试、后台任务或外部依赖。删除归档接口和手工交互会造成有意的公共契约破坏，完成快照归档时点由“feature 分支删除后的独立调用”前移到“base 成功整合后的 completed 快照”。用户已在看到该影响、旧数据不迁移和低侵入替代后明确批准。

## 验证

专项验证要证明：创建或更新为 `completed / integrated` 的卡片立即出现在 `archived=true` 查询且不出现在进行中查询；后续合法回退快照重新激活卡片；归档路由返回 404；前端不发送归档请求且不渲染手工归档按钮；Skill 不再描述或调用归档端点，所有看板调用规则和 PowerShell 示例明确使用 500ms。

完整质量门禁为 `npm run check`，然后运行 `npm run build`。执行 Node.js 命令前按项目指令确认 nvm-windows 当前版本为已安装的 Node.js 24，并从 nvm 管理路径显式调用 `npm.cmd`。
