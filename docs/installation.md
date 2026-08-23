# 安装与运行

## 源码模式

安装 Node.js 24.15.0 或更高版本与 npm 11，在仓库根目录运行：

```powershell
npm ci
npm start
```

服务默认监听 `127.0.0.1:46171`，业务数据与日志保存在 `%USERPROFILE%\.feature-kanban`。可用 `FEATURE_KANBAN_PORT`、`FEATURE_KANBAN_DATA_DIR` 和 `FEATURE_KANBAN_STATIC_DIR` 覆盖源码开发配置；监听地址只允许 `127.0.0.1` 或 `localhost`。所选端口已被占用时，服务会显示具体端口并停止，不会接管占用进程。

`npm start` 只是独立运行看板服务。它不会启动 Codex，也不会由 Skill 自动调用。

## Windows 安装器

运行 `FeatureKanbanSetup.exe` 后，先选择一个本地程序父目录；默认父目录是 `%LOCALAPPDATA%`，实际应用根目录固定为所选目录下的 `Feature Kanban` 子目录。该选择只移动程序文件，不移动数据或 Skill。安装内容包括：

- 编译后的 Node 服务与启动器
- Angular 静态资源
- 通过本机 Codex App Server 创建任务的服务端适配层
- Codex 注入脚本
- AI 工具共用的完整 `feature-lifecycle` Skill
- 卸载脚本与安装记录

安装过程发生错误时，安装器会显示具体失败信息并以失败状态退出。安装器在创建快捷方式和 Windows 卸载项前写入带产品身份的 `installation.json`；如果最终化随后失败且“已安装的应用”中尚未出现 Feature Kanban，可运行已复制的卸载脚本进行安全清理：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<程序目录>\Feature Kanban\installer\uninstall.ps1" -InstallRoot "<程序目录>\Feature Kanban"
```

卸载脚本仍会校验本地固定磁盘、目录名称和清单身份；业务数据与日志保持在 `%USERPROFILE%\.feature-kanban`。这不是安装失败后的自动回滚。

安装器不创建开始菜单快捷方式。桌面没有同名快捷方式时创建 `Codex`；若已经存在，则创建 `Codex (Feature Kanban)`，不覆盖官方入口。实际安装根目录中还会创建两个入口：

- `启动 Codex 与任务看板`：通过无控制台窗口的托管启动器打开 Codex 并注入任务看板；关闭 Codex 后，启动器仍会按服务所有权规则清理自己启动的看板服务。
- `启动任务看板服务`：不启动 Codex，只在可见窗口中以前台方式运行看板服务；监听成功后自动用默认浏览器打开 `http://127.0.0.1:46171`。关闭窗口或按 Ctrl+C 即停止该服务。端口已被占用时不会接管或终止占用进程，也不会打开浏览器，错误会保留在窗口中。

桌面和安装目录中的入口都使用本机 Node.js 24 或更高版本；可通过 `FEATURE_KANBAN_NODE_PATH` 指定绝对路径，否则从启动环境的 PATH 查找。安装包不携带 Node.js。升级安装会清理旧版本留下的精确开始菜单 `Feature Kanban\Codex` 入口，但不会删除同一开始菜单目录中的其他内容。

程序目录支持空格、中文、一般 Unicode、单引号、`&`、括号和方括号。为防止安装或卸载误伤，以下目录会在复制前被拒绝：UNC/网络目录、盘符根目录、重解析点、非法或末尾带空格/点的路径、使打包文件超过 Windows PowerShell 5.1 可靠长度的路径，以及包含非本产品文件的既有 `Feature Kanban` 目录。目录不可写时同样在安装 Skill 或写注册表前停止。已有安装只能原地升级；若要改变程序目录，先卸载再重新安装。

无论程序安装在哪里，业务数据库和日志始终位于 `%USERPROFILE%\.feature-kanban`，Skill 始终位于 `%USERPROFILE%\.agents\skills\feature-lifecycle`。

## 托管 Codex 行为

通过新快捷方式启动时：

1. 第二次启动只激活已有托管 Codex。
2. 若检测到绕过快捷方式运行的官方 Codex，弹窗要求先关闭它，不自动终止，也不启动第二份。
3. 若 `http://127.0.0.1:46171/api/health` 已有合法手工服务，则复用且退出时不关闭；若该端口是其他监听者，则明确报错且不创建服务进程。
4. 否则启动器创建服务并持有其进程；托管 Codex 退出后只停止这一个服务。
5. Codex 使用官方默认 profile，仅增加回环 CDP 参数。CDP 固定监听 `127.0.0.1:46172`；该端口被占用时启动器不会启动 Codex。启动器通过 CDP 绕过页面 CSP、注入侧边栏入口，并对替换后的 renderer 重新注入。

注入依赖 Codex 当前的 renderer DOM 标记和内部路由消息。会话跳转优先点击 thread ID 完全匹配的侧边栏条目；找不到时通过 `/local/<threadId>` 路由加载，并验证目标条目已被选中，不会刷新 Renderer 或把旧对话误报为成功。Codex 更新后若结构改变，看板仍可独立访问，但原生入口/会话跳转可能需要适配。

## Headless Codex 任务

看板的验证入口通过本机 `codex app-server` 在服务端创建持久化用户线程并立即执行首条提示词。可用 `FEATURE_KANBAN_CODEX_PATH` 指定 Codex 的绝对可执行文件，否则从服务进程的 PATH 查找 `codex`。安装包不包含 Codex、Node.js 或任何平台原生运行时。

创建任务不要求 Codex Desktop 正在运行。要让任务稍后出现在 Desktop 侧边栏，看板服务与 Desktop 必须由同一个操作系统用户运行并共享同一个 `CODEX_HOME`；以系统服务账号、其他用户或不同 `CODEX_HOME` 创建的线程不会自动出现在当前用户的 Desktop 中。Desktop 已经打开时，点击看板中的“打开 Codex 对话”会通过 Desktop 内部路由加载该线程并将其加入侧边栏，不会刷新整个 Renderer。

本开发任务运行在 Codex 内，因此没有关闭当前 Codex 去执行破坏性的真实启动—退出验收；启动器生命周期使用可注入的假进程、服务与 CDP 端点完成自动验证。

## macOS DMG 安装

macOS 14 或更高版本使用与机器架构匹配的磁盘映像：

- Apple Silicon：`FeatureKanban-<版本>-macos-arm64.dmg`
- Intel：`FeatureKanban-<版本>-macos-x64.dmg`

打开 DMG 后把 `Feature Kanban.app` 拖到系统 `/Applications` 或当前用户的 `~/Applications`。必须先复制再启动；从已挂载 DMG 或其他目录直接运行会在写 Skill、安装记录、启动服务或启动 ChatGPT/Codex 之前停止。unsigned 文件名带 `-unsigned`，仅用于开发验证。

首次成功启动会验证应用名称、bundle identifier、架构和完整 payload 清单，然后把包内完整 `feature-lifecycle` Skill 部署到 `~/.agents/skills/feature-lifecycle`。已有内容先复制到 `~/.feature-kanban/skill-backups`；替换与 `~/.feature-kanban/macos-installation.json` 的原子提交属于同一可回滚事务。Skill 更新失败时恢复原内容、记录有界错误并显示原生警告，看板仍可继续；安装记录提交失败则在启动服务或桌面应用前停止。

启动器按以下顺序发现官方桌面应用：`/Applications/ChatGPT.app`、`~/Applications/ChatGPT.app`，随后是同位置的兼容回退 `Codex.app`。高级诊断可在启动器继承的环境中设置 `FEATURE_KANBAN_CODEX_APP` 为明确的 `.app` 路径。检测到不是由 Feature Kanban 启动的官方应用时会要求先关闭，不会附着或终止它。

当前官方产品把 ChatGPT 与 Codex 放在同一桌面应用中。Feature Kanban 只负责用回环 CDP 参数启动该官方应用、注入入口并沿用它已有的 profile 和当前/默认工作区；没有受支持的私有接口可保证强制切换到 Codex 视图。缺少 Codex renderer 标记或 `electronBridge` 路由时，会话操作继续使用现有复制 ID 回退。

卸载前关闭托管的 ChatGPT/Codex，然后在 Terminal 运行对应安装位置的启动器：

```bash
"/Applications/Feature Kanban.app/Contents/MacOS/FeatureKanbanBootstrap" --uninstall
# 或：
"$HOME/Applications/Feature Kanban.app/Contents/MacOS/FeatureKanbanBootstrap" --uninstall
```

卸载会先探测仍在运行的单实例，再验证安装记录、bundle 名称与 identifier、非符号链接路径、payload 清单和精确 Applications 位置。未修改的已部署 Skill 会删除并恢复备份；已修改或意外缺失的 Skill 与备份都会保留并报告手工恢复路径。只有完全验证的标准位置 `Feature Kanban.app` 才会递归删除；从非标准诊断位置执行时只处理合法 Skill 记录并要求手工移到废纸篓。数据库、日志和所有 Skill 备份始终保留在 `~/.feature-kanban`。

## 构建、签名与公证 macOS 安装器

在目标架构的 macOS 14+ 主机选择 nvm current 的 Node.js 24.15 或更新的 Node 24 版本，安装依赖后运行：

```bash
nvm use 24
npm ci
npm run check:macos
```

脚本优先读取 npm 传入的 `npm_node_execpath`，把这份 nvm current Node 复制到 `dist/macos/<架构>/build` 后再处理；不会对 nvm 中的原文件执行 `codesign`。`FEATURE_KANBAN_MAC_ARCH` 可显式设为 `arm64` 或 `x64`，但必须等于当前物理硬件；Rosetta 翻译进程会被拒绝。两个发布物分别在匹配主机生成，不能用仿真或未经验证的交叉打包代替。

未设置凭据时，命令生成 `FeatureKanban-<版本>-macos-<架构>-unsigned.dmg`。正式发行必须先把 App Store Connect API 或 Apple ID 公证凭据保存为 `notarytool` keychain profile，再同时设置：

```bash
export FEATURE_KANBAN_SIGNING_IDENTITY="Developer ID Application: Example Corp (TEAMID)"
export FEATURE_KANBAN_NOTARY_PROFILE="feature-kanban-notary"
npm run check:macos
```

两个变量缺一会在 staging 前失败。signed 模式只给私有 Node 副本授予 V8 所需的 `allow-jit` entitlement，按嵌套可执行文件、payload 清单、外层 app、DMG 的顺序签名，随后执行 `codesign --verify --deep --strict`、只读挂载检查、`notarytool --wait`、staple/validate 与 Gatekeeper 检查。正式文件名不含 `-unsigned`。

每个发布候选都必须在 Apple Silicon 与 Intel 各运行一次 `npm run check:macos`。签名版本还必须完成真实人工烟测：拖拽复制、首次 Skill 部署、服务所有权、统一 ChatGPT/旧 Codex 发现、原生入口注入、第二次启动激活、托管应用退出清理、修改后 Skill 的卸载保护，以及 app 删除。Intel 版本还取决于当时官方 ChatGPT/Codex 是否提供兼容构建。当前 Windows 开发会话只能验证跨平台 TypeScript、合成包与脚本合同，不能声称已运行 DMG、Swift、Gatekeeper、公证或真实桌面集成。

## Skill 安装目标

安装器只向以下共享位置部署 Skill：

- `%USERPROFILE%\.agents\skills\feature-lifecycle`

已有目录先备份到 `%USERPROFILE%\.feature-kanban\skill-backups`，安装记录保存部署内容哈希。卸载时：

- 当前内容仍等于部署哈希：删除部署版并恢复备份。
- 当前内容已被用户修改：保留当前目录与备份，并输出手工恢复路径。

该 Skill 目录被锁定或不可写时，安装器会恢复其原内容，继续保留已安装的看板主体，并在结束时显示失败路径；详细错误保存在所选程序目录的 `installation.json`。

手工安装同样只把仓库 `skills\feature-lifecycle` 完整复制到 `%USERPROFILE%\.agents\skills\feature-lifecycle`。Skill 内容保持工具中立，由 AI 在运行时记录 `codex`、`claude` 或实际工具名。Skill 只调用 API；服务不可用时在生命周期文档记录同步失败并继续，不负责启动服务。

## 卸载与数据

从 Windows“已安装的应用”卸载会删除所选程序根目录、所创建的快捷方式和对应注册项，并按哈希规则处理 Skill。卸载器在任何递归删除前同时验证目录形态、`installation.json` 的产品标识以及清单中的规范化安装根目录；任一项不匹配就拒绝清理。业务数据库、日志和 Skill 备份保留在 `%USERPROFILE%\.feature-kanban`，除非用户之后明确手工删除。

## 本地安全边界

- 服务只监听回环地址。
- 浏览器 Origin 只接受 HTTP 回环来源；非浏览器本机调用可以没有 Origin。
- API 不使用 token。任何本机进程都能创建或更新卡片。
- 看板不读取 Git、worktree、聊天输出、命令日志或测试日志。
