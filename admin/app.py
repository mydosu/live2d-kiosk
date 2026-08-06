#!/usr/bin/env python3
"""
Live2D Kiosk 管理后台
- Flask :8080 —— 管理页 / API（模型上传/切换、显示开关、关机、消息转发）
- websockets :9000 —— 页面实时通道（页面连 /ws 收控制消息；agent 可连 /ws 或 POST /api/send）
配置存储：/opt/dashboard/live2D panel/config.json
"""
import json
import os
import queue
import subprocess
import threading
import zipfile
import copy

import websockets
from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # /opt/dashboard/admin
# Web 根目录与 admin 同级（/opt/dashboard/live2D panel）
WEB_DIR = os.path.join(os.path.dirname(BASE_DIR), "live2D panel")
RES_DIR = os.path.join(WEB_DIR, "Resources")
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
    "zoom": 1.43,
    "bubbleScrollSpeed": 20,
    "bubblePlaceholder": "等待 agent 消息…",
    "bubbleFontSize": 14,
    "fontColors": {"time": "#ffffff", "date": "#9a9ab0", "weather": "#ffffff", "bubble": "#e8e8f2"},
    "infoSource": "wifi",  # 时间/天气信息来源：wifi(网络获取) | rndis(用户电脑推送)
    "wsPort": 9000,  # websocket 实时通道端口（改后需重启 live2d-admin 生效）
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


# ---------- websocket 广播 ----------
clients = set()  # 页面 ws 连接
_ws_loop = None  # ws 线程的事件循环
_send_queue = None  # asyncio.Queue：Flask 线程 → ws 线程


def ws_thread():
    global _ws_loop, _send_queue
    import asyncio

    print("[ws] thread started", flush=True)
    _ws_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_ws_loop)
    _send_queue = asyncio.Queue()

    async def handler(ws):
        print("[ws] client connected", flush=True)
        clients.add(ws)
        try:
            # 连接即推送初始配置与模型列表
            await ws.send(
                json.dumps(
                    {
                        "type": "init",
                        "models": scan_models(),
                        "config": load_config(),
                    }
                )
            )
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                # agent/页面消息：转发给其他连接
                for c in list(clients):
                    if c is not ws:
                        try:
                            await c.send(json.dumps(msg))
                        except Exception:
                            pass
        except Exception:
            pass
        finally:
            clients.discard(ws)

    async def relay():
        # 注意：必须用 asyncio.Queue —— queue.Queue.get(timeout) 是同步阻塞，
        # 在事件循环里每 1 秒卡死整个循环，导致 ws 握手永远无法完成
        while True:
            msg = await _send_queue.get()
            dead = []
            for c in list(clients):
                try:
                    await c.send(json.dumps(msg))
                except Exception:
                    dead.append(c)
            for c in dead:
                clients.discard(c)

    async def main():
        # 注意：websockets v15 的 serve() 端口绑定在 `async with` 进入时发生，
        # 不能只用 await gather(serve(...))（那样不绑定端口）
        ws_port = int(load_config().get("wsPort", 9000) or 9000)
        async with websockets.serve(
            handler, "0.0.0.0", ws_port, max_size=10 * 1024 * 1024
        ):
            print(f"[ws] serving on {ws_port}", flush=True)
            await relay()

    try:
        _ws_loop.run_until_complete(main())
    except Exception:
        import traceback

        traceback.print_exc()


threading.Thread(target=ws_thread, daemon=True).start()


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
    for k in ("showTime", "showDate", "showWeather", "showBubble", "city", "weatherUnit", "model", "zoom", "layout", "bubbleScrollSpeed", "bubblePlaceholder", "infoSource", "wsPort", "bubbleFontSize", "fontColors"):
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
    """Flask 线程 → ws 线程（跨线程投递到事件循环）"""
    if _send_queue is not None and _ws_loop is not None:
        import asyncio

        asyncio.run_coroutine_threadsafe(_send_queue.put(msg), _ws_loop)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=ADMIN_PORT, debug=False)
