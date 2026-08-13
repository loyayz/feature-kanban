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
**看板同步**: <待初始化 | 正常 | 失败：时间与简短错误>
**变更面授权**: <未触发 | 已批准：具体影响摘要>

---

## 进度

- [ ] 1. 方案设计 — brainstorming
- [ ] 2. 需求评审 — grill-with-docs
- [ ] 3. 实现计划 — writing-plans
- [ ] 4. 编码、评审与修复循环
- [ ] 5. Squash 并 rebase 到 base
```

输出生命周期文档和 worktree 的完整路径，然后进入 Phase 3。

没有既有需求文档时，初始写“由 Stage 1 spec 生成”，Stage 1 后立即替换为实际 spec 路径。“Spec 文档路径”初始写“暂无”，Stage 1 产出并提交 spec 后立即回填其 worktree 绝对路径；它指本次流程产出的 `docs/superpowers/specs/` Markdown，不得用生命周期文档、实现计划或外部需求文档替代。目标模块和 DDD 适用性由 spec 与实现计划承载，不保留启动问答字段。硬门禁未触发时写“未触发”；触发并获明确授权后，只写已向用户展示并获批的具体影响摘要，禁止写模糊的“用户已同意”。

## Feature Kanban 初始化

生命周期文档创建后、进入 Stage 1 前执行一次可选看板上报：

1. 按当前运行时确定工具名：Codex 使用 `codex`，Claude 使用 `claude`，其他环境使用稳定的小写名称。项目名取流程启动时保存的原始仓库根目录 `<repo-root>` 的 basename，不取 linked worktree 名称。上报的 `title` 固定为 `<feature-slug>`，不含生命周期文档文件名前面的日期 `YYYY-MM-DD-`，也不含 `.md`。
2. 新生命周期文档就是新流程，不查重。生成新的 UUID `cardId` 和当前 AI 会话的 UUID `sessionRecordId`；恢复同一流程沿用文档中的 `cardId`，新会话接管时生成新的 `sessionRecordId`。
3. 在任何网络调用前，把两个 ID、工具名、项目名、原始仓库根目录绝对路径、分支、生命周期文档绝对路径和可取得的真实会话 ID 写入文档；真实会话 ID 不可用时写 `unavailable`，禁止虚构。
4. 完整读取 [Feature Kanban API reference](feature-kanban-api.md)，直接调用 `POST /api/cards` 创建卡片；`projectPath` 必须上传流程启动时保存的原始仓库根目录绝对路径，不得上传 linked worktree。重试沿用同一 `cardId`，不得使用 CLI 或按标题、项目、分支查重。
5. 创建成功后把“看板同步”写为“正常”。请求失败时只把失败时间和简短错误写入“看板同步”，然后继续 Stage 1；不得循环重试，也不得启动、停止、安装或修复看板服务。
