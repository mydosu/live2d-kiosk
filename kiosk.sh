#!/bin/bash
# Live2D Kiosk 启动脚本 —— Xorg + Chromium 全屏（含屏幕旋转）
# 由 live2d-kiosk.service 调用（xinit 方式，root 启动 X，Chromium 以 myduso 运行）
export DISPLAY=:0

# 等待 X server 就绪
for i in $(seq 1 30); do
  xdpyinfo -display :0 >/dev/null 2>&1 && break
  sleep 0.5
done

# 屏幕旋转（2.8" 竖屏面板需要 rotate left，用户验证的正确方向）
# --mode 480x640：面板原生物理分辨率（竖屏）。rotate left 后逻辑 640x480，
# 与 Chromium viewport(800x600, 4:3) 比例一致 → 等比缩放不变形。
# 注意：不能写 --mode 640x480（横屏模式 rotate 后 480x640 与 viewport 比例相反 → 画面宽胖变形）；
# 也不能不指定 mode（--reflect y 会触发 mode 重协商漂移到 768x1024 → 白屏）。
# --reflect y：分光棱镜（45° 半透半反镜）反射像上下颠倒 → 输出垂直翻转后棱镜画面正立
xrandr --output HDMI-1 --mode 480x640 --rotate left --reflect y 2>/dev/null
sleep 1

# 禁用屏幕休眠/屏保（产品需常亮显示；DPMS 默认 600s 关屏）
xset -dpms 2>/dev/null
xset s off 2>/dev/null
xset s noblank 2>/dev/null

# CPU 调频策略：不再强制最高频（performance 发热严重，改回内核默认 schedutil）
# schedutil 按需升频，日常负载下频率自动回落，温度明显下降
# 注意：不要加 --renderer-process-limit/--disable-software-rasterizer 等激进 flags
#（实测 --renderer-process-limit=1 导致渲染进程内存暴涨 → 系统 OOM 卡死）
echo schedutil > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null
sleep 0.5

# 启动极轻量窗口管理器 openbox —— 无 WM 时 Chromium 无法真正全屏到屏幕尺寸
openbox >/dev/null 2>&1 &
disown

# 隐藏鼠标指针（不移动时自动隐藏；接上鼠标移动时重新出现）
pkill -f "unclutter" 2>/dev/null
unclutter -idle 1 -root >/dev/null 2>&1 &
disown

# 清理可能残留的 chromium 与 keep-alive
pkill -f "chromium.*kiosk" 2>/dev/null
pkill -f "chrome.*kiosk" 2>/dev/null
pkill -f "cdp-keepalive" 2>/dev/null
pkill -f "keepalive.mjs" 2>/dev/null
sleep 1

exec su - myduso -c '
export DISPLAY=:0
export XDG_RUNTIME_DIR=/run/user/1000
# 注意：不要设置 LD_LIBRARY_PATH —— chrome 的 RPATH 已指向自带 ANGLE 库
# --use-angle=gles：ANGLE GLES 后端直通系统 mesa → Panfrost 硬件加速（用户验证可用）
# --window-size=480,640：强制窗口=屏幕（默认 800x600 窗口 + 全屏失败会导致
# viewport 与屏幕不一致 → 画面变形/白屏）

# CDP keep-alive：保持挂起 evaluate，强制 Chromium 合成器持续出帧
# （否则合成器退避，无调试连接时只有 ~3fps，挂起 evaluate 时 ~12fps）
(sleep 10; export PATH=/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; cd /opt/dashboard/keepalive && node keepalive.mjs) >/tmp/cdp-keepalive.log 2>&1 &

exec dbus-run-session -- /usr/bin/chromium \
  --kiosk \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --disable-component-update \
  --disable-background-networking \
  --disable-extensions \
  --disable-sync \
  --disable-features=Translate,TranslateUI,LensOverlay,LensRegionSearchOverlay \
  --disable-translate \
  --force-language=en-US \
  --lang=en-US \
  --autoplay-policy=no-user-gesture-required \
  --enable-logging=stderr \
  --use-gl=angle \
  --use-angle=gles \
  --enable-gpu \
  --enable-gpu-rasterization \
  --in-process-gpu \
  --disable-vsync \
  --disable-gpu-vsync \
  --disable-begin-frame-backoff \
  --disable-frame-rate-limit \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  --ignore-gpu-blocklist \
  --no-sandbox \
  --remote-debugging-port=9222 \
  --start-fullscreen \
  --window-size=480,640 \
  --window-position=0,0 \
  --check-for-update-interval=31536000 \
  "http://localhost:80/?kiosk=1&v=20260810" > /tmp/kiosk-chromium.log 2>&1
'
