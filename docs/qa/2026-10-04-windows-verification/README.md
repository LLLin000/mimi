# mimi v1.5.9 — Windows 真机验证截图（2026-10-04）

采集机：Windows 11 家庭版 中文版 25H2 `10.0.26200.9457`；显示 150%（`GetDpiForWindow=144`）+ Windows 文本缩放 120% → WebView `devicePixelRatio=1.8`。
被测件：官方 `mimi_1.5.9_x64-portable.zip` 解出的 `mimi.exe`
- zip SHA256 `8e4e4685445894e58d00df6a6def1a59b0b4dfbcd37f79e81011e6fdbd8c798b`（与 `SHA256SUMS.txt` 一致）
- exe SHA256 `aa5c6654ac3f7bc4b53973da6d8251478df05ceeb058f0cb5688c254795166bc`

> 这组截图是**公开证据副本**，只放设置页/安装器窗口画面；不含会议或字幕正文。`point3-capture-apps-open-cropped.png` 已裁掉应用清单里的第三方应用名。

## 设置页布局与 CJK 字体（issue #132 复测）
- `settings-zh-narrow.png` / `settings-zh-max.png`：中文，窄窗（客户区 780×894 物理 = 520×596 Tauri 逻辑，CSS 视口 434×497）与最大化（CSS 1778×1053）
- `settings-en-narrow.png` / `settings-en-max.png`：English
- `settings-ja-narrow.png` / `settings-ja-max.png`：日本語
- UI-test 模式（合成会话状态，无凭据/无采集）；语言经设置页「通用 → 界面语言」真实点击切换
- 原始数值：相邻设置行间距 23.99–24 CSS px；`采集应用 ↔ 输出设备` 两个 36 px 选择器行间距 16 CSS px、控件间距 51.99 px；中文标签 `clientWidth == scrollWidth`、`getClientRects().length == 1`
- 字体：5 个中文节点 `CSS.getPlatformFontsForNode` 唯一返回 `Microsoft YaHei UI`（`postScriptName = MicrosoftYaHeiUI-Bold`）

## Windows 采音与路由（issue #74 / #78 复测）
- `point-1-settings-row.png`：输出设备 = `跟随系统`，行文案 `耳机 (Chu2 DSP) · 收到声音`（策略 `follow_system`，实际绑定到正在发声的通信设备）
- `point-2-settings-row.png`：同一会话内再向默认扬声器播语音，设备仍停留在耳机（会话开始时绑定）
- `point-3-settings-row.png`：输出设备 = `跟随通信设备（通话耳机）`，行文案 `耳机 (Chu2 DSP) · 收到声音`（`manual_output`）
- `point3-capture-apps-open-cropped.png`：`采集应用` 下拉展开（已裁掉应用清单；普通模式下 `audio_applications` 返回 22 个真实应用）
- 现场条件：`Console = Multimedia = 扬声器 (Realtek(R) Audio)`（peak 全程 0.000000）、`Communications = 耳机 (Chu2 DSP)`（peak 0.0004–0.36 波动）；测试期间未改动 Windows 路由

## 安装与应用内更新（Windows）
- `update-10-baseline.png`：`当前版本 v1.5.3`
- `update-20-after-check.png`：`发现新版本 v1.5.9。` + 版本说明
- `update-30-after-download.png`：按钮 `安装并重启 Mimi`
- `update-31-install-clicked.png`：点击安装后（busy）
- `motw-installer-window.png`：写入 `Zone.Identifier`（`ZoneId=3`）后启动安装器，出现的是安装器自身窗口（`安装 Mimi`），**未出现 SmartScreen 弹窗**（本机 `HKLM\SOFTWARE\Policies\Microsoft\Windows\System\EnableSmartScreen = 0`）
- 更新结果：卸载表 `1.5.3 → 1.5.9`；`mimi.exe` 8,578,560 B `8E074CEC…` → 9,674,752 B `ADA67FB0…`；`preferences.json` 与 `%APPDATA%\app.yuxino.mimi`（31 文件 / 160,632,634 B）全程未变
