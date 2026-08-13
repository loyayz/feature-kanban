# Feature Kanban

Feature Kanban 是一个支持 Windows 与 macOS 的本地单用户生命周期看板。一次 `feature-lifecycle` 流程对应一张卡片；Codex 或 Claude 通过回环 REST API 上报当前快照，Angular 看板按八个固定阶段展示进度。

它只管理本地项目视图，不读取聊天、不操作 Git/worktree，也不允许从 UI 修改阶段。

## 功能

- All 与按原始仓库目录名聚合的项目筛选
- Codex/Claude 工具筛选、进行中/归档视图
- 结构化阶段内进度、等待用户与阻塞标记
- SSE 定向刷新和卡片抬升—滑行—落位动画
- AI 会话历史、Codex 原生会话跳转与复制回退
- 托管 Codex 启停、单实例、手工服务复用
- 可选程序目录的每用户 Windows 安装器与安全的单目录 Skill 备份/恢复
- Apple Silicon 与 Intel 分架构的 macOS DMG、共享 Skill 事务安装和受保护卸载

## 源码运行

需要 Node.js 24.15.0 或更高版本以及 npm 11。Windows 安装器在 Windows 构建；macOS DMG 必须在对应架构的 macOS 14+ 机器构建。

```powershell
npm ci
npm start
```

`npm start` 构建服务与 Angular 页面，然后默认监听 `http://127.0.0.1:46171`。可用 `FEATURE_KANBAN_PORT` 覆盖源码模式端口；源码模式只运行看板服务，不启动或注入 Codex。

开发时可分别运行：

```powershell
npm run dev:server
npm run dev:web
```

`dev:server` 构建并运行仅后端服务；服务端源码变化后重启该命令。`dev:web` 提供 Angular 开发服务器并把 API/SSE 代理到 `46171`。

## 验证与安装包

```powershell
npm run check
```

完整门禁覆盖严格类型检查以及服务/UI/注入/启动器/Skill/安装器测试，不执行生产构建或 Windows 打包。

需要生成 Windows 安装包时单独运行：

```powershell
npm run build:installer
```

输出位于 `dist/installer/FeatureKanbanSetup.exe`。

安装器让用户选择本地程序父目录，默认安装到 `%LOCALAPPDATA%\Feature Kanban`；数据固定在 `%USERPROFILE%\.feature-kanban`，Skill 只安装到 `%USERPROFILE%\.agents\skills\feature-lifecycle`。不要在开发测试中执行安装器；安装逻辑通过包含空格、中文和符号的临时目录验证。

macOS 在对应硬件上运行 `npm run check:macos`，输出 `FeatureKanban-<版本>-macos-arm64[-unsigned].dmg` 或 `FeatureKanban-<版本>-macos-x64[-unsigned].dmg`。构建会复制启动本次 npm 的 nvm current Node 到私有目录；不会修改或签名原始 Node。未配置完整 Developer ID 与公证凭据时只产生明确标记的开发用 unsigned DMG，不可作为正式发行包。安装、签名、公证和真实 ChatGPT/Codex 验收步骤见安装文档。

## 文档

- [设计规格](docs/superpowers/specs/2026-08-12-feature-lifecycle-kanban-design.md)
- [macOS 安装器设计](docs/superpowers/specs/2026-08-13-mac-installer-design.md)
- [安装与运行](docs/installation.md)

本地 API 没有令牌，仅监听回环地址；任何本机进程都能写入，这是首版明确的安全边界。
