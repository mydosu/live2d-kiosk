# Live2D 桌面助手（伪全息小终端）

用 Orange Pi Zero 2W + 一块 2.8 寸小屏做的桌面 AI 助手，上面放个分光棱镜，Live2D 妹子就"飘"在屏幕上方了。

## 这是啥

一个小玩具，也是认真在做的产品原型：

- 开机自启，全屏跑一个 Live2D 角色（Hiyori、Haru 这些官方模型都带上了）
- 屏幕左边显示时间/日期/天气，右边是模型，消息气泡在中间滚
- 接上 astrbot 之类的 AI 助手后，它能控制角色做表情、做动作、说话
- USB 连电脑（RNDIS）或者 WiFi 联网都行，没网线接口只能这样
- 有个网页管理后台（手机也能开）：换模型、调位置大小、改颜色、连 WiFi、重启关机

## 硬件

- Orange Pi Zero 2W（2GB 版）
- 2.8" HDMI 小屏（480x640 竖屏）
- 分光棱镜（伪全息反射用）
- USB-C 供电 + WiFi 天线

## 跑起来

板子刷 Armbian 后，按顺序：

1. 前端构建（需要 node）：

```bash
cd demo
npm install
npm run build
```

2. 部署到板子（需要 paramiko，密码走环境变量 RK_PASS）：

```bash
python scripts/deploy.py
```

3. 板子上电，完事。系统里这些服务会自启：

```bash
systemctl status live2d-web    # 页面 :80
systemctl status live2d-admin  # 管理后台 :8080
systemctl status live2d-kiosk  # Xorg + Chromium 全屏
```

管理后台地址：`http://<板子IP>:8080`（USB 连电脑就是 http://192.168.30.1:8080）

## 折腾记录（踩坑心得）

- Chromium 的 GL 后端折腾了很久：`--use-gl=egl` 被拒、`vulkan` 只有软渲染，最后 **`--use-angle=gles`** 才吃到 Mali-G31 的 Panfrost 硬解
- 帧率一开始只有 3.8fps，开着调试工具却有 12fps。查了半天是 Chromium 合成器的帧退避，最后用个脚本挂起 CDP evaluate 骗它一直出帧（`keepalive.mjs`），现在稳定 12fps
- 屏幕旋转 + 棱镜反射会带来一堆显示问题（白屏、画面压扁），关键是 `xrandr` 的模式要和 Chromium 的 viewport 保持同一比例，具体看 `kiosk.sh` 里的注释
- 模型加载卡死过一次，是 `gl.readPixels` 同步读 GPU 把主线程堵死了，后来干脆不用像素测量，改成手动调缩放

## 目录

```
demo/       前端（Vite + easy-live2d）
admin/      管理后台（Flask + WebSocket）
scripts/    部署脚本、systemd 单元、kiosk.sh、keepalive
docs/       Agent 对接文档
```

## 许可

代码部分 MIT。Live2D 的 Cubism Core 版权归 Live2D Inc.，别拿去单独分发；模型资源版权归原作者，仅演示用。

部署脚本里的 SSH 密码不要硬编码，走环境变量。
