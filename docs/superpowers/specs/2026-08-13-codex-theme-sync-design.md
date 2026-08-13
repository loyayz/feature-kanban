# Codex 主题同步设计

## 目标与现状

Feature Kanban 嵌入 Codex 时必须使用与宿主一致的浅色或深色主题；Codex 在运行时切换主题后，看板也应立即更新。独立浏览器模式继续跟随系统 `prefers-color-scheme`。

当前看板已经有浅色、深色两套 CSS 变量，并在 iframe 首次握手时接收宿主主题。实际 Codex 桌面页面在深色模式下把根节点标记为 `electron-dark`，但注入脚本只识别 `dark` 或 `data-theme="dark"`，因此会错误发送 `light`。注入脚本也只在首次握手时发送主题，不能处理运行时切换。现有深色变量偏蓝灰，与 Codex 当前使用的中性灰色表面层级不一致。

## 方案比较与选择

推荐方案是在注入层集中解析宿主主题，兼容 `electron-dark`、`electron-light`、旧的 `dark`/`light` 标记和 `data-theme`，再以计算后的 `color-scheme` 或系统偏好作为兜底。首次握手和根节点主题属性变化时都复用现有 `feature-kanban:ready` 消息发送主题；Angular 现有处理逻辑允许重复接收该消息，因此无需扩展消息协议。看板本地变量改为更接近 Codex 的中性表面、文字、边框和蓝色强调色。

只依赖 `prefers-color-scheme` 的方案实现最少，但当 Codex 显式主题与系统不同步时仍会显示错误。把 Codex 的整套 CSS 自定义属性跨 iframe 传给看板可以做到逐值复制，但会扩大消息协议、增加输入校验和对 Codex 私有变量名的耦合，不符合本次低侵入目标。

## 组件与控制流

`inject/feature-kanban.user.js` 增加单一的宿主主题解析函数。解析顺序为明确的 Codex Electron 类名、兼容类名与 `data-theme`，然后是根节点计算后的 `color-scheme`，最后才是系统媒体查询。明确的浅色标记优先于兜底，避免系统深色覆盖 Codex 的显式浅色选择。

iframe 发送合法 `feature-kanban:hello` 后，注入层保存 challenge，并以现有 `feature-kanban:ready` 响应当前主题。独立的根节点属性观察器只监听 `class`、`data-theme` 和 `style`；主题值实际改变且已有合法 challenge 时，向同一个 iframe 再发送一次 `feature-kanban:ready`。发送前比较最近一次主题，避免无关属性变化产生重复消息。销毁注入时同时断开该观察器。

`web/src/app/core/codex-host.service.ts` 保持现状：每次收到来自父窗口、challenge 匹配的 `feature-kanban:ready` 时，把 `data-host-theme` 设置为 `dark` 或 `light`。这让现有 CSS 变量即时重算，不需要刷新页面或新增 Angular 状态。

`web/src/styles.css` 保留现有变量接口和独立运行兜底，只调整浅色与深色变量值。深色表面使用 Codex 当前的 `#181818` 主背景、`#232323` 面板和 `#141414` 下沉层级，文字与边框采用中性透明白层级，强调色使用 Codex 蓝色。浅色变量同步改为中性白/灰层级，避免嵌入浅色 Codex 时出现蓝灰色偏差。状态色仍保持足够对比度，不改变状态含义。

## 错误与兼容性

无法识别宿主标记时不阻塞看板：先使用计算后的 `color-scheme`，仍不明确时使用系统偏好。非法来源、非法 challenge 和未知消息继续被忽略。主题同步复用既有消息类型和字段，不新增公共 API、REST 数据、持久化状态或安全边界。

Codex 未来若改变类名但仍正确设置 `color-scheme`，兜底仍能工作；若两者同时改变，看板最多回退到系统主题，不影响卡片数据和导航功能。

## 验证策略

生产实现完成后，在现有注入测试中增加最小行为场景：`electron-dark` 首次握手返回深色；根节点从 `electron-dark` 切换为 `electron-light` 后只发送一次新的浅色主题；销毁后不再发送主题消息。运行注入专项测试、Angular UI 测试、类型检查以及仓库完整 `npm run check` 门禁。

通过当前托管 Codex 的 CDP 只读检查确认实际宿主使用 `electron-dark`、计算后的 `color-scheme: dark`、主表面 `rgb(24, 24, 24)`。不修改用户的 Codex 设置，不执行安装器或打包。

## 变更面契约

### 交付目标和预计新增内容

交付目标是让嵌入式看板在首次打开和 Codex 运行时主题切换时保持同主题，并让浅/深配色与 Codex 的中性色阶协调。本次不新增生产模块、公共接口、配置、依赖、持久化数据或后台进程；只在现有注入测试中新增主题同步场景。

### 预计修改的既有生产模块

- Codex 注入层 `inject/feature-kanban.user.js`：扩展宿主主题识别，监听根节点主题属性，并在主题改变时复用现有 ready 消息。影响仅限嵌入页面的展示主题；不改变入口挂载、会话导航、origin/challenge 校验或生命周期数据流。
- Angular 全局样式 `web/src/styles.css`：调整既有浅/深 CSS 变量的色值。影响仅限视觉呈现；不改变组件结构、交互、动画、状态语义或布局。

不修改或删除其他生产模块。`web/src/app/core/codex-host.service.ts` 作为现有消费端保持不变。

### 受保护行为与契约

- 继续严格校验 iframe 来源、消息来源和 challenge；不放宽跨窗口消息边界。
- 继续使用现有 `feature-kanban:ready` 消息结构，不增加外部线协议或 REST API。
- 独立浏览器模式继续根据系统主题显示；无法识别宿主主题时仍可用。
- 不改变看板数据、阶段、归档、筛选、导航、布局和动画行为。
- 不读取、修改或持久化 Codex 私有设置。

### 资源、容量与未验证项

新增一个仅观察根节点三个属性的 `MutationObserver`，不扫描子树，不产生网络请求；资源影响可忽略。自动化环境不能模拟未来 Codex 版本的全部主题实现，未执行跨版本视觉回归或长期性能测试。

### 低侵入方案与保真度损失

最低侵入方案仅增加 `electron-dark` 判断，不调整配色也不监听切换。它能修复当前首次打开的深色误判，但用户在 Codex 内切换主题后仍需重载，并且看板蓝灰配色与 Codex 中性表面仍有明显差异，因此不采用。

本次未触发变更面硬门禁：不改变业务控制流、Domain 模型、数据语义、持久化协议、事务、异常、重试、权限、安全边界、公共 API 或外部线协议。
