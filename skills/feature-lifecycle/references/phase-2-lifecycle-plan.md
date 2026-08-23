# Phase 2：生成生命周期计划文档

在 feature worktree 创建：

```text
docs/feature/YYYY-MM-DD-<feature-slug>.md
```

内容必须使用以下模板：

```markdown
# [功能名称] — 生命周期计划

**创建日期**: YYYY-MM-DD
**Worktree**: <worktree-path>
**分支**: feat/YYYY-MM-DD-<feature-slug>
**Base 分支**: <base-branch>
**Initial Base SHA**: <initial-base-sha>
**需求文档**: <现有需求文档路径 | 由 Stage 1 spec 生成>
**Spec 文档路径**: <由 Stage 1 生成后回填 | 暂无>
**项目基准设计文档**: <path | 无>
**AI 工具**: <codex | claude | 当前运行时的稳定小写名称>
**Card ID**: <uuid>
**当前 Session Record ID**: <uuid>
**当前 AI Session ID**: <真实 ID | unavailable>
**项目名**: <原始仓库根目录 basename>
**项目完整路径**: <原始仓库根目录 absolute path>
**生命周期文档路径**: <absolute path>
**变更面授权**: <未触发 | 已批准：具体影响摘要>

---

## 过程文件清单

- `docs/feature/YYYY-MM-DD-<feature-slug>.md` — 生命周期文档

> 每次创建或修改非交付的流程编排、AI handoff、评审、诊断、验证或临时产物时，立即追加其仓库相对路径和用途。构建、测试或代码生成工具独占且整体可重建的专用输出目录（如 `target/`、`build/`、`dist/`、`coverage/`）按目录登记，目录内文件无需逐项登记；混合目录只登记归属明确的更窄子目录或精确文件。禁止宽泛 glob。Stage 5 以本清单作为唯一清理白名单。

---

## 进度

- [ ] 1. 方案设计 — brainstorming
- [ ] 2. 需求评审 — grill-with-docs
- [ ] 3. 实现计划 — writing-plans
- [ ] 4. 编码、评审与修复循环
- [ ] 5. Squash 并 rebase 到 base
```

输出生命周期文档和 worktree 的完整路径，然后进入 Phase 3。后续 Stage 产生实现计划、评审报告、逐任务产物、临时诊断记录、scratch 文件或构建/测试中间产物时，必须同步更新“过程文件清单”；已确认的专用输出目录登记一次即可覆盖其全部后代，最终交付文件不得加入该清单。

没有既有需求文档时，初始写“由 Stage 1 spec 生成”，Stage 1 后立即替换为实际 spec 路径。“Spec 文档路径”初始写“暂无”，Stage 1 产出并提交 spec 后立即回填其 worktree 绝对路径；它指本次流程产出的 `docs/superpowers/specs/` Markdown，不得用生命周期文档、实现计划或外部需求文档替代。目标模块和 DDD 适用性由 spec 与实现计划承载，不保留启动问答字段。硬门禁未触发时写“未触发”；触发并获明确授权后，只写已向用户展示并获批的具体影响摘要，禁止写模糊的“用户已同意”。

## Feature Kanban 初始化

生命周期文档创建后、进入 Stage 1 前必须调用一次看板初始化接口。该调用失败不阻塞流程；“非阻塞”只影响错误处理，不授权省略调用：

1. 按当前运行时确定工具名：Codex 使用 `codex`，Claude 使用 `claude`，其他环境使用稳定的小写名称。项目名取流程启动时保存的原始仓库根目录 `<repo-root>` 的 basename，不取 linked worktree 名称。上报的 `title` 固定为 `<feature-slug>`，不含生命周期文档文件名前面的日期 `YYYY-MM-DD-`，也不含 `.md`。
2. 新生命周期文档就是新流程，不查重。生成新的 UUID `cardId` 和当前 AI 会话的 UUID `sessionRecordId`；恢复同一流程沿用文档中的 `cardId`，新会话接管时生成新的 `sessionRecordId`。
3. 在任何网络调用前，把两个 ID、工具名、项目名、原始仓库根目录绝对路径、分支、生命周期文档绝对路径和可取得的真实会话 ID 写入文档；真实会话 ID 不可用时只在生命周期文档中写 `unavailable`，禁止虚构。这个本地占位值不得复制到 API JSON：没有真实 ID 时，`session` 对象必须完全省略 `externalSessionId`，不得发送 `null`、空字符串或 `unavailable`。
4. 完整读取 [Feature Kanban API reference](feature-kanban-api.md)，直接调用一次 `POST /api/cards` 创建卡片；`projectPath` 必须上传流程启动时保存的原始仓库根目录绝对路径，不得上传 linked worktree。不得使用 CLI 或按标题、项目、分支查重。
5. 该 POST 使用精确 500ms 超时并丢弃返回值，不解析服务端响应；调用失败不记录、不重试、不阻塞，立即继续 Stage 1。无论 POST 调用结果如何，后续每次阶段或状态变化都必须按主技能调用对应的完整 `PATCH /api/cards/{cardId}` 快照；不得启动、停止、安装或修复看板服务。
