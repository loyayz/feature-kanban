# Codex 启动与内嵌看板交互缺陷修复设计

## 目标

修复 Windows 安装版从“启动 Codex 与任务看板”快捷方式启动后遗留控制台窗口的问题；让 Codex 内嵌看板顶部项目按钮的完整高度可点击；让项目计数与当前可见投影一致；并让“已归档”展示全部归档卡片且卡片宽度与“进行中”一致。

## 已确认根因

实际安装目录中的 Codex 快捷方式以 `powershell.exe` 为目标，参数通过调用运算符同步执行 `runtime\node.exe app\server\launcher\index.js`。PowerShell 因等待 Node 启动器退出而长期存活，控制台宿主与启动器共享生命周期；关闭该控制台会终止启动链，启动器随后无法继续托管看板服务。`-WindowStyle Hidden` 只尝试隐藏控制台，不会消除这个控制台宿主或同步等待关系。

实时只读 CDP 检查显示，内嵌 iframe 的宿主矩形从窗口纵坐标 36 开始，而 Codex 有一个固定 Electron `drag` 区域覆盖纵坐标 36–82。项目按钮位于 iframe 内纵坐标约 18–56，即窗口纵坐标约 54–92；按钮上方约 28 像素落在宿主拖拽区域中，只剩底部约 10 像素不重叠。iframe 内部 DOM 命中测试正常，故故障位于 Electron 宿主拖拽边界，而不是 Angular 按钮或筛选请求。

项目按钮计数来自 `/api/projects` 的全部未归档/归档聚合，而状态栏计数只统计当前页面实际展示的阶段。当前实例中一个 `designing` 卡片与一个未归档 `initializing` 卡片使项目聚合为 2，但进行中页面有意隐藏 `initializing`，因此只显示 1 个可见流程。

归档 API 已返回所有 `archived=true` 卡片，但页面把归档阶段集合固定为 `completed`，随后又按阶段过滤，并用单列全宽 CSS 拉伸卡片。因此非 `completed` 的归档卡片被丢弃，剩余卡片宽度也与进行中六列布局不同。

用户在本次需求中明确将“已归档”重新定义为所有 `archived=true` 卡片的集合。这一规则覆盖 `2026-08-13-codex-navigation-archive-regressions-design.md` 中“只展示已结束流程”的旧展示约束；它不改变卡片的阶段、归档字段或 API，只改变归档页面的投影。

## 方案比较

推荐方案把每个修复限制在产生故障的边界。Windows Codex 快捷方式改由无控制台的 Windows Script Host 启动一个随包安装的窄包装脚本；包装脚本设置安装根环境变量、隐藏启动 Node，并同步等待启动器退出。注入面板及 iframe 显式声明 `-webkit-app-region: no-drag`，从 Electron 拖拽命中区域中扣除 Feature Kanban 自有交互面。Angular 使用一个统一的可见卡片投影：进行中仍只含既有六个阶段，已归档则包含 API 返回的全部卡片；归档卡片直接按六等分轨道平铺。项目按钮在当前已加载范围可覆盖该项目时使用同一可见投影计数，其他未加载项目仍保留服务端聚合回退。

较小的启动修复是继续使用 PowerShell，但用 `Start-Process -WindowStyle Hidden` 派生 Node 后立即退出。这减少一个包装文件，却仍依赖控制台程序和 PowerShell 窗口隐藏/转义行为，无法像 GUI 子系统宿主一样从根源消除控制台窗口。顶部交互也可以把整个看板向下偏移一个硬编码工具栏高度，但会永久浪费内容空间，并耦合 Codex 当前的 46 像素私有布局。

较重的计数方案是扩展项目 API，使其接收工具、归档与阶段过滤并返回动态可见计数；归档也可重新建立八阶段横向流水线。它能让所有未选项目的数字始终精确，却改变公共 API 语义、增加服务端查询与前端请求耦合，并会重新引入八列宽度或横向滚动。当前缺陷只要求当前视图中的数字和卡片一致，不需要扩大服务器契约。

## 组件与数据流

`installer/launch-codex-hidden.vbs` 只接受安装根目录，设置进程级 `FEATURE_KANBAN_INSTALL_ROOT`，使用带引号的绝对路径构造 Node/launcher 命令，以窗口样式 0 启动并等待，然后转发退出码。`installer/install.ps1` 只对 `codex` 类型快捷方式把目标切换为系统 `wscript.exe` 并传入包装脚本与安装根；可见的“启动任务看板服务”快捷方式继续使用现有 PowerShell 前台窗口，关闭它仍按文档停止独立服务。

Node 启动器、单实例、Codex 进程监督与服务所有权逻辑不变。WScript 包装进程在 Node 启动器存续期间等待但没有控制台；Codex 退出时仍由 Node 启动器停止其拥有的看板服务，然后包装进程随退出码结束。启动器已有的消息框继续承担可见错误报告。

`inject/feature-kanban.user.js` 在创建自有 panel 和 iframe 时为两者设置 `-webkit-app-region: no-drag`。不修改、不取消、不模拟 Codex 的点击、拖拽、导航或窗口事件；已有侧栏关闭监听和跨源消息校验保持不变。

`BoardPageComponent` 提供一个统一的 `visibleCards` 计算投影。进行中使用原有六阶段集合；已归档直接使用 `BoardStore` 已按 `archived=true`、项目与工具过滤的全部卡片。进行中仍按阶段传给六个 `LifecycleColumnComponent`；归档视图直接复用 `LifecycleCardComponent` 并按六个等宽轨道排列，每个卡片外层保留与进行中列相同的 9 像素横向内边距。空归档视图显示一个跨全部轨道的空状态。

项目计数在 `selectedProject === all` 时可从当前全部已加载卡片按项目计算；选中具体项目时，该项目计数从当前可见投影计算。未选项目没有加载对应卡片，继续回退到现有服务端聚合；`All` 使用各项目计数之和。这样当前选中项目和 All 视图都与页面可见卡片一致，同时不增加 API 调用或改变 `BoardStore` 的过滤控制流。

## 错误处理与兼容性

包装脚本参数缺失时返回非零退出码；安装包验证要求包装脚本存在，避免快捷方式指向缺失文件。路径继续支持空格、中文、单引号与 PowerShell 特殊字符，因为快捷方式参数由 WSH 参数解析，包装脚本再按 Windows 命令行规则分别引用可执行文件和脚本路径。

`no-drag` 只作用于 Feature Kanban 自有节点。若未来 Codex 删除重叠拖拽区域，该声明仍是无害的交互区域标注；若 Codex 更换主内容 DOM，既有 `rendererMain` 回退与重新挂载规则不变。

归档卡片保持原阶段与进度文本，不伪装成 `completed`。详情、取消归档、SSE 定向刷新、项目/工具过滤和归档 API 语义保持不变。

## 验证

生产实现后补最小行为测试。安装器测试验证 Codex 快捷方式使用 `wscript.exe`、参数包含包装脚本和安装根、服务快捷方式仍为可见 PowerShell，并验证包装脚本进入包清单。注入测试验证 panel 与 iframe 都带有 `no-drag`，且既有挂载、侧栏交互、消息源和 dispose 行为不变。

Angular 测试验证进行中仍是六阶段投影；选中项目的按钮计数排除隐藏 `initializing`；已归档请求仍使用 `archived=true`，所有返回阶段的归档卡片都出现；归档卡片使用六等宽轨道而不是全宽单列；详情与取消归档入口保持可用。

专项命令为 `npm run test:installer`、`npm run test:inject`、`npm run test:web`、`npm run verify:package`（在 Windows staging 后），以及最终完整门禁 `npm run check`。构建 Windows 安装包并重新安装后，手工双击 Codex 快捷方式应无控制台窗口，关闭 Codex 后看板服务仍按启动器所有权退出；在真实鼠标操作下项目按钮顶部、中央和底部均应可点击。未重新安装前，源码改动不会改变当前 `C:\programs\Feature Kanban` 的现有快捷方式。

## 变更面契约

交付目标限定为 Windows Codex 快捷方式宿主、Codex 自有注入面、Angular 看板投影与相应安装/使用文档。预计新增 `installer/launch-codex-hidden.vbs`。预计修改 `installer/install.ps1`、Windows 包清单验证与安装器测试；`inject/feature-kanban.user.js` 及其测试；`web/src/app/board/board-page.component.ts`、模板、样式及组件测试；`docs/installation.md`。

受保护行为包括：独立服务快捷方式必须保留可见控制台并允许关闭窗口停止服务；Node 启动器继续拥有 Codex/看板生命周期，复用的手工服务不被停止；不修改 Codex 原生事件、导航和拖拽机制；进行中仍仅显示既有六阶段；归档状态、卡片阶段、API、SQLite、SSE、公共类型与 Skill 上报协议不变；项目/工具选择仍使用既有服务端过滤。

运行资源变化是用一个无控制台 WScript 等待进程替换现有长驻 PowerShell 进程，不增加长期服务、端口、网络请求、数据库查询或共享容量。未执行项包括真实安装包重装后的人工窗口/鼠标验收、不同 Codex 未来版本的拖拽区域兼容性与大批量归档卡片的视觉压测。

低侵入方案保留 PowerShell 隐藏窗口、只给看板顶部增加 46 像素空白、删除项目数字并继续只显示 completed 归档卡片；它分别会保留控制台生命周期根因、耦合 Codex 私有尺寸、丢失计数信息和归档数据，保真度不足，因此不采用。

本设计不修改既有业务状态机、数据库/持久化语义、外部协议、事务/重试/补偿、权限/安全边界或用户目标外生产模块，未触发额外变更面授权门禁。
