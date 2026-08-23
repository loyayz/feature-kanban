# 任务看板交互与预览修复设计

## 目标与已确认现象

本次交付修复 Codex 宿主入口、活动看板投影、项目徽标、项目目录打开、需求文档预览、Markdown 行内代码展示和 Feature Lifecycle 匿名会话上报，并核查宿主失焦是否由 Feature Kanban 注入引起。

当前运行服务提供了可复核证据：`feature-kanban` 的项目聚合 `activeCount` 为 1，唯一未归档卡片处于 `initializing`；现有前端只渲染从 `designing` 到 `awaiting_integration` 的六个阶段，因此在项目未选中时徽标使用服务端聚合值 1，选中后使用过滤掉初始化卡片的可见投影值 0。目录打开请求对带 `projectPath` 的现有卡片返回 HTTP 204，证明详情按钮、卡片作用域 API、持久化路径和路由已走通，失败边界位于 Windows 文件管理器启动的可见结果；当前实现只等待 `explorer.exe <path>` 发出 `spawn` 事件，不能保证出现一个独立可见窗口。Markdown 预览只解析块结构，所有块内文本均直接插值，反引号从未被识别为行内代码。Codex 注入脚本没有调用 `focus()`、`blur()`、`preventDefault()` 或 `stopPropagation()`；捕获监听器只在看板激活且用户点击原生侧栏时隐藏自有面板，现有代码证据不支持它会主动夺取原生对话输入焦点。Feature Lifecycle 文档允许在本地生命周期文档中用 `unavailable` 表示未知真实会话 ID，但 API 示例始终携带 `externalSessionId`，没有明确禁止把 `null`、空字符串或该占位值复制到 JSON，因而会诱发服务端拒绝可选看板初始化上报。

成功后，任务看板入口在激活时具有与 Codex 原生当前项一致的选中语义和可见高亮；进行中看板从最左侧“初始化”开始展示七列；项目徽标在切换到该项目时不因初始化卡片被隐藏而变化；Windows 上打开项目使用明确的新 Explorer 窗口；预览在独立的大尺寸模态对话框中展示；成对单反引号不显示，内部文字按行内代码高亮；宿主焦点回归测试证明本项目的被动观察与面板隐藏不会改变原生已聚焦元素；真实会话 ID 未知时，Skill 生成的 API `session` 对象完全省略 `externalSessionId`，绝不发送 `null`、空字符串或 `unavailable`。

## 方案比较与选择

推荐采用现有边界内的手术式修复。宿主入口补充 `aria-current` 和 Codex 已使用的选中数据属性，并保留现有 class 作为兼容回退；看板把 `initializing` 加入当前活动投影；Windows 文件资源适配器为 Explorer 增加新窗口参数；详情仍负责加载 spec，但把结果交给独立预览对话框；Markdown 组件新增安全的行内 token。该方案文件少、无新依赖，不改变服务契约或数据语义。

替代方案一是引入 Angular CDK Dialog 与完整 Markdown 库。它能得到更丰富的 Markdown 兼容和现成的模态焦点管理，但会为目前只要求行内代码与大窗口预览增加两套依赖、HTML 清理策略和构建体积，不符合本次范围。

替代方案二是修改服务端项目聚合与卡片查询，让 API 直接返回每个筛选投影的徽标计数，并把文件打开改成新的宿主 IPC。它能集中所有计数和桌面集成语义，但会修改公共 API、跨进程协议和更多调用方；当前计数问题由缺失初始化列直接导致，目录接口也已成功到达服务端，因此这一级扩张没有必要。

## 组件与数据流

`inject/feature-kanban.user.js` 继续只创建自有入口、面板和样式。激活状态同时写入 `aria-pressed`、`data-active`、`aria-current="page"` 和 `data-app-action-sidebar-thread-selected="true"`；停用时移除后两个原生选中语义。抑制原生旧选择背景的 CSS 明确排除自有入口。脚本不调用焦点 API，不取消或重派发 Codex 事件；无关 DOM 变化不重新创建或移动稳定的入口/面板。

`BoardPageComponent` 的活动阶段按协议顺序变为 `initializing`、`designing`、`requirements_review`、`implementation_planning`、`implementing_and_reviewing`、`finalizing_branch`、`awaiting_integration`，最左列中文名为“初始化”。活动视图使用七等宽列；归档视图继续使用现有六列卡片密度展示全部归档卡片，不因活动视图增加一列而顺带变窄。项目徽标始终使用 `ProjectSummary.activeCount` 或 `archivedCount`，不再在选中项目时切换成当前已加载卡片长度；因此项目切换和工具筛选不会改变代表项目总量的角标。状态行继续单独表示当前筛选后的可见卡片数。`completed` 仍不进入未归档活动投影，生命周期状态机与归档行为不变。

`NativeLocalCardResources` 在 Windows 上仍只接收仓储保存且已验证为目录的路径，但用 Explorer 的显式新窗口参数启动目录；macOS 继续使用 `open <path>`。路由、请求体、状态码和错误映射不变。启动失败仍转为现有稳定错误，成功仍以进程被系统接收为边界；不增加常驻子进程。

`CardDetailComponent` 继续发起 `GET /api/cards/{id}/spec-document` 并持有加载和错误状态。成功后详情抽屉保持原位，额外渲染一个覆盖抽屉和主看板的大尺寸 `SpecPreviewDialogComponent`。对话框显示文档路径、复制与关闭操作，内容区域在桌面端拥有接近视口的宽度和高度，小屏幕退化为带边距的全屏面板；点击遮罩或关闭按钮只关闭预览，不关闭详情。加载失败仍在详情中显示现有错误。

`MarkdownPreviewComponent` 把标题、段落、引用和列表项文本解析为 `text` / `inline-code` 两类行内 token。成对单反引号之间的非空内容渲染为 `<code>`，反引号本身不显示；未闭合反引号保留为普通文本，围栏代码块继续走现有块解析。所有文本仍通过 Angular 插值渲染，不绑定原始 HTML，因此现有脚本与 HTML 注入防护不变。

Feature Lifecycle 的阶段二参考与 Feature Kanban API 参考共同定义匿名会话上报：生命周期文档可继续写 `unavailable` 作为仅供人工阅读的本地占位符，但创建或更新请求的 `session` JSON 在真实 ID 不可得时必须完全省略 `externalSessionId`。后续取得真实 ID 时，使用同一个 `sessionRecordId` 在 PATCH 中补充该字段。服务端校验、数据库结构、重试策略和外部线协议语义均不改变。

## 失焦调查与验证

焦点调查以可达路径为限，不通过猜测新增全局焦点恢复、定时器或事件拦截。注入测试将覆盖：入口激活和关闭不会对已有原生输入调用焦点方法；无关 DOM 变更后 `document.activeElement` 保持不变；原生侧栏点击仍完整送达、未被取消，并只隐藏自有面板；iframe 自身的 focus/blur 不控制面板。若这些门禁通过，结论为“当前 Feature Kanban 集成没有可复现的主动失焦路径”；偶发失焦仍作为未能在 jsdom 中重现的 Codex 运行时现象报告，而不伪造修复。

## 错误处理与测试

生产实现完成后补最小行为测试。注入测试验证选中语义、高亮兼容、原生事件和焦点保持；看板测试验证七列顺序、初始化卡片、工具/项目切换前后稳定的服务端聚合徽标以及独立的可见卡片数；本地资源测试验证 Windows 新窗口参数、macOS 行为和 spawn 错误；详情测试验证预览以独立模态呈现、关闭预览不关闭详情以及加载失败；Markdown 测试验证标题、段落、引用、列表中的行内代码、未闭合反引号和 HTML 惰性文本；Skill 契约测试解析创建与更新示例，验证匿名创建省略字段、后续更新复用会话记录 ID 并补入真实 ID，同时校验参考文档明确拒绝无效占位值。专项验证依次运行注入、服务端、Web 和 Skill 测试，最终执行项目完整 `npm run check`。

## 变更面契约

交付目标限定在 Feature Kanban 的 Codex 注入、活动看板展示、桌面目录打开、需求预览和随仓库发布的 Feature Lifecycle 上报说明。预计修改的既有生产文件为：`inject/feature-kanban.user.js` 的自有入口选中语义；`web/src/app/board/board-page.component.ts` 与 `.css` 的活动投影、稳定项目聚合计数和七列布局；`web/src/app/board/card-detail.component.ts`、`.html`、`.css` 的预览协作；`web/src/app/board/markdown-preview.component.ts`、`.html`、`.css` 的安全行内 token；`src/server/local-card-resources.ts` 的 Windows Explorer 参数；`skills/feature-lifecycle/references/phase-2-lifecycle-plan.md` 与 `feature-kanban-api.md` 的匿名会话字段规则。预计新增一个仅负责模态结构和布局的 `web/src/app/board/spec-preview-dialog.component.ts` 及其模板、样式和测试。对应既有测试按行为更新，不删除生产文件。

受保护行为包括 Codex 原生导航、路由、点击、选择与焦点机制；注入入口位置、面板切换、主题同步、会话跳转和重挂载生命周期；八阶段协议、阶段迁移、归档语义、项目隐藏、AI 工具筛选、SSE 刷新和数据库聚合；卡片作用域目录/spec API、只使用已存路径、Markdown 大小/类型限制及 HTML 惰性展示；同一 `sessionRecordId` 的后续身份补充和可选看板上报失败不重试约束。用户本次要求“最左边加初始化列”，明确取代 2026-08-13 可用性设计中的六阶段活动展示约束，但不取代该设计的等宽单行、无页面级横向滚动、服务端项目聚合计数和独立可见流程数约定。没有数据库、事务、权限、安全边界、公共 API、外部线协议或生命周期状态机变更；新增说明只是把既有可选字段语义写成不可误用的生成规则，未触发额外变更面授权门禁。

资源影响限于活动视图多渲染一个列容器、打开预览时多渲染一个模态组件和已加载的最多 1 MiB Markdown token 数组。目录打开仍为一次性系统进程请求。本次不执行大文档性能压测、macOS 真实 Finder 验收或长时间 Codex 焦点遥测；这些是明确未验证项。低侵入方案不支持完整 CommonMark 行内语法，只忠实解决成对单反引号，避免引入第三方 Markdown/HTML 解析边界。
