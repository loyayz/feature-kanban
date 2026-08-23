# Stage 5：固化、整合与清理

本文件只展开 `SKILL.md` Stage 5 验证矩阵的机械流程。矩阵、流程型 skill 调用守卫、Stage 4 证据门槛和用户授权边界优先；不得在此阶段调用其他流程型 skill 接管评审、验证或分支收尾。

进入本阶段时，从生命周期文档读取“过程文件清单”，把其中经核对的仓库相对文件和目录路径记为 `<process-paths>`。结合 `git status --short --untracked-files=all --ignored` 和本流程的创建/修改记录逐项核对：本流程产生但遗漏的过程路径必须先补入清单，归属不明、用户已有或可能需要交付的路径必须暂停并报告。构建、测试或代码生成工具独占且整体可重建的专用输出目录可直接进入 `<process-paths>`，其后代文件无需逐项展开；用项目配置、ignore 规则、执行命令或创建前后状态确认目录归属。混合目录必须缩小为归属明确的子目录或精确文件。禁止退回固定目录白名单、宽泛 glob 或“所有未跟踪文件”。

## 1. 固化前门禁结果与授权审计

在任何 squash 或 rebase 前，确认 Stage 4 完整质量门禁已通过且基于最终修复，此后生产代码和交付内容未再变化；只改过程文档或整理提交不使结果失效。交付内容已变化则返回 Stage 4 重新执行该门禁，Stage 5 自身不得运行。覆盖率处理仍遵循主技能测试策略，不能为门禁改变生产设计。

squash 前提交需交付的代码、设计、需求和用户指定文档；`<process-paths>` 中全部过程文件保持未提交，本机临时文件和 worktree 目录只有已列入 `<process-paths>` 才可保留到最终清理。确认：

- 当前分支为 `feat/YYYY-MM-DD-<feature-slug>`。
- `<base-branch>` 仍是原工作区 base；不得 checkout、reset 或提交 base。
- `git status --short --untracked-files=all --ignored` 的每个未提交或 ignored 路径都与 `<process-paths>` 中的精确文件或完整登记目录匹配；任何未匹配路径都暂停，禁止 stash、丢弃或提前删除来换取干净状态。
- 已推送且将改写远端历史时，先警告并取得明确确认。

基于 Phase 2 保存的不可变 `<initial-base-sha>` 运行：

```bash
git status --short
git diff --name-status <initial-base-sha>
git diff <initial-base-sha>
```

逐项确认全部增改删路径和语义影响属于 Stage 1 已批准基线且没有越过受保护行为。不得以会移动的 `<base-branch>`、当前 merge-base 或 rebase 后基线替代 `<initial-base-sha>`。发现漂移立即回 Stage 1；质量门禁通过不能替代授权审计。

## 2. Squash 为单提交

运行：

```bash
git reset --soft <initial-base-sha>
git reset <initial-base-sha> -- <tracked-process-paths...>
git diff --cached --name-only
git commit -m "feat: [模块] 需求功能"
git rev-list --count <initial-base-sha>..HEAD
git diff --name-only <initial-base-sha>..HEAD
```

`<tracked-process-paths>` 是 `<process-paths>` 中当前出现在 index 或已有提交里的路径；为空时跳过第二条。该命令只取消暂存过程文件，必须保留工作树文件。提交前把 staged 列表与 `<process-paths>` 做精确文件/登记目录前缀比对，交集必须为空；提交后倒数第二条必须输出 `1`，并把最后一条的全部输出再次与 `<process-paths>` 比对，交集必须为空，证明 `<initial-base-sha>` 后只有一个 feature commit 且不含任何过程文件。

## 3. 复用子流程：feature rebase 到最新本地 base

“最新 base”只指执行时本地 `<base-branch>` 引用所指提交。禁止 `git fetch`、`git pull`、读取远端跟踪分支更新基线或以其他方式同步远端。在 feature worktree 执行：

```bash
git rebase <base-branch>
```

按实际结果处理：

- **无冲突：** Stage 4 评审仍有效；不重新评审、不重跑完整质量门禁。
- **发生过冲突：** 解决并继续 rebase 后，对最终 `git diff <base-branch>...HEAD` 追加一次完整主代理评审，沿用 Stage 4 的范围、证据门槛、报告格式和确认缺陷修复规则；不调用其他评审或验证流程 skill，不增加 reviewer，不重启 Stage 4 的全量零问题与定向复核门禁。随后只运行能证明冲突解决正确性的受影响编译、既有专项测试或静态检查，不运行 Stage 3 的完整质量门禁。冲突本身不构成测试触发，不得据此新增测试；若冲突解决实际引起主技能定义的业务流程变化，必须按主技能测试策略补足并运行必需测试。发现并修复确认缺陷时，以 amend 保持单提交，复核该缺陷已消失并重跑受影响验证。若冲突影响无法可靠隔离，或受影响验证不足以证明最终内容正确，立即暂停并保留分支、worktree 和过程文档，让用户决定是否授权额外的非完整门禁验证；该授权不得被解释为允许运行 Stage 3 完整质量门禁。获批验证后重新判断证据：充分且通过才继续结构检查，不充分或失败则保持暂停。

无论有无冲突，最后运行：

```bash
git merge-base --is-ancestor <base-branch> HEAD
git rev-list --count <base-branch>..HEAD
git diff --name-only <base-branch>...HEAD
```

成功须依次为退出 0、输出 `1`，且最后一条的全部输出与 `<process-paths>` 的交集为空，即 feature 基于当前本地 base、只多一个 commit、提交无任何过程文件。任一不满足即暂停并保留分支、worktree 和全部过程文件。

本子流程执行两次：第一次在询问整合前；第二次仅在用户明确同意整合与清理后，用于覆盖等待期间可能移动的本地 base。

## 4. 披露影响并取得整合确认

第一次 rebase 子流程成功后，逐项报告既有生产文件的修改/删除及其对控制流、状态、事务、异常、补偿、协议、权限的影响，并说明共享资源/容量影响和未执行的压测或运行验证；新增文件可按职责分组。测试通过不能替代影响说明。

直接询问：

> 是否将已完成的 `<feature-branch>` 以 fast-forward 方式整合进 `<base-branch>`，并在成功后删除开发分支和 worktree？整合前会再次将 feature rebase 到最新本地 base；清理会同时删除“过程文件清单”逐项列出的全部未提交过程文件，包括但不限于生命周期文档、实现计划、评审报告、逐任务产物、临时诊断记录和构建/测试中间产物，且无法从 Git 恢复。

用户拒绝或暂缓时，输出 feature 分支、worktree、唯一 commit、验证结果和保留的过程文档后结束；不再次 rebase、不整合、不清理。

## 5. 最终对齐并整合 base

用户明确同意后，先确认原工作区仍在 `<base-branch>` 且干净，feature worktree 的每个未提交或 ignored 路径都与 `<process-paths>` 匹配且清单中没有应交付内容。任一失败即暂停，禁止 stash、丢弃或清理。

再次执行第 3 节 rebase 子流程。成功后保存最终身份：

```bash
git rev-parse HEAD
git rev-parse HEAD^{tree}
```

分别记为 `<feature-head>` 和 `<feature-tree>`。在原工作区 `<base-branch>` 执行：

```bash
git merge --ff-only <feature-branch>
git rev-parse HEAD
git rev-parse HEAD^{tree}
```

只有 base HEAD 等于 `<feature-head>` 且 base tree ID 等于 `<feature-tree>`，才视为原工作区移动到已验证代码树；不重新评审或重跑任何门禁。

`merge --ff-only` 失败，或 HEAD/tree ID 任一不一致时，立即暂停并保留 feature 分支、worktree 和过程文档；禁止完成上报、归档或清理。记录提交图，并比较实际 base 与保存身份：

```bash
git log --graph --oneline --decorate --all -n 30
git diff --stat <feature-head> HEAD
git diff <feature-head> HEAD
```

- tree ID 不同：按 Stage 4 证据门槛评审实际内容差异，并运行受影响验证；不得重跑完整质量门禁。
- tree ID 相同但 HEAD 不同：确认内容 diff 为空，审计提交拓扑及身份变化原因；仍保持暂停，不得以 tree 等价自行清理。

完成上述诊断后等待用户决定后续处理，不得自动重写 base、feature 或重新授权清理。

## 6. 上报完成并自动归档、清理

只有第 5 节身份完全一致后，先把 `specDocumentPath` 从 worktree 路径改写为 `<repo-root>` 下相同仓库相对路径，并确认目标是已整合的 Stage 1 Markdown spec；再按 Feature Kanban 协议发送一次 `completed` / `integrated` 完整快照。该快照成功持久化时会在服务端同一事务内自动归档卡片；不存在第二个归档调用。

完成态上报调用发起后，解析确认 `<worktree-path>` 是已注册 feature worktree，且不是 `<repo-root>` 或宽泛目录，再从原工作区运行：

```bash
git worktree remove --force <worktree-path>
git branch -d <feature-branch>
git worktree prune
```

`--force` 只可用于用户在本步明确同意放弃的 `<process-paths>`。清理前必须再次运行 `git status --short --untracked-files=all --ignored` 并逐项核对全部输出：每项都必须与清单中的精确文件或完整登记目录匹配，且清单中的过程路径不得含应交付内容；任何未匹配、归属不明或可能属于用户的 tracked 修改、未跟踪或 ignored 路径都必须暂停并逐项报告，禁止假定其可重建或可删除。删除任何内容前必须再次验证解析后的绝对 worktree 路径仍是预期目标。成功移除 worktree 后，清单中的全部过程文件都必须随之消失，不得只清理计划或评审文件。

确认开发分支已不存在后，不再调用任何归档端点，也不因看板调用结果重建已删除的过程文档、分支或 worktree。

最终输出 base、commit、删除的分支/worktree、已发起的 `completed` / `integrated` 及其自动归档语义，并说明“过程文件清单”中的全部过程文件已随 worktree 删除且无法从 Git 恢复。
