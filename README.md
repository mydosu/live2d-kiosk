# Live2D 桌面助手（伪全息终端）

基于 Orange Pi Zero 2W 的 Live2D 桌面终端：2.8" HDMI 竖屏 + Chromium kiosk 全屏渲染，配合分光棱镜实现伪全息显示。设备通过 WebSocket / HTTP 接口可被 astrbot 等 AI 助手控制——模型表情、动作、对话气泡均由消息协议驱动。

## 功能

- 开机自启全屏 Live2D 模型（内置 Hiyori、Haru 等 8 个官方模型，支持网页上传/切换）
- 左侧信息面板：时间 / 日期 / 天气（wttr.in）+ 循环滚动消息气泡，位置、缩放、颜色均可配置
- Agent 控制：`emotion` / `action` / `speak` / `timeinfo` 消息协议（详见 `docs/Agent接口文档.md`）
- 双信息源：WiFi 自连，或 USB RNDIS 由电脑推送
- 网页管理后台（移动端可用）：模型管理、显示设置、界面排版、WiFi 连接、重启/关机

## 硬件

- Orange Pi Zero 2W（2GB）
- 2.8" HDMI 屏（480x640 竖屏面板）
- 分光棱镜（伪全息反射）
- USB-C 供电 + WiFi 天线（无网线接口）

## 快速开始

板子刷 Armbian 后：

```bash
# 1. 前端构建（node）
cd demo
npm install
npm run build

# 2. 部署到板子（需要 paramiko；SSH 密码走环境变量 RK_PASS）
python scripts/deploy.py
```

开机后以下服务自启：

```bash
systemctl status live2d-web    # 页面 :80
systemctl status live2d-admin  # 管理后台 :8080 + WebSocket :9000
systemctl status live2d-kiosk  # Xorg + openbox + Chromium 全屏
```

管理后台：`http://<板子IP>:8080`（USB 连接为 `http://192.168.30.1:8080`）。

## 架构

```
┌─────────────┐   POST /api/send   ┌──────────────────┐   ws :9000   ┌─────────────┐
│ astrbot 等  │ ─────────────────▶ │ live2d-admin     │ ───────────▶ │ live2d-web  │
│   Agent     │   emotion/action/  │ (Flask + ws)     │   broadcast  │ (Chromium)  │
└─────────────┘   speak/timeinfo   └──────────────────┘              └─────────────┘
```

- 配置持久化：`config.json`（部署脚本自动备份恢复，勿手动 `cp -r dist/.` 覆盖）
- 一键部署：`scripts/deploy.py`（构建 → 上传 → 备份 config → 重启 → 验证）

## 实现要点

- **GPU 硬解**：`--use-angle=gles`——ANGLE GLES 后端直通系统 Mesa → Mali-G31 Panfrost（`--use-angle=gl` 失败、vulkan 仅 llvmpipe 软渲染、panvk 在 G31 不可用）
- **帧率稳定 12fps**：Chromium 合成器空闲退避导致无连接时仅 3.8fps；`keepalive.mjs` 挂起 CDP evaluate 强制持续出帧（详见 `scripts/keepalive.mjs`）
- **显示链**：`xrandr --mode 480x640 --rotate left --reflect y`——面板原生竖屏 rotate 后与 Chromium viewport（800x600）保持 4:3 同比例，`--reflect y` 补偿棱镜翻转
- **稳定性**：CPU governor 固定 `performance`（schedutil 调频会触发 H616 CCU 时钟驱动内核崩溃）；勿加 `--renderer-process-limit` 等激进 flags（2GB 内存 OOM 瘫痪）
- **开机优化**：bootlogo=false + quiet（无 logo）、关机超时 10s

## 目录

```
demo/       前端（Vite + easy-live2d）
admin/      管理后台（Flask + WebSocket）
scripts/    部署脚本、systemd 单元、kiosk.sh、keepalive、cpufreq 服务
docs/       Agent 对接文档
```

## 许可

代码 MIT。Live2D Cubism Core 版权归 Live2D Inc.（随 SDK 分发，勿单独再分发）；模型资源版权归原作者，仅作演示。

配套 astrbot 插件见 [astrbot-live2d-kiosk](https://github.com/mydosu/astrbot-live2d-kiosk)。
