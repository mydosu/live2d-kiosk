# Live2D Kiosk Demo

基于 **easy-live2d**（Pixi.js v8 的 Live2D 社区封装库）的 Live2D 展示页，专为 **Chromium kiosk 小屏幕** 设计。

支持 8 个官方示例模型：Hiyori / Haru / Mao / Mark / Natori / Ren / Rice / Wanko

## 功能

| 功能 | 说明 |
|---|---|
| 模型切换 | 面板按钮或 ← / → 快捷键 |
| 自动待机动作 | 加载后自动循环播放随机 Idle 动作（可关） |
| 点击交互 | 点击模型身体 → 命中检测 + 播放 Tap 动作 |
| 表情切换 | 面板动态列出模型全部表情（Haru/Mao/Natori/Ren 有） |
| 语音口型同步 | Haru 模型附带 4 段官方语音（wav + LipSync） |
| 鼠标跟随 | 模型视线跟随鼠标/触摸 |
| 拖拽 | 可拖动模型位置 |
| HUD 自动隐藏 | 3.5 秒无操作自动隐藏控制条，kiosk 模式更干净 |
| 全屏 | ⛶ 按钮或 F 键 |
| 小屏适配 | 模型按原始画布比例缩放居中，随窗口尺寸自动调整 |

## 目录结构

```
demo/
├── index.html              # 主页面（画布 + 控制面板 UI）
├── vite.config.js          # base:'./' 相对路径，可部署到任意子目录
├── src/main.js             # 核心逻辑
├── public/
│   ├── Core/live2dcubismcore.js   # Live2D Cubism Core 5.0.0（⚠️ 版本关键，见下）
│   ├── favicon.png
│   └── Resources/          # 8 个官方示例模型（从 SDK Samples 复制）
├── verify.mjs              # 无头浏览器自动验证脚本（开发用）
└── core-test.mjs           # Core API 探测脚本（开发用）
```

## ⚠️ Core 版本兼容性（重要）

easy-live2d v0.4.4 内置 **Cubism Framework 5**，必须搭配 **Core 5.x**：

- ✅ **Core 5.0.0**（本目录 public/Core/ 当前版本，来自 easy-live2d-playground 官方仓库）→ 正常渲染
- ❌ **Core 6.x**（如 SDK 5-r.5 自带的 6.0.1）→ 模型加载后渲染循环每帧报错 `Cannot read properties of undefined (reading '0')`

原因：Core 6 对 JS API 做了破坏性重构（`Model.fromMoc()` 取代 `Moc.createModel()`、`getRenderOrders()` 方法取代 `.drawables.renderOrders` 属性），与 Framework 5 不兼容。

⚠️ 如果从 Live2D 官网下载了新版 SDK，请确认 Core 版本，**不要覆盖** public/Core/live2dcubismcore.js（SDK 6 的 Core 会导致白屏）。当前目录保留了 SDK 6 的备份：`live2dcubismcore.sdk6.js.bak`。

## 开发

```bash
npm install
npm run dev        # http://localhost:5173
npm run verify     # 无头浏览器自动验证（需本机 Edge，输出模型加载状态）
```

## 生产构建

```bash
npm run build      # 输出到 dist/（纯静态，可离线部署）
npm run serve      # 本地预览构建产物 http://localhost:4173
```

构建产物 `dist/` 包含全部依赖（pixi.js、easy-live2d 已打包）+ 模型资源，**完全离线可用**。
因为是 `base:'./'` 相对路径，`dist/` 放到任意静态服务器目录（或子路径）都能直接跑。

## Kiosk 部署（Chromium）

### 1. 静态托管 dist/

任意静态服务器即可，例如 Python：

```bash
cd dist
python -m http.server 8080
```

或用 Node：

```bash
npx serve dist -l 8080
```

### 2. Chromium kiosk 模式启动

Windows（Chrome / Edge）：

```bat
start chrome --kiosk --no-first-run --disable-session-crashed-bubble ^
  --disable-infobars --autoplay-policy=no-user-gesture-required ^
  --window-size=1280,800 http://localhost:8080/
```

Edge：

```bat
start msedge --kiosk --no-first-run --autoplay-policy=no-user-gesture-required ^
  --window-size=1280,800 http://localhost:8080/
```

Linux（树莓派等）：

```bash
chromium-browser --kiosk --no-first-run --autoplay-policy=no-user-gesture-required \
  --window-size=1024,600 http://localhost:8080/
```

> `--autoplay-policy=no-user-gesture-required`：kiosk 无人工操作时语音/动作音效也能播放。
> 小屏幕建议 `--force-device-scale-factor=1` 保持 1:1 像素，避免模糊。

### 3. 开机自启（Windows）

`Win+R` → `shell:startup` → 放入快捷方式，目标：

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk http://localhost:8080/
```

## 快捷键

| 键 | 功能 |
|---|---|
| ← / → | 切换模型 |
| 空格 | 播放待机动作 |
| F | 全屏 |
| H | 显示/隐藏控制面板 |
