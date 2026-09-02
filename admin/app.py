#!/usr/bin/env python3
"""
Live2D Kiosk 管理后台
- Flask :8080 —— 管理页 / API（模型上传/切换、显示开关、关机、消息转发）
- 消息链路（去 ws）：/api/send 写入轮询队列 → 页面 GET /api/poll 拉取显示
配置存储：/opt/dashboard/live2D panel/config.json
"""
import json
import os
import queue
import subprocess
import threading
import zipfile
import copy

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # /opt/dashboard/admin
# Web 根目录与 admin 同级（/opt/dashboard/live2D panel）
WEB_DIR = os.path.join(os.path.dirname(BASE_DIR), "live2D panel")
RES_DIR = os.path.join(WEB_DIR, "Resources")
BG_DIR = os.path.join(WEB_DIR, "bg")  # 自定义背景图目录
CONFIG_PATH = os.path.join(WEB_DIR, "config.json")
WS_PORT = 9000
ADMIN_PORT = 8080

DEFAULT_CONFIG = {
    "model": "Hiyori",
    "showTime": True,
    "showDate": True,
    "showWeather": True,
    "showBubble": True,
    "city": "",
    "weatherUnit": "c",
    "weatherProvider": "wttr",  # 天气源：wttr(海外默认) | amap(高德国内，需weatherKey)
    "weatherKey": "",  # 高德天气 API Key（可选；配了则 wttr 失败自动降级高德）
    "zoom": 1.43,
    "bubbleScrollSpeed": 20,  # 气泡循环滚动速度（px/s）
    "bubbleHold": 0,  # 气泡滞留秒数（0 = 一直显示，直到下一条消息替换）
    "bubblePlaceholder": "等待 agent 消息…",
    "bubbleFontSize": 14,
    "fontColors": {"time": "#ffffff", "date": "#9a9ab0", "weather": "#ffffff", "bubble": "#e8e8f2"},
    "bubbleBgColor": "#7c5cff",  # 气泡背景色（半透明磨砂渐变的基色）
    "bgTheme": "aurora",  # 屏幕背景主题：aurora(极光) | pink(粉嫩) | dark(深色) | mint(薄荷) | sunset(日落)
    "fontStyle": "default",  # 字体风格（兼容旧配置，已废弃——用 fontStyles 每模块）
    "fontStyles": {"time": "default", "date": "default", "weather": "default", "bubble": "default"},  # 各模块字体风格：default/round/quicksand/nunito/baloo/fredoka/orbitron/serif
    "infoSource": "wifi",  # 时间/天气信息来源：wifi(网络获取) | rndis(用户电脑推送)
    "astrbotUrl": "",  # AstrBot 主机地址（板子壳连接用）：局域网如 http://192.168.5.6:6185，或 DDNS 域名
    "astrbotKey": "",  # AstrBot API Key（WebUI 设置→API Key 创建，勾选 plugin/chat/file scope）
    "astrbotSession": "",  # 显示指定会话的消息（空 = 全部；后台「智能助手」页下拉选择）
    "layout": {
        "time": {"x": 0, "y": 0, "scale": 1},
        "date": {"x": 0, "y": 0, "scale": 1},
        "weather": {"x": 0, "y": 0, "scale": 1},
        "bubble": {"x": 0, "y": 0, "scale": 1},
        "model": {"x": 0, "y": 0, "scale": 1},
    },
}

# ---------- 配置 ----------
_lock = threading.Lock()


def load_config():
    with _lock:
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                merged = dict(DEFAULT_CONFIG)
                merged.update(cfg)
                return merged
            except Exception:
                pass
        return dict(DEFAULT_CONFIG)


def save_config(cfg):
    with _lock:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)


# ---------- 模型 ----------
def scan_models():
    models = []
    if not os.path.isdir(RES_DIR):
        return models
    for entry in sorted(os.listdir(RES_DIR)):
        d = os.path.join(RES_DIR, entry)
        if not os.path.isdir(d):
            continue
        model3 = os.path.join(d, f"{entry}.model3.json")
        if os.path.isfile(model3):
            models.append(entry)
    return models


# ---------- 消息队列（去 ws，页面轮询拉取） ----------
RECENT_MESSAGES = []  # 最近消息（页面 GET /api/poll 拉取后清空）
_RECENT_LOCK = threading.Lock()


# ---------- Flask ----------
app = Flask(__name__)


@app.after_request
def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/")
def admin_page():
    return send_from_directory(BASE_DIR, "admin.html")


@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    if request.method == "GET":
        return jsonify(load_config())
    cfg = load_config()
    data = request.get_json(silent=True) or {}
    for k in ("showTime", "showDate", "showWeather", "showBubble", "city", "weatherUnit", "weatherProvider", "weatherKey", "model", "zoom", "layout", "bubbleScrollSpeed", "bubbleHold", "bubblePlaceholder", "infoSource", "bubbleFontSize", "fontColors", "bubbleBgColor", "bgTheme", "fontStyles", "astrbotUrl", "astrbotKey", "astrbotSession"):
        if k in data:
            cfg[k] = data[k]
    save_config(cfg)
    broadcast({"type": "config", "config": cfg})
    return jsonify(cfg)


@app.route("/api/models", methods=["GET"])
def api_models():
    return jsonify({"models": scan_models()})


@app.route("/api/model", methods=["POST"])
def api_model_select():
    data = request.get_json(silent=True) or {}
    name = data.get("model", "")
    if name not in scan_models():
        return jsonify({"error": f"模型 {name} 不存在"}), 404
    cfg = load_config()
    cfg["model"] = name
    save_config(cfg)
    broadcast({"type": "config", "config": cfg})
    return jsonify(cfg)


@app.route("/api/upload", methods=["POST"])
def api_upload():
    """上传 zip（含模型目录或 model3.json），解压到 Resources/"""
    f = request.files.get("file")
    if not f or not f.filename.endswith(".zip"):
        return jsonify({"error": "请上传 .zip 文件"}), 400
    zpath = os.path.join("/tmp", f.filename)
    f.save(zpath)
    try:
        with zipfile.ZipFile(zpath) as z:
            names = z.namelist()
            model3 = [n for n in names if n.lower().endswith(".model3.json")]
            if not model3:
                return jsonify({"error": "zip 内未找到 .model3.json"}), 400
            # 解压（安全：拒绝绝对路径/..）
            for n in names:
                clean = n.replace("\\", "/")
                if clean.startswith("/") or ".." in clean.split("/"):
                    continue
            z.extractall(RES_DIR)
    except zipfile.BadZipFile:
        return jsonify({"error": "无效的 zip 文件"}), 400
    finally:
        try:
            os.remove(zpath)
        except OSError:
            pass
    models = scan_models()
    return jsonify({"ok": True, "models": models, "uploaded": [n.split("/")[0] for n in model3]})


@app.route("/api/send", methods=["POST"])
def api_send():
    """agent 消息转发：{type: emotion|action|speak, value/text}"""
    data = request.get_json(silent=True) or {}
    if not data.get("type"):
        return jsonify({"error": "缺少 type"}), 400
    broadcast(data)
    return jsonify({"ok": True})


WIFI_CONF = "/etc/wpa_supplicant/wpa_supplicant.conf"


def _sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
    except Exception:
        return None


@app.route("/api/wifi/scan", methods=["GET"])
def api_wifi_scan():
    """扫描 WiFi（需 wlan0 up + root）"""
    _sh("sudo ip link set wlan0 up 2>/dev/null")
    r = _sh("sudo iw dev wlan0 scan 2>/dev/null")
    if not r or r.returncode != 0:
        return jsonify({"error": "扫描失败（wlan0 不可用？）", "networks": []})
    networks = []
    cur = {}
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith("BSS "):
            if cur.get("ssid"):
                networks.append(cur)
            cur = {"bssid": line.split()[1].split("(")[0]}
        elif "SSID:" in line:
            cur["ssid"] = line.split("SSID:")[1].strip()
        elif "signal:" in line:
            try:
                cur["signal"] = int(float(line.split("signal:")[1].split(" dBm")[0].strip()))
            except ValueError:
                cur["signal"] = -100
        elif "WPA" in line or "RSN" in line:
            cur.setdefault("secure", True)
    if cur.get("ssid"):
        networks.append(cur)
    # 去重 + 排序（信号强优先）
    seen = {}
    for n in networks:
        s = n.get("ssid", "")
        if s and s not in seen:
            n["secure"] = bool(n.get("secure"))
            seen[s] = n
    nets = sorted(seen.values(), key=lambda n: -int(n.get("signal", -100)))
    return jsonify({"networks": nets})


@app.route("/api/wifi/connect", methods=["POST"])
def api_wifi_connect():
    data = request.get_json(silent=True) or {}
    ssid = (data.get("ssid") or "").strip()
    password = data.get("password") or ""
    if not ssid:
        return jsonify({"error": "缺少 SSID"}), 400
    # 写 wpa_supplicant 配置
    esc = ssid.replace('"', '\\"')
    if password:
        conf = f'ctrl_interface=/var/run/wpa_supplicant\nnetwork={{\n    ssid="{esc}"\n    psk="{password}"\n}}\n'
    else:
        conf = f'ctrl_interface=/var/run/wpa_supplicant\nnetwork={{\n    ssid="{esc}"\n    key_mgmt=NONE\n}}\n'
    try:
        with open(WIFI_CONF, "w") as f:
            f.write(conf)
    except Exception as e:
        return jsonify({"error": f"写入配置失败: {e}"}), 500
    # 启动连接
    _sh("sudo pkill -f wpa_supplicant 2>/dev/null; sleep 1")
    _sh("sudo ip link set wlan0 up")
    _sh(f"sudo wpa_supplicant -B -i wlan0 -c {WIFI_CONF}")
    _sh("sudo dhclient wlan0 2>/dev/null || sudo dhcpcd wlan0 2>/dev/null")
    return jsonify({"ok": True, "msg": f"正在连接 {ssid}…"})


@app.route("/api/wifi/status", methods=["GET"])
def api_wifi_status():
    r = _sh("iw dev wlan0 link 2>/dev/null")
    connected = bool(r and "Connected to" in r.stdout)
    ssid = ""
    if connected:
        for line in r.stdout.splitlines():
            if "SSID:" in line:
                ssid = line.split("SSID:")[1].strip()
    ip = ""
    r2 = _sh("ip -4 addr show wlan0 2>/dev/null | grep inet")
    if r2 and r2.stdout.strip():
        ip = r2.stdout.strip().split()[1]
    return jsonify({"connected": connected, "ssid": ssid, "ip": ip})


@app.route("/api/wifi/disconnect", methods=["POST"])
def api_wifi_disconnect():
    _sh("sudo pkill -f wpa_supplicant 2>/dev/null; sleep 1; sudo ip link set wlan0 down 2>/dev/null")
    return jsonify({"ok": True, "msg": "WiFi 已断开"})


@app.route("/api/config/reset", methods=["POST"])
def api_config_reset():
    """重置所有设置为默认值"""
    save_config(copy.deepcopy(DEFAULT_CONFIG))
    return jsonify({"ok": True, "msg": "已重置为默认设置"})


@app.route("/api/poweroff", methods=["POST"])
def api_poweroff():
    threading.Thread(
        target=lambda: subprocess.run(["sudo", "poweroff"], check=False), daemon=True
    ).start()
    return jsonify({"ok": True, "msg": "关机中…"})


@app.route("/api/reboot", methods=["POST"])
def api_reboot():
    threading.Thread(
        target=lambda: subprocess.run(["sudo", "reboot"], check=False), daemon=True
    ).start()
    return jsonify({"ok": True, "msg": "重启中…"})


def broadcast(msg):
    """消息写入轮询队列（页面定时 GET /api/poll 拉取）"""
    with _RECENT_LOCK:
        RECENT_MESSAGES.append(msg)
        if len(RECENT_MESSAGES) > 50:
            RECENT_MESSAGES.pop(0)


@app.route("/api/astrbot/test")
def astrbot_test():
    """测试 AstrBot 连接：调插件 ping API"""
    import urllib.request

    cfg = load_config()
    base = (cfg.get("astrbotUrl") or "").rstrip("/")
    key = cfg.get("astrbotKey") or ""
    if not base or not key:
        return jsonify({"ok": False, "error": "请先填写 AstrBot 地址和 API Key 并保存"})
    try:
        req = urllib.request.Request(
            f"{base}/api/v1/plugins/extensions/live2d-kiosk/ping",
            headers={"Authorization": f"Bearer {key}"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read().decode("utf-8"))
            return jsonify({"ok": True, "detail": d})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)[:200]})


@app.route("/api/shell/status")
def shell_status():
    """板子壳最近状态（/tmp/board_shell.status）"""
    try:
        with open("/tmp/board_shell.status", "r") as f:
            return jsonify(json.load(f))
    except Exception:
        return jsonify({"ok": False, "error": "屏幕连接程序未运行", "running": False})


@app.route("/api/astrbot/sessions")
def astrbot_sessions():
    """代理：拉取 AstrBot 插件活跃会话列表（后台下拉切换显示会话用）"""
    import urllib.request

    cfg = load_config()
    base = (cfg.get("astrbotUrl") or "").rstrip("/")
    key = cfg.get("astrbotKey") or ""
    if not base or not key:
        return jsonify({"ok": False, "error": "未配置 AstrBot 地址/Key", "sessions": {}})
    try:
        req = urllib.request.Request(
            f"{base}/api/v1/plugins/extensions/live2d-kiosk/sessions",
            headers={"Authorization": f"Bearer {key}"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            return jsonify(json.loads(r.read().decode("utf-8")))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "sessions": {}})


@app.route("/api/config/defaults")
def config_defaults():
    """返回默认配置（前端单项重置按钮用）"""
    return jsonify(DEFAULT_CONFIG)


@app.route("/api/clear", methods=["POST"])
def api_clear():
    """清空屏幕消息：清插件队列（代理）+ 本地队列 + 通知页面恢复占位"""
    import urllib.request

    cfg = load_config()
    base = (cfg.get("astrbotUrl") or "").rstrip("/")
    key = cfg.get("astrbotKey") or ""
    cleared_remote = 0
    if base and key:
        try:
            req = urllib.request.Request(
                f"{base}/api/v1/plugins/extensions/live2d-kiosk/clear",
                headers={"Authorization": f"Bearer {key}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=8) as r:
                d = json.loads(r.read().decode("utf-8"))
                cleared_remote = d.get("cleared", 0)
        except Exception:
            pass
    with _RECENT_LOCK:
        RECENT_MESSAGES.clear()
    broadcast({"type": "clear"})
    return jsonify({"ok": True, "cleared": cleared_remote})


@app.route("/bg/<path:fname>")
def bg_file(fname):
    """自定义背景图静态服务（页面 #bg 引用）"""
    return send_from_directory(BG_DIR, fname)


@app.route("/api/bg/upload", methods=["POST"])
def bg_upload():
    """上传自定义背景图（保存到 bg/ 目录并写入配置）"""
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "未选择文件"})
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        return jsonify({"ok": False, "error": "仅支持 jpg/png/webp 图片"})
    import time as _t

    os.makedirs(BG_DIR, exist_ok=True)
    # 清理旧背景图（只保留当前一张）
    cfg = load_config()
    old = cfg.get("bgImage")
    if old:
        try:
            os.remove(os.path.join(BG_DIR, old))
        except OSError:
            pass
    name = f"bg_{int(_t.time())}{ext}"
    f.save(os.path.join(BG_DIR, name))
    cfg["bgImage"] = name
    save_config(cfg)
    broadcast({"type": "config", "config": {"bgImage": name}})
    return jsonify({"ok": True, "bgImage": name})


@app.route("/api/bg", methods=["DELETE"])
def bg_remove():
    """移除自定义背景图（回到渐变主题）"""
    cfg = load_config()
    old = cfg.get("bgImage")
    if old:
        try:
            os.remove(os.path.join(BG_DIR, old))
        except OSError:
            pass
    cfg["bgImage"] = ""
    save_config(cfg)
    broadcast({"type": "config", "config": {"bgImage": ""}})
    return jsonify({"ok": True})


@app.route("/api/poll")
def api_poll():
    """页面轮询：拉取最近消息并清空"""
    with _RECENT_LOCK:
        msgs = list(RECENT_MESSAGES)
        RECENT_MESSAGES.clear()
    return jsonify({"messages": msgs})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=ADMIN_PORT, debug=False)
