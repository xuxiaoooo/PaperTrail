# Resource measurements / 资源占用记录

## Lifecycle / 进程生命周期

- Main-window close destroys the BrowserWindow and its renderer. / 关闭主窗口会销毁窗口及其页面进程。
- The menu bar popover is created on demand and destroyed on blur. / 菜单栏弹窗按需创建，失焦后销毁。
- Submission reading handles one account at a time and closes its browser immediately after the read. / 每次只读取一个账号，并在读取完成后立即关闭浏览器。

These behaviors are checked by the desktop smoke checks and reader-worker tests. / 桌面功能检查与读取工作进程测试验证以上行为。

## Earlier 1.1 source-development sample / 旧版 1.1 源码开发样本

Measured on macOS 27.0.1, arm64, with two synthetic manuscripts and no active journal read. The screenshot generator samples the app and all child processes using `ps` after opening the interface and two seconds after closing it.

在 macOS 27.0.1、arm64 上测量，使用两个合成稿件，未进行实际期刊读取。截图脚本通过 `ps` 采样应用及其子进程，分别记录界面开启时及关闭两秒后的状态。

| State / 状态 | Process count / 进程数 | UI renderers / 页面进程 | Reading browsers / 读取浏览器 | Sum RSS / RSS 总和 |
| --- | ---: | ---: | ---: | ---: |
| Main window open / 主窗口开启 | 5 | 1 | 0 | 565.4 MiB |
| Main window closed / 主窗口关闭 | 4 | 0 | 0 | 425.7 MiB |

The recorded instance runs from source. Electron retains shared helper processes even with zero windows. Summing RSS can count shared pages more than once, so these values are **not the app's physical memory footprint**. Hardware, runtime version, cache state, account count and active reads change the result.

本次实例从源码运行。Electron 在没有窗口时仍保留共享辅助进程。RSS 求和可能重复计算共享页，因此以上数字**不等同应用的实际物理内存占用**。硬件、运行时版本、缓存、账号数量及读取状态都会影响结果。

Raw sample / 原始样本：[current-sample.json](current-sample.json)

## Optimization snapshot / 开发阶段优化对比

A previous local sample with two tracked manuscripts recorded 15 → 5 processes and reported summed RSS of 1,227.6 → 511.2 MB, a 58.4% reduction. This is an observed development comparison, not a standardized benchmark or universal promise.

此前两个已跟踪稿件的本机样本记录：进程数 15 → 5，所报告 RSS 总和 1,227.6 → 511.2 MB，减少约 58.4%。这是一组开发阶段观测，并非标准化基准测试或所有设备上的占用承诺。

Raw records / 原始记录：[optimization-snapshot.json](optimization-snapshot.json)

## Reproduce / 复现

On macOS, after preparing the local runtime / 在 Mac 上准备好本地运行组件后：

```sh
npm run docs:screenshots
```

The command uses a separate temporary data directory with synthetic records and removes it when finished. / 命令使用独立临时目录及合成记录，结束后删除该目录。
