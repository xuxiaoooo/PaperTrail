<div align="center">
  <img src="assets/icon.png" alt="PaperTrail" width="96" height="96">
  <h1>PaperTrail</h1>
  <p><strong>Every manuscript has a trail.</strong></p>
  <p>A lightweight manuscript tracker for macOS.<br>专注稿件进度的 macOS 菜单栏工具。</p>
  <p>
    <a href="https://github.com/xuxiaoooo/PaperTrail/releases/latest">Download for Mac / 下载 Mac 版</a> ·
    <a href="#中文">中文</a> · <a href="#english">English</a>
  </p>
  <img src="https://img.shields.io/badge/macOS-14%2B-252b27" alt="macOS 14 or later">
  <img src="https://img.shields.io/badge/Apple_Silicon-arm64-547b68" alt="Apple Silicon arm64">
  <img src="https://img.shields.io/badge/Release-1.2-547b68" alt="Release 1.2">
  <img src="https://img.shields.io/badge/Data-Local-547b68" alt="Local data">
  <img src="https://img.shields.io/badge/License-PolyForm_Noncommercial-8a7654" alt="PolyForm Noncommercial license">
</div>

## Screenshots / 界面预览

| 主窗口 / Main window | 菜单栏快览 / Menu bar overview |
| :---: | :---: |
| <img src="docs/images/main-window.png" alt="PaperTrail main window with two demo manuscripts" width="340"> | <img src="docs/images/menu-bar-overview.png" alt="PaperTrail menu bar overview with refresh, open and quit actions" width="340"> |

截图来自实际运行的界面，使用合成演示数据。 / Screenshots show the running app with fictional manuscript data.

<details>
<summary>本地变化日志 / Local change history</summary>
<br>
<img src="docs/images/local-history.png" alt="Local status history using demo manuscripts" width="340">
</details>

## 中文

### 一眼看到稿件进度

PaperTrail 把你添加的稿件集中在一个紧凑的竖向窗口中。每篇稿件只显示 **期刊名称、当前状态、稿件号和本地变化日期**。无需建立作者档案，也无需为 PaperTrail 注册云端账号。

点击 Mac 菜单栏图标，即可快速查看全部已跟踪稿件。圆形箭头刷新状态；底部分隔线下可打开主窗口或退出应用。

### 轻量化，体现在运行方式

| 设计 | 实际行为 |
| --- | --- |
| 界面按需存在 | 主窗口关闭后销毁页面进程；菜单栏弹窗失焦后销毁。后台驻留时可保持 **0 个界面渲染进程**。 |
| 浏览器按需运行 | 读取投稿网站时启动浏览器，读取完成后关闭；账号会话保存在本机。 |
| 限制读取并发 | 每次只读取 **1 个账号**，降低读取时的内存峰值。 |
| 内容集中 | 稿件卡片、期刊账号、本地变化日志；保留需要的备份、时区与启动设置。 |

此前一次本机开发阶段对比中，两个稿件场景的进程 RSS 总和从 **1,227.6 MB 降至 511.2 MB，约减少 58.4%**，进程数量从 **15 个降至 5 个**。这是旧版的单机样本，不代表本版或所有设备上的占用；RSS 总和也不等于实际物理内存占用。测量方法见 [资源占用记录](docs/performance/README.md)。

标准安装包包含 Electron、Python 和读取模块；首次启动时下载 Chromium 与 Firefox。另提供可离线安装和首次启动的完整包。两者均使用 Electron 内置的 Node，读取期刊网站状态需要联网。本机 1.2 构建中，标准 Mac DMG 为 **148 MiB**，完整离线包为 **420 MiB**；旧版 1.1 Release 的 Mac DMG 约 **545 MiB**。标准包体积减少约 **73%**，浏览器下载所需的磁盘空间仍需另计。

### 功能

- **按稿件号跟踪**：只跟踪你主动添加的稿件，保留网站提供的原始状态文字。
- **修订稿连续追踪**：R1/R2 等稿号变化沿用原稿件和日志，并保留历史稿号。
- **本地变化记录**：按稿件折叠查看添加后的状态变化、变化次数及最近变化日期，不回溯网站旧历史。
- **定时刷新**：按所选时区自行设置每天的刷新时间点，初始为 08:00–24:00 每小时一次，也可手动刷新。
- **人工验证入口**：遇到网站验证时，可打开独立账号的验证窗口完成登录。
- **本地备份**：导出和恢复稿件、日志与设置；密码和浏览器会话不进入备份。
- **应用更新**：显示当前版本；检查 GitHub 最新正式版，校验安装包后自动安装并重启。

### 支持的投稿入口

| 平台 | 登录方式 |
| --- | --- |
| ScholarOne | 期刊账号和密码 |
| Editorial Manager | 期刊账号和密码 |
| Wiley Research Exchange | Wiley 账号和密码 |
| Elsevier 使用的 Editorial Manager | Elsevier 账号和密码 |
| IEEE Research Exchange 投稿门户 | IEEE 账号和密码 |
| MDPI SuSy | MDPI 账号和密码 |

使用具体期刊的投稿入口。不同期刊的网站页面可能不同，适配范围及入口格式见 [平台说明](docs/平台适配范围.md)。
MDPI SuSy 的入口与列表解析已接入；尚未使用真实 MDPI 账号完成端到端验证。

### 为 Mac 设计

- **Apple Silicon（arm64），macOS 14 或更新版本**；本次发布在 macOS 27.0.1 上验证。
- 原生菜单栏入口、Retina 图标、紧凑的竖向主窗口。
- 默认窗口约为主屏幕 **1/4 宽、2/3 高**，可调整大小。
- 主窗口关闭后，运行中的 Dock 图标随之隐藏；可通过菜单栏重新打开。
- 密码交由 **macOS 钥匙串**保存；可设置登录电脑时启动。
- 首次启动自动准备浏览器组件，无需手动安装 Python、Node.js 或浏览器；完整包可离线启动。

### 安装与开始使用

1. 从 [Releases](https://github.com/xuxiaoooo/PaperTrail/releases/latest) 下载 `PaperTrail-*-Mac.dmg`；离线使用可选 `-Mac-Offline.dmg`。
2. 打开 DMG，将 `PaperTrail.app` 拖到“应用程序”。
3. 启动 PaperTrail，在“期刊账号”中添加期刊网址及账号。
4. 添加稿件号，完成网站验证后刷新，即可开始跟踪。

从 1.1 升级时需先手动安装 1.2；此后可在“设置与数据”中使用“检查并安装更新”。

**当前发行包使用本地签名，尚未经过 Apple 公证。** macOS 首次打开可能提示开发者验证；相关机制及手动处理方式见 [Apple 官方说明](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)。Release 同时提供 SHA-256 校验文件和完整源码。

数据目录：`~/Library/Application Support/PaperTrail/`。日常操作见 [使用指南](docs/使用指南.md)。

## English

### Manuscript progress at a glance

PaperTrail brings the manuscripts you add into a compact portrait window. Each card shows **journal, current status, manuscript number, and the latest local change date**. It requires no author profile or separate PaperTrail cloud account.

Click the macOS menu bar icon to see every tracked manuscript. Refresh from the popover, open the main window, or quit from the footer.

### Designed for quiet background use

| Design | Behavior |
| --- | --- |
| On-demand interface | Closing the main window disposes its renderer. The popover is disposed when it loses focus. Background use can retain **zero UI renderer processes**. |
| On-demand reading browsers | Browsers start for journal reads and close when each read finishes. Account sessions stay on the device. |
| Bounded concurrency | **One account** is read at a time, limiting memory peaks. |
| Focused workflow | Manuscript cards, journal accounts, local history, backups, timezone and startup settings. |

A previous local development comparison with two tracked manuscripts recorded total process RSS falling from **1,227.6 MB to 511.2 MB, about 58.4%**, and the process count from **15 to 5**. This was a sample of an older version, not a guarantee for this release or all devices. Summed RSS is not physical memory footprint. See [resource measurements](docs/performance/README.md) for the method.

The standard installer includes Electron, Python and the reader module; it downloads Chromium and Firefox on first launch. A complete offline installer is also available. Both use Node built into Electron. In a local 1.2 build, the standard Mac DMG was **148 MiB** and the offline DMG was **420 MiB**, versus about **545 MiB** for the 1.1 Release DMG. The standard installer is about **73% smaller**; browser downloads still use disk space. Checking publisher websites requires an internet connection.

### Features

- **Track revisions continuously.** R1/R2 manuscript numbers keep the original manuscript and history, with earlier numbers retained.
- **Keep a local trail.** Expand history by manuscript to see subsequent changes, counts and dates; existing publisher history is not imported.
- **Custom refresh times.** Choose daily times in the selected timezone; the initial schedule checks hourly from 08:00 through 24:00. Manual refresh remains available.
- **Handle verification.** Open the relevant account's verification window when the website requires it.
- **Back up locally.** Export and restore manuscripts, history and settings. Passwords and browser sessions are excluded from portable backups.
- **Update the app.** See the installed version, check the latest stable GitHub release, verify its installer and restart after installation.

### Submission systems

| System | Sign-in |
| --- | --- |
| ScholarOne | Journal username and password |
| Editorial Manager | Journal username and password |
| Wiley Research Exchange | Wiley username and password |
| Elsevier journals on Editorial Manager | Elsevier username and password |
| IEEE Research Exchange portal | IEEE username and password |
| MDPI SuSy | MDPI username and password |

Use the journal-specific submission URL. Journal pages and login requirements vary; see [supported entry points](docs/平台适配范围.md).
MDPI SuSy entry and list parsing are implemented but have not yet been validated end to end with a real MDPI account.

### Made for Mac

- **Apple Silicon (arm64), macOS 14 or later.** This release was tested on macOS 27.0.1.
- Native menu bar access, Retina icons and a compact portrait window.
- Default window size is approximately **one quarter of screen width and two thirds of screen height**; it is resizable.
- Dock visibility follows the main window; reopen it from the menu bar.
- Passwords are stored in **macOS Keychain**, with optional launch at login.
- Browser components are prepared on first launch without manual installation; the complete installer also works offline.

### Install and start

1. Download `PaperTrail-*-Mac.dmg` from [Releases](https://github.com/xuxiaoooo/PaperTrail/releases/latest), or `-Mac-Offline.dmg` for offline setup.
2. Open the DMG and drag `PaperTrail.app` into **Applications**.
3. Open PaperTrail and add a journal URL and account under **期刊账号** (Journal accounts).
4. Add a manuscript number, complete any website verification, and refresh.

To upgrade from 1.1, install 1.2 manually once. Future releases can be installed through **检查并安装更新** in Settings.

**The current distribution is locally signed and is not Apple-notarized.** macOS may show a developer-verification notice on first launch. See [Apple's guidance](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) for how the system handles these apps. SHA-256 checksums and complete source are provided with the release.

Local data directory: `~/Library/Application Support/PaperTrail/`.

## Development / 开发

Requirements: **Node.js 24**, **Python 3.13**, and Xcode Command Line Tools on an Apple Silicon Mac.

```sh
git clone https://github.com/xuxiaoooo/PaperTrail.git
cd PaperTrail
npm ci
npm run prepare:mac
npm start
```

Prepare bundled runtimes once, then build the macOS installer:

```sh
npm test
npm run smoke
npm run package:mac
npm run verify:package -- macos-arm64
npm run smoke:package
```

Regenerate the public screenshots and source-development resource sample with synthetic data:

```sh
npm run docs:screenshots
```

More: [Build guide / 构建指南](docs/开发与构建.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License / 许可

[PolyForm Noncommercial 1.0.0](LICENSE). Source is available for uses permitted by this license. Original required copyright notices are retained. Bundled third-party components retain their own licenses; see [third-party notices](docs/第三方组件说明.md).
