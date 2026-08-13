# NoatinWork 二次开发与品牌替换方案

本文档是 OpenChamber 二次开发所有讨论决策的落档，作为后续实施的唯一基准。
实施时以本文件为准；与仓库内其他文档冲突时，先解决冲突再动手。

## 1. 决策总览

| 主题 | 决策 |
|---|---|
| 对象 | Fork `openchamber/openchamber`（MIT），长期自维护 |
| 工具链 | Bun 不动（运行时本就跑 Node，Bun 仅为开发侧包管理器/脚本执行器，迁移无用户价值） |
| 品牌 | 源码级一刀切，旧名一处不留；完成后重新初始化仓库抹掉 git 历史 |
| 品牌名 | 显示名 **NoatinWork**；技术标识小写 **noatinwork**；常量/环境变量 **NOATINWORK_** |
| 替换标准 | 含 `openchamber` 字样全改；中性功能键名（`setup-worktree`、`projectNotes` 等）不改；外部依赖地址（`anomalyco/opencode`）不改 |
| 端范围 | 四端全保留：Web、Desktop(Electron)、VS Code、Mobile(Capacitor) |
| 语言 | i18n 只留 `en` + `zh-CN`，删除其余 9 语言（两条独立通道）——**UI 消息包**（`packages/ui/.../i18n/messages`）：删 9 种 18 个文件（每个 `<lang>.ts` 及 `<lang>.settings.ts`：de、es、fr、ja、ko、pl、pt-BR、uk、zh-TW），留 en + zh-CN；**docs**（`packages/docs/content/docs`）：英文是**文件树根**（42 个 `*.mdx` + `troubleshooting/` 子目录 3 个 mdx，共 45），**待删的是 8 个语言**子目录 `de/ es/ fr/ ja/ ko/ pl/ pt-br/ uk/`（各含 42 mdx + `troubleshooting/` 3 mdx = 45 文件/目录，8 语言共 360 文件），**保留根英文 + `zh-cn/` 子目录**，并在保留面内做品牌词替换 |
| 规则/技能 | 12 个技能、20+ 模块文档、正确性不变量全保留（替换品牌词）；删除贡献向流程（CONTRIBUTING、CODEOWNERS、changelog-card、repro/） |
| 开发纪律 | 功能一律附加式开发（新增文件/路由/组件）；不碰核心（sync 层、stores 时序、会话/审批/终端生命周期） |
| 功能改造 | 暂不改造，保持官方功能原样 |
| 上游合并 | 定期 merge（不用 rebase）+ `git rerere` + CI 新增上游检测 job |
| CI | 主链保留改造（release 等随发布链改）、bot 类工作流遵循 §4.5「保留并替换」全部自建保留、仅删无用的贡献向非 bot 项——详见 §5 |
| 更新机制 | 自建发布源体系（域名 `noatin.com` 已持有）：官网 `work.noatin.com`、API `api.noatin.com`、文档 `docs.noatin.com`、中继 `relay.noatin.com`、下载 `download.noatin.com`——详见 §6 |
| 历史清理 | 品牌替换完成、功能稳定后重新初始化仓库，单初始 commit |

## 2. 品牌映射表

### 2.1 显示名层（NoatinWork，驼峰）✅ 已完成 (4352 替换)

| 位置 | 值 |
|---|---|
| UI 文案、About 弹窗、设置页、通知、标题 | NoatinWork |
| Electron `productName`、`app.setName` | NoatinWork |
| 窗口标题 `${productName} ${version}` | NoatinWork |
| 打包产物 | `NoatinWork-*.AppImage`、`NoatinWork-*.dmg`、`NoatinWork-*.exe`（electron-builder 由 `artifactName: "${productName}-..."` 模板自动生成，故只需改 `packages/electron/package.json` 的 `productName` 一处，产物名即自动跟随，勿逐个改模板） |
| 日志目录 | `~/Library/Logs/NoatinWork/` |
| VS Code `displayName`、marketplace 标题 | NoatinWork |
| Mobile `appName` | NoatinWork |
| CLI 文案（help、clack 提示、outro） | NoatinWork |

### 2.2 技术标识层（noatinwork，小写）✅ 已完成 (9040 替换)

| 类别 | 旧 | 新 |
|---|---|---|
| 包名 | `@openchamber/{ui,web,electron,mobile}`、`openchamber`(vscode) | `@noatinwork-app/{...}`、`noatinwork` |
| CLI 命令 | `openchamber` | `noatinwork` |
| 数据目录 | `~/.config/openchamber` | `~/.config/noatinwork` |
| legacy 项目目录 | `.openchamber` | `.noatinwork` |
| 日志文件名 | `openchamber-${port}.log` | `noatinwork-${port}.log` |
| 深链协议 | `openchamber://`、`openchamber-ui://` | `noatinwork://`、`noatinwork-ui://` |
| Electron userModelId | `dev.openchamber.desktop[.dev]` | `dev.noatinwork.desktop[.dev]` |
| 桌面名 | `openchamber.desktop` | `noatinwork.desktop` |
| Mobile appId | `com.openchamber.app` | `com.noatinwork.app` |
| VS Code view/命令 id | `openchamber.chatView`、`openchamber.submenu`、`openchamber.xxx` | `noatinwork.*` |
| API 路由 | `/api/openchamber/...` | `/api/noatinwork/...` |
| IPC 事件 | `openchamber:open-session` 等 | `noatinwork:open-session` 等 |
| 配置文件名 | `openchamber.json` | `noatinwork.json` |
| Docker | 镜像/用户 `openchamber` | `noatinwork` |
| docker-compose/Caddyfile | `docker-compose.yml`（service/container/volume/注释）含 `openchamber`，`Caddyfile` 含反代路由 | 随本行一并替换 |

### 2.3 常量层（NOATINWORK_，全大写）✅ 已完成 (1138 替换)

| 类别 | 旧 | 新 |
|---|---|---|
| 环境变量 | `OPENCHAMBER_*`（**实测 67 个字面 `process.env` 读取点 + 16 个经 `env.*`/`environment.*` 解构或子进程 env 注入的读取 = 共 83 个唯一运行期契约**，清单见下） | `NOATINWORK_*` |
| 代码常量 | `OPENCHAMBER_PROJECT_NOTES_MAX_LENGTH` 等 | `NOATINWORK_*` |
| 浏览器注入全局 | `window.__OPENCHAMBER_*__`（跨 electron/vscode/ui 三端，**实测 31 个唯一标识符**，清单见下） | `window.__NOATINWORK_*__` |

**`OPENCHAMBER_*` 环境变量全量清单（83 个唯一运行期契约，替换脚本字段级输入）**：

- **67 个字面 `process.env.OPENCHAMBER_*` 读取**：`AGENT_TOOL_TOKEN`、`AGENT_TOOL_URL`、`ALLOW_REMOTE_OPENAI_COMPAT_URLS`、`ALLOW_UNAUTHENTICATED_LAN`、`API_ONLY`、`API_PREFIX`、`APNS_ENVIRONMENT`、`APNS_P8`、`ARGV0_TEST_MARKER`、`BUN_BINARY`、`BUNDLED_OPENCODE_CLI_DIR`、`COMPRESS_API`、`DATA_DIR`、`DESKTOP_LAN_ACCESS_ACTIVE`、`DESKTOP_LAN_ACCESS_BLOCKED_REASON`、`DESKTOP_NOTIFY`、`DEV_SHUTDOWN`、`DISABLE_PWA_DEV`、`DISABLE_WEBVIEW_HMR`、`DIST_DIR`、`ELECTRON_DEV`、`ELECTRON_LOAD_SERVER_UI`、`ELECTRON_USE_BUNDLED_UI`、`FS_EXEC_TIMEOUT_MS`、`GIT_BINARY`、`GIT_CHECK_IGNORE_TIMEOUT_MS`、`GITHUB_CLIENT_ID`、`GITHUB_SCOPES`、`GIT_READ_CACHE_TTL_MS`、`HMR_API_PORT`、`HMR_UI_PORT`、`HOST`、`MANAGED_PROCESS_REGISTRY`、`NODE_BINARY`、`OPENCODE_BIN`、`OPENCODE_CLI_VERSION`、`OPENCODE_CWD`、`OPENCODE_HEALTH_CACHE_MS`、`OPENCODE_HEALTH_CONSECUTIVE_FAILURES`、`OPENCODE_HEALTH_INTERVAL_MS`、`OPENCODE_HEALTH_TIMEOUT_MS`、`OPENCODE_PATH`、`PACKAGE_MANAGER`、`PORT`、`PUBLIC_ORIGIN`、`PUSH_RELAY_DISABLED`、`PUSH_RELAY_URL`、`RATE_LIMIT_MAX_ATTEMPTS`、`RATE_LIMIT_NO_IP_MAX_ATTEMPTS`、`RELAY_BATCH_WINDOW_MS`、`RELAY_URL`、`RUNTIME`、`SERVER_URL`、`SKIP_API_COMPRESSION`、`SKIP_LOCAL_SERVER`、`SKIP_OPENCODE_START`、`STARTUP_PERF`、`TARGET_ARCH`、`TEST_PROVIDER_KEY`、`UI_PASSWORD`、`UPDATE_API_URL`、`UPDATER_E2E_BUILD`、`VAPID_SUBJECT`、`VERBOSE_REQUEST_LOGS`、`VERSION`、`VSCODE_WEBVIEW_URL`、`WSL_BINARY`

- **16 个经 `env.*` / `environment.*` 解构或子进程 env 注入的真正运行期契约（同样可溯源到 `process.env`，脚本勿漏）**：`E2E`（`electron/updater-feed.mjs:39`）、`ELECTRON_INSTALL_COMMANDS`（`electron/scripts/ensure-electron.mjs:229`）、`ELECTRON_PKG_DIR`（`ensure-electron.mjs:285`）、`INTERNAL_PORT`（`web/server/lib/opencode/env-config.js:32`）、`OPENCODE_HOSTNAME`（`env-config.js:75`）、`OPENCODE_PORT`（`env-config.js:31`）、`SSH_ASKPASS_VALUE`（`electron/ssh-manager.mjs:415` 注入子进程 env、`:232/234/277` 由 shell 读取）、`SYSTEMD_UNIT`（`web/server/lib/opencode/openchamber-routes.js:8,131`）、`TERMINAL_SHELL`（`web/server/lib/terminal/shells.js:38,46`）、`TRY_CF_TUNNEL`、`TUNNEL_CONFIG`、`TUNNEL_HOSTNAME`、`TUNNEL_MODE`、`TUNNEL_PROVIDER`、`TUNNEL_TOKEN`（全部 `web/server/lib/opencode/cli-options.js:13-21`）、`UPDATER_E2E_URL`（`electron/updater-feed.mjs:44`）

> ⚠️ **隧道契约（重要）**：确有 `OPENCHAMBER_TUNNEL_*` 运行期读取（`TRY_CF_TUNNEL` + `TUNNEL_PROVIDER/MODE/CONFIG/TOKEN/HOSTNAME`，均在 `cli-options.js:13-21`），并非文档早前口径所称"无 TUNNEL 变量"。隧道 `serve` 参数合并逻辑在此函数内，替换时必须一并改，否则 `noatinwork serve --tunnel` 失效。这些走的是 `env.OPENCHAMBER_TUNNEL_*` 解构读取，不在 67 条字面 `process.env` 清单内，正是前文"83 vs 67"差异的根源。

> ⚠️ **口径说明**：67 为字面 `process.env.OPENCHAMBER_*` 读取点（可执行 js/mjs/ts，排除 test/docs）；16 为 `env.*`/`environment.*` 解构或子进程 env 注入（运行时同样是 `process.env`，含 `SSH_ASKPASS_VALUE`）；合计 **83 个唯一运行期契约**。150/152/663 等旧计数与 83 差异大，是因口径（字面 vs 解构 vs shell 字符串 vs 全量字符串出现）不同而显著漂移，验收以「`rg -i openchamber` 归零」为准而非具体数字。
>
> ⚠️ **复核补充（2026-08）**：以 `rg 'process.env.OPENCHAMBER_'`（js/mjs/ts，`-g '!test/**'`）实测到 **71 唯一字面**；排除 test 后 **55**。此差是**含 test/docs 与否**所致，文档 67 属含 test/interpolate 的略大口径。**脚本勿以「文档 67」为上限，应以全仓 `rg -i openchamber` 归零为准**；`ELECTRON_DEV`/`SERVER_URL`/`TARGET_ARCH`/`OPENCODE_CLI_VERSION`/`VERSION` 等（实测位于 `electron/scripts/*.mjs`、`web/server/index.js`）是经 `env.*`/`process.env[...]` 解构或 shell 字符串读取的真实契约，已在 67 清单内，脚本不得因其非 `process.env.` 字面前缀而漏改。

**`window.__OPENCHAMBER_*__` 全量清单（31 个唯一标识符，替换脚本字段级输入）**：
- Electron 注入端（`preload.mjs` + `main.mjs` 注入脚本）：`API_BASE_URL__`、`CLIENT_TOKEN__`、`DESKTOP__`、`DESKTOP_BOOT_OUTCOME__`、`ELECTRON__`、`HOME__`、`LOCAL_ORIGIN__`、`MACOS_MAJOR__`、`PLATFORM__`、`RELAY_HOST_ID__`、`RUNTIME_HEADERS__`、`UPDATER_E2E_BUILD__`
- UI/Web 消费端（PWA、vscode webview）：`APNS_ENV__`、`CONNECTION__`、`CSP_NONCE__`、`HARDWARE_KEYBOARD__`、`PANEL_TYPE__`、`RUNTIME_APIS__`、`SET_PWA_INSTALL_NAME__`、`SET_PWA_ORIENTATION__`、`STARTUP_TRACE__`、`STARTUP_TRACE_START__`、`STARTUP_TRACE_SUMMARY__`、`SURFACE__`、`UPDATE_PWA_MANIFEST__`、`VSCODE_SHIKI_THEMES__`、`VSCODE_THEME__`、`VSCODE_WINDOW_FOCUSED__`、`WEBVIEW_BUILD_TIME__`、`WIDGET_SNAPSHOT__`
- **读取端（配对注入，勿遗漏）**：`GET_PWA_INSTALL_NAME__`（`web/index.html:356` 定义，与 `SET_PWA_INSTALL_NAME` 成对；`ui/components/sections/openchamber/OpenChamberVisualSettings.tsx` 消费）。**早前 30 个口径漏此项，实为 31 个。**

> ⚠️ **读取方式分两型**：27 个走 `window.__X__`（或 `contextBridge.exposeInMainWorld`）直读；另有 **4 个是 bundle/TS 定义注入，不挂 `window.` 前缀**——`CSP_NONCE__`（TS 类型断言读取）、`STARTUP_TRACE_SUMMARY__`（同上）、`UPDATER_E2E_BUILD__`（`electron/scripts/bundle-main.mjs:38` define 注入 + `main.mjs:2971` 常量读取）、`WEBVIEW_BUILD_TIME__`（`vscode/vite.config.ts:32` define + `webview/main.tsx` declare）。替换脚本须用**含 `window.__` 与裸 `__` 两种模式**分别处理，否则归零不全。

> ⚠️ **契约替换约束**：注入端（preload 的 `contextBridge.exposeInMainWorld`）与消费端须**成对替换**，漏改任何一端运行期即读 `undefined`。另 `main.mjs:1625` 注入引导脚本内有 `__oc_local`/`__oc_api`/`__oc_headers`/`__oc_packaged`/`__oc_origin`/`__oc_bo` 等内部临时变量（不含 `openchamber` 字样，不触发归零，但为一致性应一并处理）。

### 2.4 代码内标识层（源码必须全换）✅ 已完成 (101 iOS 替换 + 22 文件/目录改名)

| 类别 | 说明 |
|---|---|
| 类型/接口名 | `OpenChamberConfig`、`OpenChamberProjectAction`、`OpenChamberProjectTodoItem`…（**实测 18 个 `type`/`interface` 声明命名**，见下；另 4 个类/组件命名如 `OpenChamberManager`、`OpenChamberPage`、`OpenChamberLogo`、`OpenChamberVisualSettings`，合计约 22 个唯一标识符，排除裸 `OpenChamber` 与 test/docs）→ `NoatinWork*` |
| 文件名 | `openchamberConfig.ts`、`openchamberEvents.ts(+test)`、主题 `themes/openchamber-{dark,light}.json` 等 → `noatinworkConfig.ts` 等 |
| 目录名 | `components/sections/openchamber/` → `components/sections/noatinwork/`；`web/server/lib/openchamber-control/` → `noatinwork-control/` |
| Mobile 原生工程标识 | Android `com/openchamber/app/MainActivity.java`；iOS `OpenChamberWidget/`、`OpenChamberNotificationService/` 目录 + 各 `Info.plist`/`.swift`/`.xcscheme`/entitlements 命名 → `NoatinWork*`/`com.noatinwork.app` |

> ⚠️ **源码层约束（§2.4 + §3.1 补充）**：
> 4. **LICENSE 版权持有者**：根 `LICENSE` 为 MIT，`Copyright (c) 2025 Bohdan Triapitsyn`（上游作者，非本仓名下）。二次开发保留 MIT 时，需按项目自身要求决定是否新增/保留版权行并注明 Fork 来源——文档当前未覆盖，实施前应作为独立决策项处理，勿随品牌脚本盲目替换。
> 0. **命名清单（实测 18 个 `type`/`interface` 声明）**：`OpenChamberConfig`、`OpenChamberDefaults`、`OpenChamberEvent`、`OpenChamberHealthSnapshot`、`OpenChamberLogoProps`、`OpenChamberMetadata`、`OpenChamberOpencodeResolution`、`OpenChamberPageProps`、`OpenChamberProjectAction`、`OpenChamberProjectActionPlatform`、`OpenChamberProjectActionsState`、`OpenChamberProjectContextData`、`OpenChamberProjectNotesTodos`、`OpenChamberProjectPlanFile`、`OpenChamberProjectPlanFileLink`、`OpenChamberProjectTodoItem`、`OpenChamberSection`、`OpenChamberVisualSettingsProps`。另有类/组件命名 `OpenChamberLogo`、`OpenChamberManager`、`OpenChamberPage`、`OpenChamberVisualSettings`。替换脚本以 `rg -oE '\bOpenChamber[A-Z]\w*'`（排除裸 `OpenChamber`）为输入，归零验证兜底。
> 1. **模块所有权文档同步**：`web/server/lib/openchamber-control/DOCUMENTATION.md` 是模块所有权文档。改名 `openchamber-control` 模块时，按 AGENTS.md「module ownership changes 须更新 owning documentation」**必须同步更新该 DOCUMENTATION.md**，否则违反仓库规则。
> 2. **Mobile 原生 bundle 改名风险**：iOS `OpenChamberWidget` / `OpenChamberNotificationService` 的 Xcode scheme、entitlements、`Info.plist` bundle 名高度耦合，改名须**同步 Xcode 工程引用**（`.xcodeproj` 内 scheme 引用、signing），否则编译/签名失败。§2.2 的 `com.openchamber.app` 只覆盖主 appId，未含这些子工程。
> 3. **命名契约**：类型/接口名用驼峰 `NoatinWork*`；文件名/目录名用全小写 `noatinwork*`——与 §3 三规则一致。

## 3. 替换规则

1. **驼峰 `NoatinWork`**：用户可见字符串、产物名、日志目录、`productName`/`displayName`/`appName`
2. **小写 `noatinwork`**：包名、命令、协议、路径、env、view/命令 id、路由、IPC、数据目录
3. **全大写 `NOATINWORK_`**：环境变量、常量、浏览器注入全局

**排除清单（不替换）**：
- 中性功能键名：`setup-worktree`、`projectNotes`、`scheduledTasks` 等配置契约字段——不含品牌词，改了只会无谓扩大 merge 冲突面
- 外部依赖地址：`anomalyco/opencode`（opencode 升级检查，指向 opencode 官方仓库）
- 替换脚本按"识别词"分域处理，**禁止简单全局替换**，防止大小写变体互相污染（如 `noatinwork-ui://` 被误改成 `noatinWork-ui://`）
- **统计口径统一**：本文档及验收"归零验证"中的计数（`OPENCHAMBER_*` 环境变量、`window.__OPENCHAMBER_*__`、`OpenChamber*` 类型名等）一律以**排除 `node_modules/`、`dist/`、`build/`、`*.lock`、构建产物**后的源码扫描为准；不同口径数字会显著漂移（如 env 变量全量 663 vs 字面读取 67 vs 全量读取 83），故计数仅作量级参考，验收以"归零"而不以"具体数字"为准

### 3.1 收敛点与兼容坑（深挖核实，实施优先从这里下手）

以下位置是品牌的"单点收敛点"，改一处即可批量生效，且有几处属**数据兼容坑**，需按此处理而非逐字替换：

1. **深链协议单一事实源**：`packages/ui/src/apps/deepLinks.ts` 头部自声明为整个 `openchamber://` 词表的唯一权威。改协议只需改 `DEEP_LINK_SCHEME = 'openchamber'`（line 13）一处，勿全仓改 `openchamber://` 字面量，避免破坏解析/拼接对称性。
2. **Electron IPC 收敛**：`packages/electron/preload.mjs` 以 `openchamber:*` 批量前缀暴露 IPC（`dialog`/`file`/`invoke`/`emit`）。替换可在此白名单层一次收敛，不必逐个 `ui` + `electron` 成对改事件名。
3. **数据目录（无存量迁移，直接全改）**：
   - 桌面用户数据不是直接 `~/.config/<name>/`，而是该目录下的 `settings.json`（`packages/electron/main.mjs:530` 默认路径、`:528` 由 `OPENCHAMBER_DATA_DIR` 覆盖）；另有同目录 `credentials`（`:3876`）。
   - **无存量、无迁移：不存在两层配置迁移兼容需求。** `packages/ui/src/lib/openchamberConfig.ts` 的 legacy 项目本地 `<project>/.openchamber/openchamber.json` → 新 `~/.config/<name>/projects/<projectId>.json` 迁移逻辑（`LEGACY_CONFIG_DIR` line 19、`CONFIG_FILENAME` line 17）与读旧 `.openchamber`/旧 `~/.config/openchamber` 的分支，因全部全新安装、无旧数据，**随品牌替换一并删除，不做双读**。所有路径字面量直接改 `noatinwork`，无兼容保留。
4. **产物名免改模板**：共存于 §2.1——electron-builder 由 `artifactName: "${productName}-..."` 模板生成，改 `productName` 即可（见 §2.1 备注）。
5. **CLI 命令 = 四处联动**（§2.2「CLI 命令」行的完整落点，替换须四处同步，勿只改 bin）：
   - `bin` 声明：`packages/web/package.json:8` `"bin": { "openchamber": "./bin/cli.js" }`
   - 运行时命令名检测：`packages/web/bin/cli.js:348` `isModuleCliExecution(..., 'openchamber')`
   - 服务标识符：`packages/web/bin/lib/cli-startup.js:11` `STARTUP_SERVICE_ID = 'dev.openchamber.web'`（systemd 服务名，随 §2.2 systemd/服务类改 `dev.noatinwork.web`）
   - 运行时实例/日志文件：`cli-paths.js:54` `openchamber-${port}.log`、`cli-lifecycle.js:180-184` / `cli-process.js:7,11` `openchamber-${port}.{pid,json}`（对应 §2.2「日志文件名」行，一并改 `noatinwork-${port}.*`）
   - 另：help/clack 文案中出现命令的字符串（如 `` `openchamber serve --port <p>` ``）多在 `cli-lifecycle.js` 等，随文案层替换。

## 4. 实施顺序（品牌部分）

1. ✅ 替换脚本（三规则分域执行，每域验证；含 CI 内品牌硬编码如 release.yml 的 "OpenChamber v..."）— §2.1/§2.2/§2.3 完成 (14530 替换)，§2.4 完成 (101 iOS + 22 改名)
2. ✅ 四端图标/logo 重制 + icon sprite 重新生成（改源文件后必须重新跑生成脚本）— 7 SVG 注释替换; sprite/PNG/ICO 无需重新生成 (图形内容未变); 5 处误分类残留修复
3. ✅ i18n 删语言 + 品牌词替换：**UI 消息包删 9 种**（de、es、fr、ja、ko、pl、pt-BR、uk、zh-TW，留 en + zh-CN）、**docs 删 8 个语言子目录**（见 §1 语言行与步骤 5）；保留面（根英文 + zh-CN、UI 的 en/zh-CN）内做品牌词替换 — §3 完成 (385 文件删除, i18n 系统收敛为 en+zh-CN)
4. ✅ CI 裁剪与发布链改造（需先备好 secrets）+ 新增上游检测 job — CI/bot/skill 品牌硬编码替换完成 (39 文件, 141 行)；scan.mjs 修复 --hidden
5. ✅ 文档裁切（删 8 个语言子目录 `de/ es/ fr/ ja/ ko/ pl/ pt-br/ uk/`，保留根英文 + `zh-cn/`——见 §1 语言行结构说明）— §3 完成
6. ✅ 全仓 `rg -i openchamber` 归零验证通过 → 仓库重初始化完成（单初始 commit `f539329` push）— 最终归零验证：git 历史 0 残留，工作区 10 个合法保留文件（CHANGELOG 历史、GitHub issue 引用 `openchamber#2577`、品牌替换工具本身），unaccounted=0；`bun.lock` workspace name stale 残留已修复（commit `a8dbd6c3c`，重初始化前）

### 4.1 远端与目录名处理（随第 6 步一并执行）

- ✅ GitHub 远端仓库已重命名为 `noatinwork`（`gh repo rename noatinwork --repo cccczl01/openchamber`），本地 `git remote set-url origin` 已更新
- ✅ 仓库重初始化完成（原地 `rm -rf .git` + `git init --initial-branch=main` + 单初始 commit `f539329 Initial commit: NoatinWork` + `git push -f origin main`）— 破坏性操作已执行；git 历史中的 openchamber 残留已全部消除，远程 `origin/main` = `f539329`
- 重新配置远端：`origin` → `github.com/cccczl01/noatinwork.git`、`upstream` → `https://github.com/openchamber/openchamber.git`（合并策略所需，保持不动）
- ✅ 远端现状：`origin` = `github.com/cccczl01/noatinwork.git`，`upstream` = `github.com/openchamber/openchamber.git`（保持不动）；仓库内无对 fork 账号的引用

### 4.2 CI 品牌硬编码清单（深挖核实，发布链漏改=产线出错品牌）

**`release.yml`（发布产物 + GitHub/Slack 承载层，最高优先）：**

| 行号 | 硬编码 | 替换为 |
|---|---|---|
| 80 | `name: OpenChamber v${{...}}`（GitHub Release 标题） | `NoatinWork v...` |
| 453, 461, 491, 495, 504, 506 | `OpenChamber-${VERSION}-linux-*.AppImage` 产物路径 | `NoatinWork-*.AppImage` |
| 575, 577 | `OpenChamber-${version}-linux-*.AppImage`（manifest/脚本引用） | `NoatinWork-*` |
| 635 | `OpenChamber ${tag} released.`（release body 兜底） | `NoatinWork ${tag}...` |
| 639 | `username: 'OpenChamber Releases'`（Slack 发送者） | `NoatinWork Releases` |
| 650 | `title: ... OpenChamber ${tag}`（Slack 标题） | `NoatinWork ${tag}` |
| 654 | `footer: { text: 'OpenChamber Changelog' }` | `NoatinWork Changelog` |
| 677 | `openchamber/openchamber-website`（网站刷新 repo） | 我方网站仓库（**暂未建立**，实施前约定地址并配置为 release 目标，见 §7 待办） |

**其余 workflow：**

| 文件:行 | 硬编码 | 替换为 |
|---|---|---|
| `release-desktop-smoke.yml:370,378` | `OpenChamber-${VERSION}-linux-*.AppImage` | `NoatinWork-*`（与 release.yml 联动） |
| `build-macos-arm64-dmg.yml:99` | `DMG_NAME="OpenChamber_Electron_${macos_version}_arm64.dmg"` | `NoatinWork_Electron_*` |
| `mobile-release.yml:143` | keystore 文件名 `openchamber-release.keystore` | `noatinwork-release.keystore`（⚠️ 若已有旧签名 keystore，改文件名/别名会导致签名失败，须同名保留或重建） |
| `docs-source.yml:41` | 归档名 `openchamber-docs-source-${sha}.tar.gz` | `noatinwork-docs-source-*` |
| `vscode-extension.yml:50`、`mobile-ci.yml:41` | artifact name `openchamber-vscode-vsix` / `openchamber-android-debug-apk` | 内部识别名，可改可留（保守可留） |

**bot workflow 品牌词（§4.5「保留并替换」，随 §5 保留自建一并替换）**：`bot-help`/`bot-summarize`/`pr-review`/`triage`/`reproduce-issue` 等内的 `@openchamber-bot`、`openchamber-bot[bot]`、`OpenChamber repository` 字样，随这些 workflow 保留而改为 noatinwork 对应形式（bot 账号名 `noatinwork-bot`、`NoatinWork repository` 等）。

### 4.3 保留 docs 品牌词归零预检（深挖核实，步骤 5/6 输入）

**保留面品牌词总量：547 处**（`openchamber`/`OpenChamber`，跨根英文 + 根 troubleshooting + zh-cn，含可改与应保留）。

| 保留面 | 文件数 | 品牌词出现 | 附注 |
|---|---|---|---|
| 根英文 mdx（`packages/docs/content/docs/*.mdx`） | 42 个 | 254 处 | 含 8 处反引号命令 `` `openchamber ...` `` 用法（`startup`/`connect-url`/`logs`/`stop` 等） |
| 根 `troubleshooting/`（opencode-connection、remote-access、worktrees-git） | 3 个 | 20 处 | 专属 mdx |
| `zh-cn/` 子目录 | 45 个 | 273 处 | 与根英文逐文件对应 |
| 根 `docs/*.md`（REVERSE_PROXY 等） | 4 个 | REVERSE_PROXY 含 3 `openchamber` + 6 `OpenChamber` | 仓库自持文档，随品牌替换；上述 547 不含此表（另行归类） |

**逐文件热点**（根英文与 zh-cn 对应同名文件同样高）：`opencode-server`(29)、`tunnels`(24)、`environment`(37)、`agent-control-tool`(13)、`reverse-proxy`(10)、`troubleshooting/opencode-connection`(9)、`security`/`remote-instances`/`install`/`troubleshooting/remote-access`(8)。

**类别判定（替换脚本对 docs 的分域规则）**：
- **应替换（品牌名/命令）**：叙事性 `OpenChamber` 产品名、`openchamber` 命令、data-dir/日志示例 → 三规则映射（§3）。
- **应替换（域名，已决策）**：`openchamber.dev` → `work.noatin.com`（产品官网）、`api.openchamber.dev` → `api.noatin.com`（更新检查 + 推送）、`docs.openchamber.dev` → `docs.noatin.com`（文档站）、`relay.openchamber.dev` → `relay.noatin.com`（WebSocket 中继）、下载 → `download.noatin.com` + GitHub Releases 兜底（完整体系见 §6）。`github.com/openchamber/opencode`（opencode 官方依赖）与 `OPENCODE_*` 环境变量（opencode 官方）**保留**为 §8 合法残留。
- **替换时以行号/区块为单元**：每个 `OpenChamber` 需人工判断上下文（命令 vs URL vs 品牌），**禁止整行/全局替换 docs**——示例见 `opencode-server.mdx` 第 8/10/12/23/30/34 行为品牌名、第 26 行为命令、第 3 行 description 为品牌、URL 形式保留。

**根 `docs/*.md` 盘点（仓库自持，另行归类）**：

| 文件 | 品牌词 | 处置 |
|---|---|---|
| `docs/REBRAND_PLAN.md`（本文件） | 103 行（随修订会变，非固定） | 策划文档，`openchamber` 引用是映射说明的**有意内容**；实施后建议重写为 noatinwork 版本（§8 合法残留应补一条「本策划文档」） |
| `docs/pairing-v2-implementation-plan.md` | 11 行（多为 `openchamber://connect` 深链协议示例） | 上游自带实现计划、非 README 引用；品牌替换无需，协议示例随 `DEEP_LINK_SCHEME` 收敛点统一改 |
| `docs/REVERSE_PROXY.md` | 9 行（`OpenChamber` 品牌 + nginx 示例中 `/api/openchamber/events` 路由） | **README 链接引用（README:135），必须保留**；品牌 + 路由改 `noatinwork` |
| `docs/CUSTOM_THEMES.md` | 5 行（品牌 + `~/.config/openchamber/themes/` 路径） | **README 链接引用（README:135），必须保留**；品牌 + 数据目录改 `noatinwork` |

### 4.4 i18n 保留面品牌词盘点（深挖核实，步骤 3 的可执行清单）

**范围**：UI 消息包 `packages/ui/src/lib/i18n/messages/` 删除其余 9 语言后，保留的 `en` + `zh-CN` 4 个文件（`en.ts`、`en.settings.ts`、`zh-CN.ts`、`zh-CN.settings.ts`）。

**品牌词分布（源码扫描口径，排除 node_modules/dist/build，含大小写变体）**：

| 文件 | key 含 `openchamber` | 值含品牌词（用户可见） | 其中 key+值都含 |
|---|---|---|---|
| `en.ts` | 3 | **37** | 3 |
| `zh-CN.ts` | 3 | **38** | 3 |
| `en.settings.ts` | **517** | **46** | **13** |
| `zh-CN.settings.ts` | **517** | **46** | **13** |
| **合计** | **1040** | **167** | 32 |

**两层品牌词，分域替换（禁止简单全局替换）**：

1. **key 层 `settings.openchamber.*`（517 条）**：这是**运行时 i18n key 契约**。消费端**共 571 个唯一 key 引用（实测 2026-08 复核，仅 i18n 消息包外的 UI 源码）**，分布在两类位置：
   - **渲染组件** `components/sections/openchamber/*.tsx`：**468 个唯一 key、498 处 `t('settings.openchamber.xxx')` 调用**（§4.4 Key/值表与消费端必须成对同步，否则运行期取不到文案）。
   - **settings 搜索索引** `packages/ui/src/lib/settings/search.ts`：**另有 103 个唯一 key**（`titleKey`/`descriptionKey` 字段）。**此文件极易被忽略——它是设置搜索页的索引契约，不改前缀则 `settings 搜索`功能全部失配**。替换脚本必须把 `search.ts` 与消息包 + 渲染组件放同一替换域，不能只按「sections/openchamber + i18n 文件」白名单收敛。
   - **口径修正**：早前「422 处/396 唯一 key」低估且漏了 search.ts；实测总消费端唯一 key 571（468 渲染 + 103 搜索，二者与消息包 517 定义互为超集、非 1:1 全命中）。改前缀必须**成对替换 key 定义 + 全部消费端**，与 §2.3 `window.__OPENCHAMBER_*__`「注入端/消费端成对替换」同理。故**不能**按 i18n 文件白名单单独收敛，须与源码一并改。
2. **值层品牌词（167 处用户可见文案，key 不含 `openchamber` 的纯值处）**：这是 §2.1「UI 文案」直连层，漏改任一 toast/提示即旧名残留。三类处置，全部替换：
   - **brand 名**（`About OpenChamber`、`Welcome to OpenChamber`、`OpenChamber server`、`OpenChamber 菜单` 等）→ `NoatinWork`（§2.1）
   - **命令**（`openchamber update`，en.ts 主包 `updateDialog.error.takingLonger`）→ `noatinwork update`（§2.2）
   - **路径**（`~/.config/openchamber/cloudflare-managed-remote-tunnels.json` 隧道 token、`~/.config/openchamber/themes/` 主题导入，en/zh-CN settings 各 2 处）→ `~/.config/noatinwork/`（§2.2 数据目录）

> ⚠️ **本层全部替换，无兼容保留**：三规则映射（§3）直接适用；`~/.config/openchamber/` 路径在值层一律改 `noatinwork`。**无数据迁移、无双读**（§3.1 已改为直接全改并删 legacy 迁移逻辑），故路径文案不受任何兼容约束。
>
> ⚠️ **主包 camelCase key 也必须替换（重要）**：`en.ts`/`zh-CN.ts` 主包值层无 `settings.` 前缀，但有 **3 处内嵌品牌词的 key**——`sessions.sidebar.footer.actions.aboutOpenChamber`、`aboutDialog.openChamberVersionLabel`、`openChamberLogo.aria.logo`（en/zh-CN 各 3 处）。这类 key 与 `settings.openchamber.*` **同属运行时 i18n key 契约**，按 §3 规则 1 命名单点收敛：
> > - **key 层**：`...aboutOpenChamber` → `...aboutNoatinWork`、`...openChamberVersionLabel` → `...openNoatinWorkVersionLabel`、`...openChamberLogo...` → `...openNoatinWorkLogo...`（驼峰标识层替换）。
> > - **值/aria 层**：`'About OpenChamber'` → `'About NoatinWork'` 等显示名（§2.1）。即同一行内 key 与值出现的**两个 `OpenChamber` 都要改，但各自命中不同规则——key 是标识层、值是显示名层**。
> > - **成对同步消费端**：改 key 必须同步改全部 `t('...aboutOpenChamber')` 等消费端（如 `components/session/sidebar/SidebarFooter.tsx:54,58`），否则运行期取不到文案（§4.4 第 1 条同理）。
> > - **语言范围**：仅需改保留的 `en.ts`/`zh-CN.ts` 各 3 处；其余 9 语言的同名 key/值为 `'Über OpenChamber'`、`'Про OpenChamber'` 等，随 §1 语言删除一并消失，无需逐个改。
>
> ⚠️ **判定口径**：settings 包 key 前缀 517 中，值是纯品牌文案的 46 处里 13 处为 key+值都含（改 key 前缀时一并改值，一石二鸟）。消费端 `t(...)` 调用 422 处（396 个唯一 key）是替换脚本的消费端输入。

### 4.5 其余文档资产品牌词盘点（深挖核实，i18n 与 docs 之外的文档面）

**范围**：§4.3（`packages/docs/content/docs` 用户文档 + 根 `docs/*.md`）与 §4.4（i18n 消息包）**未覆盖**的其余文档资产。这些是 `.md`/`.mdx`/`.md` 文档（非可执行源码），品牌词全部随三规则映射替换，无兼容保留；处置遵循 §1（规则/技能、模块文档**保留但替换**；贡献向流程删除）与 §8（CHANGELOG 历史条目**合法残留**）。

> **排除：本文件 `docs/REBRAND_PLAN.md` 不参与品牌替换**。其 61 处 `openchamber` 引用是映射/清单的**刻意内容**（§8 合法残留之一），实施中**不改**；待品牌替换完成后按需重写为 noatinwork 版本自归零（见 §4.3 根 `docs/*.md` 表）。验收的「`rg -i openchamber` 归零」若按 §4.3 判定口径把本文件计入，则"归零"指其重写后状态，正确替换本身不含对本文件的编辑。

**分布总量与归类**：

| 文档资产 | 品牌词出现 | 处置 |
|---|---|---|
| `.agents/skills/*/SKILL.md` + `references/*.md`（12 个技能，16 个文件） | 36 | **保留但替换品牌词**（§1：规则/技能全保留） |
| `.opencode/agent/*.md`、`.opencode/commands/*.md`（8 个文件） | 10 | 自带开发工具（pr-review、triage、summarize、rd-fixes、rd-follow-up 等），**NoatinWork 内部继续使用，必须保留并替换品牌词**（`OpenChamber repository` → `NoatinWork repository` 等）；与 §5 GitHub workflow 一并保留自建，`.opencode/` 文件不删除 |
| 各 package `README.md`（`web`/`electron`/`vscode`/`mobile`/`docs`/`ui icon`） | 50 | 保留替换（包级文档，随包契约走） |
| 各模块 `DOCUMENTATION.md`（`web/server/lib/*/`、`ui/src/sync/`、`vscode/src/`、`ui/src/components/*/`） | ~90 | **保留替换**（§1：模块所有权文档；改名模块时须同步更新 owning doc） |
| 根 `AGENTS.md`、`README.md`、`SECURITY.md`、`scripts/*.md` | ~45 | 保留替换（仓库级文档，含 `openchamber-ui://` 深链、`~/.config/` 之外路径、`security@openchamber.dev` 邮箱 → `security@noatin.com`） |
| `CHANGELOG.md`（根 + `packages/vscode/CHANGELOG.md`） | 31 | **§8 合法残留**（历史条目不改） |
| 贡献向（根 `CONTRIBUTING.md`、`packages/docs/CONTRIBUTING.md`、`scripts/repro/`） | 27 | §1 判删除；**若决定保留则替换品牌词** |
| 根 `LICENSE`（MIT，`Copyright (c) 2025 Bohdan Triapitsyn`） | — | **不属品牌替换**；版权行是上游作者，二次开发需单独决策（保留/增补/注明 Fork），勿脚本盲目改 |
| `docs/pairing-v2-implementation-plan.md` | 13 | 已列于 §4.3 根 `docs/*.md` 表 |

> **全局原则（适用本层及 §5 涉及的开发工具）：『保留并替换』。**
> 凡是 NoatinWork 内部**继续使用**的资产——含 `.opencode/` 的 agent/command 定义、`.agents/skills/`、各模块 `DOCUMENTATION.md`、各 package `README.md`、以及 §5 的 bot 工作流（`opencode`、`oc-integration`、`pr-review`、`triage`、`reproduce-issue`、`bot-help`、`bot-summarize`、`stale`、`label-merge-conflict`，内部使用故保留自建）——一律**保留文件并替换其中品牌词**（`OpenChamber`/`openchamber` → `NoatinWork`/`noatinwork` 三规则映射），**不因品牌改名或"无外部贡献者"而删除**。这些工具是 noatinwork 自身的开发与治理工具，改名后照常使用。"删除"仅适用于真正的贡献向流程（§1）与语言子目录等冗余面，**不适用于开发工具与 bot 工作流**。

**替换脚本分区规则（对本层）**：
- **品牌名/命令/路径** → 三规则映射（§3）。
- **应保留（§8 合法残留或外部地址）**：`security@openchamber.dev` → **`security@noatin.com`**（已决策，随域名映射一并改 `SECURITY.md`）；`OPENCODE_*`（opencode 官方 env）；`github.com/openchamber/opencode`（opencode 官方依赖）。
- **深链协议** `openchamber-ui://`（根 `AGENTS.md:34`）随 §3.1 收敛点 `DEEP_LINK_SCHEME` 统一改，勿逐字替换。
- 各 `DOCUMENTATION.md` 的"模块所有权/不变量"正文若被品牌词指代模块名（如 `openchamber-control`、`openchamber-change-discipline` 技能名），替换时**保持模块-文档指代一致**（§2.4 模块所有权同步约束）。

> ⚠️ **计数均为源码扫描口径**（排除 node_modules/dist/build）的量级参考，验收以 §6 步骤 6「`rg -i openchamber` 归零」为准而非具体数字。

## 5. CI 归属表

| 处理 | Workflow |
|---|---|
| ✅ 保留（替换品牌词） | `oc-review`（主验证链：build+type-check+lint）、`mobile-ci`、`opencode-smoke`（手动冒烟，与品牌无关） |
| 🔧 改造 | `release`（产物名 NoatinWork、发布目标改我方仓库）、`release-desktop-smoke`、`mobile-release`（签名 secrets 换我方）、`vscode-extension`（publisher + PAT）、`build-macos-arm64-dmg`、`docs-source`（`docs:validate` 保留，上传目标跟随发布链） |
| 🔧 改造（bot 类，保留自建，需自备 secrets） | `opencode`、`oc-integration`、`pr-review`、`triage`、`reproduce-issue`、`bot-help`、`bot-summarize`、`stale`、`label-merge-conflict` —— 遵循 §4.5「保留并替换」全局原则，**内部继续使用、不删除**；其 GitHub workflow 与 `.opencode/` 对应工具（`pr-review`/`triage`/`reproduce-issue`/`summarize` 等）协同运行，发布链自备 `OC_REVIEW_APP_ID`、`OPENCODE_API_KEY` 等 secrets 后在本仓启用 |

**发布链需要自备的 secrets**：`VSCE_PAT`、`OVSX_PAT`、Apple 签名证书、Android 签名、npm publish token。

## 6. 自建发布源方案（noatin 域名体系）

更新机制现状：三套独立通道，官方已预留自建接口。

| 通道 | 现状 | 改造点 |
|---|---|---|
| CLI/Web 更新 | `package-manager.js` 校验常量名为 `UPDATE_CHECK_URL`，实际环境变量为 `OPENCHAMBER_UPDATE_API_URL`（值 `api.openchamber.dev/v1/update/check`，line 22），已支持 env 覆盖；兜底 npm registry + GitHub API | 设 `NOATINWORK_UPDATE_API_URL=https://api.noatin.com/v1/update/check`；兜底包名随品牌替换 |
| UI 更新弹窗 | `UpdateDialog.tsx` 硬编码 `GITHUB_RELEASES_URL` | 改为 `https://download.noatin.com`（产物下载）+ GitHub Releases 兜底 |
| Electron 更新 | `updater-feed.mjs` 的 `PRODUCTION_UPDATER_FEED` 硬编码 `provider: github + openchamber/openchamber` | 改为 `{ provider: 'generic', url: 'https://download.noatin.com/desktop' }`（拉 `latest-*.yml`） |

**域名体系（已决策）**：

| 域名 | 角色 | 承接原域名 |
|---|---|---|
| `work.noatin.com` | NoatinWork 产品官网（`openchamber.dev`） | `openchamber.dev` |
| `api.noatin.com` | 产品 API：更新检查 `/v1/update/check`、推送 `/v1/push/send` | `api.openchamber.dev` |
| `docs.noatin.com` | 产品文档站 | `docs.openchamber.dev` |
| `relay.noatin.com` | WebSocket 私密中继 `wss://relay.noatin.com/ws`（`relay/service.js:19`） | `relay.openchamber.dev` |
| `download.noatin.com` | 产物下载 + Electron feed（`latest-*.yml`） | §6 原 `work.noatin.com/downloads`+`/desktop` |
| `noatin.com` | 公司母站（承载所有产品，NoatinWork 不独占） | —（新增） |

**目录结构**：
- `https://download.noatin.com/desktop/latest-*.yml`（Electron feed）
- `https://api.noatin.com/v1/update/check`（CLI 检查 API）
- `https://api.noatin.com/v1/push/send`（APNs 推送）
- `https://download.noatin.com/`（产物：`NoatinWork-*.{AppImage,dmg,exe}`）
- `https://github.com/openchamber/openchamber/releases`（GitHub Releases 直链/兜底，随品牌改 `openchamber` → noatinwork 仓库）

**配套准备**：域名（✅ 已持有）、DNS（CNAME/A 指向对象存储/CDN）、HTTPS（Let's Encrypt）、发布流水线（四端构建 → 产物 + feed → 上传）、签名密钥（macOS 必须、Windows NSIS 需要代码签名证书、Linux 可不签）、`v1/update/check` 轻量端点（静态 JSON 或轻服务）。

## 7. 待办清单

| 事项 | 说明 | 时间点 |
|---|---|---|
| ✅ VS Code publisher 注册 | marketplace 创建 `noatinwork`（全局唯一，先到先得），可选验证域名 `work.noatin.com`；生成 PAT 存 `VSCE_PAT` | 越早越好（唯一性风险） |
| ✅ npm 组织注册 | npmjs.com 创建组织 `noatinwork-app`（`noatinwork` 已被占用），已批量替换 `@noatinwork/` → `@noatinwork-app/`（130 处，56 文件），生成 Publish token 存 CI secret | 品牌替换阶段 |
| 签名密钥 | Apple 证书、Windows 代码签名 | 发布链跑通前 |
| 网站仓库建立 | 我方官网仓库（替换 release.yml:677 `openchamber/openchamber-website`），产品官网 `work.noatin.com` + 文档站 `docs.noatin.com` | 发布链接入前 |

## 8. 长期维护约定（开发纪律与上游合并）

**开发纪律**：
- 功能一律附加式：新增 server route / UI 组件 / 模块文件；只读已有逻辑；通过配置扩展
- 不碰核心区：`packages/ui/src/sync/`、`packages/ui/src/stores/` 的时序逻辑、服务端会话/审批/终端生命周期
- 判断标准：改动是"新增文件"或"新增分支"→ 安全；是"修改既有时序/状态逻辑"→ 碰了核心，需单独评估
- 改核心前必读对应 `DOCUMENTATION.md`（不变量是正确性约束，不是风格建议）

**上游合并**：
- 定期 merge（1-2 周一次），不攒版本；用 merge 不用 rebase；开启 `git rerere`
- CI 新增 job：检测 `openchamber/openchamber` 新 release → 试 merge → 报告冲突文件数
- 品牌文件冲突（低频）：冲突文件 `checkout theirs` → 重跑品牌替换脚本 → 提交

**品牌残留合法清单**（搜索归零时允许保留）：
- `CHANGELOG.md` 历史条目
- 上游引用（注释、issue 编号）
- `anomalyco/opencode`、`github.com/openchamber/opencode` 相关 URL（opencode 官方依赖，外部地址不改）
- `OPENCODE_*` 环境变量、`@opencode-ai/sdk/v2`（opencode 官方契约）
- `docs/REBRAND_PLAN.md` 自身的 `openchamber` 映射说明（实施后重写为 noatinwork 版本消除）
- git 历史（重开仓库后消除）
