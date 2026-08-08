#!/bin/bash
# WiFi 开机自动连接（产品无网线，开机后自动连已保存的 WiFi）
# 由 wifi-autoconnect.service 调用；未配置过 WiFi 时静默跳过
CONF="/etc/wpa_supplicant/wpa_supplicant.conf"
[ -f "$CONF" ] || exit 0

# 清理可能残留的 wpa_supplicant（与 dbus 版服务共存时的冲突保护）
pkill -f "wpa_supplicant.*wlan0" 2>/dev/null
sleep 1

ip link set wlan0 up 2>/dev/null
sleep 1
wpa_supplicant -B -i wlan0 -c "$CONF" 2>/dev/null
sleep 4
dhclient wlan0 2>/dev/null || dhcpcd wlan0 2>/dev/null

exit 0
