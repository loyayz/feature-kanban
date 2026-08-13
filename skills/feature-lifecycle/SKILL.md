---
name: feature-lifecycle
description: Use when 用户要求实现、开发、添加新功能，或要求从设计到合入、端到端、全生命周期交付；覆盖所有新功能开发场景，即使请求仅是“帮我实现/加一个功能”也必须先用本技能编排全流程。
---

# Feature Lifecycle — 需求实现全生命周期

## 核心约定

在独立 feature worktree 中按顺序完成信息收集、生命周期文档、方案设计、需求评审、实现计划、编码与评审修复、单提交整理及 rebase。除本技能明确要求确认或暂停外自动推进；升级执行方式或预算必须先获用户明确确认。

Feature Kanban 是该生命周期的可选本地投影，不是 Git、worktree、生命周期 checkbox 或阶段决策的权威。创建生命周期文档和首次上报前完整读取 [Feature Kanban API reference](references/feature-kanban-api.md)；服务不可用不得阻塞本地流程。

### 运行环境

- “调用 `<skill-name>`”表示使用当前环境原生的 skill 发现与加载机制，不得写死 `Skill(...)` 等环境专用语法。
- “项目指令文件”包括当前环境识别的仓库/目录规则（如 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`）；读取根规则及目标目录最近的局部规则，局部优先并与上层叠加。
- 代码评审使用当前环境可用的原生工具、代理或内置能力及足以理解改动的常规强度；始终遵守本技能的范围、证据门槛和报告格式，不得借更高强度扩大范围或深挖理论边界。

### 依赖与异常 skill

启动时检查全部必需 skills：Stage 1 `superpowers:brainstorming`、Stage 2 `grill-with-docs`、Stage 3 `superpowers:writing-plans`、Stage 4 `superpowers:receiving-code-review`。任一缺失，列出缺失项及适合当前环境的安装方式后暂停。

`pua:pua` 不是启动依赖，只在下文规定的重复失败、证据缺失、被动停滞或质量不达标时检查并用于 RCA；缺失时报告并以已有证据继续定位，不阻塞无关阶段。正常流程不得默认调用 PUA，不得用 `pua:shot`、`pua:p7`、`pua:p9` 或 `pua:p10` 替代主流程或角色（用户明确要求相应模式除外），也不得自动执行 `/pua:flavor` 或等价持久化命令。

### 执行方式与预算

优先级：用户明确选择/预算 > 已批准计划或当前任务的 `Execution Mode` > 本技能默认值。默认 Inline Direct：主代理按依赖顺序完成不超过 3 个实现批次，不使用实现子代理，不生成逐任务说明、报告、差异包或评审包；Stage 4 整分支评审报告不属于逐任务产物。

只有计划或当前任务明确记录更重方式和预算且用户明确选择，才可增加实现子代理或逐任务产物；普通的“可以”“继续”不构成授权。`Execution Mode` 只约束编码组织、实现子代理和逐任务产物；Stage 4 固定门禁始终执行，只有用户明确改变评审规则时才可覆盖其退出条件或轮次上限。

Stage 4 专用 reviewer 属于固定门禁，不是 Subagent-Driven 实施且不占实现子代理预算：默认仅首轮一次、单 reviewer 候选扫描；不得跨轮复用、擅自增加或替代主代理自审。额外独立评审同样需要用户明确要求。

### 过程文档与产物格式

`docs/feature/`、`docs/review/`、`docs/superpowers/plans/` 是过程文档：feature worktree 存续期间必须保留并更新，禁止 `git add`、进入任何提交或为清洁工作树而删除；只有 Stage 5 已告知后果且用户同意整合和清理时，才随 worktree 删除。`docs/superpowers/specs/` 及用户明确要求交付的需求/产品文档不在此列，按交付要求决定是否提交。

实现计划和评审报告是 AI-to-AI handoff artifact：项目规定语言时从其规定，否则默认 English；标识符、路径、命令、错误和既有领域术语保持原文，不重复双语。按任务/文件或发现使用可独立理解的弱结构自然语言；禁止 JSON、表格、固定字段模板及无助于下游决策的元数据。

## 启动与恢复

先检查必需 skills，再运行：

1. `git worktree list --porcelain`，取得全部 worktree 路径与分支。
2. 在 feature worktree 的 `docs/feature/` 查找含未勾选 `- [ ]` 的生命周期文档。
3. 按场景处理：
   - worktree 与未完成文档都存在：询问是否从未完成 Stage 继续；确认后进入该 worktree。
   - feature 分支存在但无 worktree：推荐路径并询问是否重新挂载后恢复。
   - worktree 存在但文档缺失：询问在其中开始新流程还是回原工作区重启。
   - 无匹配记录：进入 Phase 1。

用户选择重启时只归档旧生命周期文档，不得自动删除旧 worktree 或分支。文档 checkbox 是唯一进度来源；每个 Stage 完成后立即更新，并持续记录当前 worktree、分支、base、评审轮次和未解决风险。

流程为：信息收集 → 创建 feature worktree → 生成生命周期文档 → Stage 1 brainstorming → Stage 2 grill-with-docs → Stage 3 writing-plans → Stage 4 编码/评审/验证/修复 → Stage 5 squash/rebase。规定的异常触发 `pua:pua + RCA`。

## Phase 1：信息收集与创建 worktree

信息收集只处理需求来源和可选项目基准设计文档。功能目标取自用户原始请求和既有沟通，不重复询问一句话描述；目标模块和 DDD 适用性由 AI 按仓库、项目指令和功能性质判断，仅把无法推断且影响正确性的决策交给运行时 `superpowers:brainstorming`。

### 需求来源

- 已有需求文档：直接记录路径，不重复询问。
- 没有：不要求用户创建或提供路径；Stage 1 spec 即需求文档，生成后回填实际路径。
- 仅在没有需求文档时可询问一次是否提供项目基准设计文档，推荐“不提供”；可跳过且不阻塞，只作兼容性参考，不能覆盖已确认需求。

### 分支与 worktree

1. **确定 slug。** 用户指定时规范化采用；否则从原始请求和已确认需求提取英文关键词，以 `-` 连接为 `<feature-slug>`，不展示、不确认、不暂停。分支名固定为 `feat/YYYY-MM-DD-<feature-slug>`。
2. **记录原工作区。** 运行：

   ```bash
   git rev-parse --show-toplevel
   git branch --show-current
   git rev-parse HEAD
   git status --short
   ```

   保存 `<repo-root>`、`<base-branch>` 和不可变 `<initial-base-sha>`；后续复审判断不得用会移动的分支名替代该 SHA。未提交改动不进入新 worktree；工作树不干净时说明此事并取得继续确认，禁止自动 stash、提交或丢弃。
3. **识别隔离环境。** 比较 `git rev-parse --git-dir` 与 `git rev-parse --git-common-dir`，并用 `git rev-parse --show-superproject-working-tree` 排除 submodule。匹配的 feature worktree 直接复用；不匹配的 linked worktree 则暂停，让用户选择返回原工作区或使用现有 worktree；普通工作区继续。
4. **选择机制和路径。** 优先用当前环境原生 worktree 能力，否则用 `git worktree`。路径顺序：用户/项目指令指定位置 → 已有 `.worktrees/` → 已有 `worktrees/` → `<repo-root>/.worktrees/<feature-slug>`。仓库内目录须先以 `git check-ignore` 确认根目录已忽略；否则让用户选择添加规则或改用仓库外目录，不得创建。
5. **创建并验证。** 无原生能力时运行：

   ```bash
   git worktree add <worktree-path> -b feat/YYYY-MM-DD-<feature-slug> <base-branch>
   ```

   验证当前分支；此后生命周期文档、设计、计划、代码、评审、测试和提交全部在 `<worktree-path>`，原工作区不切分支、不创建或修改这些产物。权限、沙箱或路径失败时报告并暂停，禁止退回原工作区实施。

### 启动基线

本技能覆盖 `superpowers:using-git-worktrees` 的默认 Project Setup/Verify Clean Baseline：创建后默认不安装依赖、不构建、不跑测试；只检查路径、分支、`git status --short`、适用项目指令和可用构建命令，随即生成生命周期文档并进入设计。

只有以下可观察条件才运行基线：用户明确要求；项目指令明确要求实施前运行指定命令；或后续构建/测试失败且无法归因，此时在无 feature 改动的 base 快照运行同一命令。交给独立 sub agent 异步执行确定性非破坏命令，主代理继续生命周期文档和 Stage 1–3，不等待；可选模型时用能可靠执行并汇总的最低成本模型和最低合理强度，否则普通 sub agent，不能因此升级主代理。该代理不得修改代码或需求/设计/计划/领域文档，也不得派生代理。

通过只记录命令与结论；失败保留原命令、退出码和摘要。仅当失败影响归因或是项目硬门禁时暂停编码；不得因结果未返回阻塞设计/计划，也不得主动扩大基线。

## Phase 2：生成生命周期计划文档

进入本阶段必须完整读取并执行 [references/phase-2-lifecycle-plan.md](references/phase-2-lifecycle-plan.md)。完成后进入 Phase 3；不得凭记忆、摘要或只读取模板替代该文件中的全部规则。

## Phase 3：执行生命周期

各 Stage 按序自动推进，仅在规则明确要求确认时暂停。执行任何构建、测试或代码修改前，先读取仓库根和目标模块适用的项目指令。构建命令优先级：项目指令指定命令/工具路径 → README、构建脚本、CI → Maven 项目使用 Maven wrapper、IDE Maven 或 `mvn` → Gradle 项目使用 `gradlew`、IDE Gradle 或 `gradle` → 按项目文件判断其他工具；无法可靠判断才询问。项目指令的语义变量若非环境变量，必须从配置解析实际路径，不能直接作为 shell 环境变量。

### 测试策略

- **生产设计优先。** 需求、领域模型、公共接口、控制流、事务、异常和运行行为只服务生产场景。测试从已确认设计派生；禁止因测试、mock 或可达性新增 hook、setter、公开入口、配置开关、依赖抽象，暴露内部状态或改变生产语义。
- **自动化测试默认可选。** 仅当用户、需求、项目指令或既有质量门禁要求时为必需；否则仅在不改变生产设计且成本合理时，为核心不变量、权限、金额/状态流转、幂等、并发、事务、数据完整性、失败恢复补最小行为测试。无论是否添加，均须以编译、静态检查、既有集成入口、专项命令等风险相称方式验证。
- **禁止 TDD/RED → GREEN。** 不得先写测试并故意观察失败，不得回退、删除、禁用或破坏正确实现制造红灯，也不得把证明测试能失败作为交付步骤。先完成生产设计和实现，再写所需测试并直接验证；自然失败正常定位。此规则覆盖 `superpowers:test-driven-development` 及 `superpowers:verification-before-completion` 的回归测试 RED → GREEN 要求。
- 以行为场景/失败模式为单位使用最小测试集；禁止按 DTO/实体字段、getter/setter 或生产方法机械铺测，禁止只为覆盖率增加低价值测试。关键字段由所属高风险场景验证。
- 覆盖率是风险信号和项目门禁，不是拆分依据。失败时先找未覆盖高风险规则；若只能靠低价值测试或生产设计让步达标，暂停并报告，禁止降阈值或机械补测。测试、覆盖率、可测试性绝不授权生产变更；只能调整测试方式/工具/门禁或由用户明确接受未满足状态，不能借重新设计改变业务语义。

### Stage 1：方案设计

原生调用 `superpowers:brainstorming`，传入原始请求、已确认需求、现有需求文档、可选基准设计文档、worktree、目标分支和 base。只作以下覆盖：逐章节用户确认改为 AI 自审“不过度设计、生产设计优先”；测试场景不能反向增加生产能力/接口/抽象；书面 spec 用户审阅改为 AI 自动审阅后推进。除此之外不得复述、推断、固定或改写运行时技能的流程、确认点、产物或阶段关系。

spec 必须单列**变更面契约**：交付目标和用户指定模块、预计新增内容、预计修改/删除的既有生产模块/层次、受保护行为/契约、资源或容量影响及未验证项、低侵入方案及其保真度损失。无需先穷举文件，但须逐项具体到模块、层次、业务协作点和影响类别；“相关逻辑”“必要调整”“全部相关模块”“最佳实践”无效。

下列任一项触发硬门禁：修改既有业务控制流、Domain 模型/状态机；数据库结构/数据语义/持久化协议/Redis/Lua/外部线协议；事务/异常/重试/回滚/补偿；权限/安全边界/公共 API；或用户目标外生产模块。横切需求覆盖广不构成授权。

触发时须在 spec 批准前向用户展示具体变更面、业务和运行影响、低侵入替代，并直接询问是否授权；只有披露后的明确肯定有效，披露前的“可以”“继续”“都要”“端到端”“最佳实践”无效。不批准则降保真、缩范围或重设计，禁止推进。这是 spec 无需用户确认的唯一例外，不要求全文或逐章审批。

批准内容写入 spec 和生命周期文档，只绑定用户看到的版本；需求、基准设计、契约或受保护行为实质变化即失效，须展示差异并重获授权。评审、测试通过或“修复缺陷”均不能扩大授权。

成功标准：`docs/superpowers/specs/` 下的设计已批准；无既有需求文档时它成为需求文档且生命周期文档已回填；契约完整，硬门禁未触发或已明确授权并记录。

spec 产出并提交后，立即把其 worktree 绝对路径回填到生命周期文档的“Spec 文档路径”，并在后续每个完整看板 PATCH 快照中发送 `specDocumentPath`。该路径只指向本次 Stage 1 产出的 Markdown spec，禁止上传生命周期文档、实现计划或外部需求文档。

### Stage 2：需求评审

原生调用 `grill-with-docs`。有外部需求文档时评审它与 spec 一致性；没有时评审兼作需求/设计文档的 spec 之内部一致性、领域契合和项目规范，禁止机械自比。基准设计只核对兼容性，不能覆盖本次需求。

覆盖其默认治理：现有 `CONTEXT.md`、`CONTEXT-MAP.md`、ADR 只读；不得创建/更新或作为前置条件、产物、成功标准，缺失不阻塞。先从项目指令和仓库识别其他项目级领域模型/术语文档；存在则按项目路径、格式和流程同步，不能因通用文档只读而跳过；不存在则只回写需求或设计，不创建通用领域文档。测试用例只检查已确认业务规则；需要新增生产行为、扩大边界或改变领域语义的测试必须丢弃或改写。

成功标准：无未解决逻辑矛盾；修改未扩大已授权变更面；项目要求的领域/术语文档已同步。通用 CONTEXT/ADR 的存在不影响完成。

### Stage 3：制定实现计划

原生调用 `superpowers:writing-plans`，覆盖固定 header、task field 和逐步代码模板：使用 AI-to-AI 弱结构自然语言，无固定字段名/顺序。拆分前仍须说明执行方式、预算及与之匹配的任务边界；还须说明高风险规则及失败场景、受影响范围验证、完整质量门禁命令、是否需要自动化测试及依据，无则明确写无。不得以字段/方法清单代替。

新增内容与既有生产行为修改分开写。后者列精确修改/删除路径；尚不能确定时至少写模块、层次、业务协作点并在编码前补路径，同时说明原行为、新行为、原因和受保护行为。发现未授权硬门禁项立即回 Stage 1 更新 spec 并获批，不能用详细计划代替授权。

每个新增生产/测试代码文件以精确路径为锚点，简述单一职责、依赖、语义输入输出、关键控制流/协作/分支/状态变化/错误处理、要证明的高风险行为和验证命令。覆盖 writing-plans 的完整代码默认：伪代码须明确意图和边界但不可编译运行；禁止完整 import、注解、类/构造器、精确方法体、框架样板或完整测试代码。测试文件只写 setup/action/assertion 场景；不按代码行拆步，不在计划与实施重复同份代码。禁止 TBD、TODO、“稍后实现”及空泛控制流；非代码配置、协议、迁移和数据文件仍按风险提供精确信息。

覆盖默认 TDD：计划禁止 RED → GREEN、测试先行/观察失败/故意失败/回退正确实现，也不默认新增测试；验证必须入计划，必需测试仅来自用户、需求、项目指令或既有门禁，且排在生产实现后。禁止为测试改变生产设计。若项目指令要求测试先行，暂停并报告生命周期冲突。计划留在 `docs/superpowers/plans/`，不得按默认行为提交。

用户在设计批准后明确跳过计划时，标记 Stage 跳过；编码前在当前任务记录执行方式、预算、验证、测试决定及依据、既有生产行为修改清单。默认 Inline Direct，不创建计划/逐任务产物，也不跳过硬门禁。

成功标准：计划弱结构完整表达上述决定，新增代码文件只有明确伪代码而无完整实现；或明确跳过且当前任务已有等价记录。

### Stage 4：编码、评审与修复

按计划或当前任务的 `Execution Mode` 编码；缺失则 Inline Direct，按共享语义和依赖组织最多 3 批。编码前以计划中的既有生产文件和允许新增模块为批准基线；每批开始前列预计增/改/删路径及语义影响并对照，结束后用 `git status --short`、`git diff --name-status <base-branch>` 核对实际类型和影响。基线外生产修改、未批准删除或越过受保护行为时，在修改前停下，更新 spec/计划并重新授权，禁止先改后补。

使用 `superpowers:executing-plans` 时遵循已批准顺序，但禁止调用 `superpowers:test-driven-development`、测试先行、预期失败或回退正确实现造失败；计划仍含此类步骤时先按 Stage 3 修正。生产实现后再运行计划测试、受影响验证和 Stage 5 完整门禁。文件多、范围大或 skill 推荐均不能自动启用子代理驱动；仅当任务可独立实现验收、计划/当前任务已选择且用户明确授权时可用。

编码完成后评审 `git diff <base-branch>...HEAD`。每轮主代理先按指定角度独立检查完整范围并记录候选；首轮同时异步启一个隔离、只读 reviewer，以常规强度仅扫描候选，输入只含需求、设计、计划/当前任务、适用项目/领域文档和完整 diff。不得为增加发现而提高强度、增加 reviewer 或延长扫描。主代理读取报告前须完成自审。reviewer 可做非破坏诊断，但不是设计者/裁决者/修复者，不能改代码/过程文档或派生代理。无独立代理则记录后继续，不算缺少评审；首轮报告汇合双方候选，后续只含主代理自审。报告为 `docs/review/YYYY-MM-DD-<feature-slug>-review-round-<N>.md`。

只报告当前 feature 中违反需求、项目规范、关键契约，或在允许输入/状态下现实可达的正确性、安全、权限、事务、并发、数据完整性、失败恢复缺陷。每项须有可定位代码证据和现实失败路径或可证逻辑错误；证据不足不报。禁止把替代架构、通用重构、风格/抽象纯度、未来扩展、无需求支撑的规模/性能、领域外输入、纯理论竞态或非关键测试覆盖列为候选。允许 `No findings.`，无证据不深挖。报告用 Markdown 自足条目包含定位、问题、失败场景、证据；禁止 JSON、表格、固定字段、`[PLAUSIBLE]`，无候选只写 `No findings.`。

主代理原生调用 `superpowers:receiving-code-review` 并传报告路径，将 reviewer 内容仅作补充候选；合并自审后逐项验证真伪、需求相关、可达性和证据，去重定级，丢弃越界建议。确认清单是唯一修复范围。缺陷不授权扩面；若须进入未批准模块或改变领域、协议、事务、异常、补偿、权限、公共接口，保留证据并回 Stage 1。问题连续要求深入业务层时，优先判定架构/需求保真不可接受并暂停。

按严重程度从高到低、一次一个地修复确认问题；每次依项目指令跑受影响编译/专项验证，通过再继续。先修生产代码，再按测试策略按需添加最小行为测试并直接运行，禁止为可测性改设计或撤销正确修复看失败；否则用最小编译、静态检查、集成入口或专项验证证明。范围不得越过本 feature/授权面。单 bug 连续 2 次修复仍不过，调用 `pua:pua` 做 RCA；PUA 下再 2 次仍失败，记为未解决并写入报告，禁止静默忽略。

**退出门禁：** reviewer 只参与首轮，其 `No findings.` 永不计干净轮；只有主代理完整自审计数。计数初始 0，任何确认缺陷修复后归零。计数 0 用“需求与契约正确性”角度，核对需求、规范、允许输入、状态、输出、关键契约；干净变 1。计数 1 必须换“集成与回归失败路径”，检查调用方、依赖、错误处理、重试、回滚和相邻行为；安全/并发/事务/性能仅在 feature 涉及或需求要求时检查，禁止重复上轮清单冒充新角度。每轮检查完整范围、沿用证据门槛并写新报告；无缺陷只写 `No findings.`。第二角度干净后计数 2 退出。最多 5 轮；仍不收敛则保留报告和具体未解决项，暂停让用户决定。理论疑虑不得制造问题、重置或延长循环。

### Stage 5：Squash 并 rebase

1. **最终门禁。** 用 `git status --short`、`git diff --name-status <base-branch>` 审计所有增改删和语义影响均在授权基线且不越受保护行为；漂移则回 Stage 1，不能以测试通过接受。按项目指令运行一次目标子项目完整质量门禁；失败只修本次变更并重跑，无法归因则暂停。覆盖率失败仍按测试策略仅补不改变设计的高风险测试；只能靠低价值测试/生产让步时报告冲突，不得为测试返回 Stage 1 申请生产变更。
2. **交付与安全。** squash 前提交需交付的代码、设计、需求和用户指定文档；三个过程目录保持未提交，本机临时文件/worktree 目录不得提交。`git status --short` 中除此三目录外有任何未提交路径即暂停，禁止删过程文档换干净。当前分支须为 `feat/YYYY-MM-DD-<feature-slug>`；`<base-branch>` 仍指原工作区 base，禁止 checkout/reset/提交 base。已推送且将改写远端历史时先警告并获明确确认。
3. **Squash。** 运行 `git merge-base <base-branch> HEAD` 保存 `<merge-base>`，再执行：

   ```bash
   git reset --soft <merge-base>
   git reset <merge-base> -- docs/feature docs/review docs/superpowers/plans
   git diff --cached --name-only
   git commit -m "feat: [模块] 需求功能"
   ```

   第二条只取消暂存过程文档，必须保留工作树文件；确认 staged 列表无过程文档再提交。
4. **在 feature 上 rebase。** 执行 `git rebase <base-branch>`；冲突只在 feature worktree 解决并继续，禁止修改 base 或原工作区。
5. **决定是否复审。** 只以 `<initial-base-sha>` 运行：

   ```bash
   git merge-base --is-ancestor <initial-base-sha> HEAD
   git rev-list --count <initial-base-sha>..HEAD
   ```

   首条退出 0 且次条为 `1`：Stage 4 仍有效；squash/rebase、SHA、消息、提交数变化不触发复审。此处覆盖 `superpowers:requesting-code-review` 的 before merge 默认及 `superpowers:finishing-a-development-branch` 触发的复审。否则针对最终 `git diff <base-branch>...HEAD` 重做 Stage 4；干净后记录最终 HEAD。HEAD/交付不变不得再评，任何修复、rebase 或交付变化使记录失效并须重判。
6. **验证最终状态。** 运行：

   ```bash
   git merge-base --is-ancestor <base-branch> HEAD
   git rev-list --count <base-branch>..HEAD
   git diff --name-only <base-branch>...HEAD -- docs/feature docs/review docs/superpowers/plans
   ```

   成功须依次为退出 0、输出 `1`、无输出，即 feature 只多一个 commit、base 引用未改、提交无过程文档。
7. **询问整合与清理。** 先报告最终变更面：逐项列出既有生产文件的修改/删除及对控制流、状态、事务、异常、补偿、协议、权限的影响、共享资源/容量影响和未执行压测/运行验证；新增文件可按职责分组，测试通过不能替代影响说明。然后询问：“是否将 `<base-branch>` rebase 到 `<feature-branch>`，并在成功后删除开发分支和 worktree？这会同时删除 worktree 中未提交的生命周期、评审和计划过程文档。”这替代 `superpowers:finishing-a-development-branch`；禁止自动调用或展示其菜单。

   用户拒绝/暂缓：输出 feature 分支、worktree、唯一 commit、验证结果和保留过程文档后结束，不清理。用户明确同意：保存 `<feature-head>` 和 tree ID；确认原工作区仍在 `<base-branch>` 且干净、feature worktree 除三目录外无未提交项、`git merge-base --is-ancestor <base-branch> <feature-branch>` 成功。任一失败即暂停，禁止 stash/丢弃/清理；base 已前移且非祖先则回步骤 4 rebase 最新 base，再做步骤 5–6。

   前置通过后在原工作区 base 执行 `git rebase <feature-branch>`；base HEAD/tree ID 必须分别等于 `<feature-head>`/其 tree ID。相同仅为移动到已评审代码树，不复审或重跑完整门禁；不同则暂停并保留分支/worktree，先评审验证实际内容。

   只有验证相同后，先把 `specDocumentPath` 从 worktree 路径改写为 `<repo-root>` 下相同仓库相对路径，并确认目标是已整合的 Stage 1 Markdown spec；再按 Feature Kanban 协议上报 `completed` / `integrated` 完整快照。然后解析确认 `<worktree-path>` 是已注册 feature worktree，且不是 `<repo-root>` 或宽泛目录，再从原工作区运行 `git worktree remove --force <worktree-path>`、`git branch -d <feature-branch>`、`git worktree prune`。`--force` 只删除用户在本步明确同意放弃的过程文档；有其他未提交内容时禁用。

   确认 `git branch -d <feature-branch>` 成功且开发分支已不存在后，调用 `PATCH /api/cards/{cardId}/archive` 并发送 `{ "archived": true }`。归档失败不影响已确认的 `completed` 状态：直接向用户报告简短错误，不重建已删除的生命周期文档，不循环重试，也不恢复分支或 worktree。最终输出 base、commit、删除的分支/worktree、归档结果，并说明过程文档随 worktree 删除且无法从 Git 恢复。

## Feature Kanban 上报协议

看板只保存当前生命周期快照和 AI 会话历史；详细 JSON、合法 step、重试身份和错误语义以 [Feature Kanban API reference](references/feature-kanban-api.md) 为准。

- Phase 2 初始化成功后，后续只使用 `PATCH /api/cards/{cardId}`，并发送全部可变字段；不得发送部分更新。
- 在阶段进入或完成、Stage 4 有意义的编码/验证/评审/修复变化、等待用户、阻塞、恢复和最终整合结果时上报；不得按命令产生噪声事件。
- 生命周期映射固定为：初始化 `initializing`，Stage 1 `designing`，Stage 2 `requirements_review`，Stage 3 `implementation_planning`，Stage 4 `implementing_and_reviewing`，Stage 5 整理分支期间 `finalizing_branch`，等待整合确认时 `awaiting_integration`，base 实际整合成功后 `completed`。
- Stage 4 按当前实际状态使用 `coding`、`validating`、`reviewing` 或 `fixing`，并在已知时携带 implementation batch、review round 和 consecutive clean review 计数。每个 Stage 4 完整快照都必须发送 `implementationSummary`：用不超过 10 个 Unicode 字符简述当前批次实际内容（如“服务端存储”“前端交互”），禁止只写“批次1”、`batch 2` 等序号标签。
- 每次只发送当前 AI session；恢复同一流程沿用文档中的 `cardId`，新 AI 会话生成新的 `sessionRecordId`。真实会话 ID 后来可用时沿用同一 session record 补充，禁止虚构 ID 或链接。
- 用户归档不改变生命周期；下一次成功 PATCH 自动取消归档。合法阶段回退直接上报回退后的完整快照。
- 每次 API 失败都更新生命周期文档的“看板同步”并继续本地流程；下次成功后清除失败。禁止循环重试，禁止由 Skill 启动、停止、安装或修复服务。

## 异常处理

- 编译/验证失败：按项目指令定位并只修本次变更；无法归因则暂停并报告证据。
- 必需 skill 失败：确认名称和原生加载机制；仍不可用则暂停，禁止跳过阶段。
- worktree 失败：报告实际命令、路径和错误；禁止退回原工作区或自动删除 worktree、分支、用户文件。
- 评审到 5 轮仍不收敛：保留末轮报告和全部具体未解决缺陷，暂停让用户决定继续或接受风险；理论疑虑不能增加预算。
