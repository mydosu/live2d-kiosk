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
CLEAR_TS = 0.0  # 清屏版本号（幂等：kiosk/预览 iframe 各自 poll 比对执行清屏，无竞争）

DEFAULT_CONFIG = {
    "model": "Hiyori",
    "showTime": True,
    "showDate": True,
    "showWeather": True,
    "showBubble": True,
    "city": "",
    "weatherUnit": "c",
    "weatherProvider": "amap",  # 天气源：amap(高德，默认，需weatherKey) | wttr(海外备选)
    "weatherKey": "",  # 高德天气 API Key（可选；配了则 wttr 失败自动降级高德）
    "zoom": 1.43,
    "bubbleScrollSpeed": 20,  # 气泡循环滚动速度（px/s）
    "bubbleHold": 0,  # 气泡滞留秒数（0 = 一直显示，直到下一条消息替换）
    "bubblePlaceholder": "等待 agent 消息…",
    "bubbleFontSize": 14,
    "fontColors": {"time": "#ffffff", "date": "#9a9ab0", "weather": "#ffffff", "bubble": "#e8e8f2", "wifi": "#ffffff", "bt": "#ffffff"},  # 各模块字体颜色
    "bubbleBgColor": "#7c5cff",  # 气泡背景色（半透明磨砂渐变的基色）
    "bgTheme": "aurora",  # 屏幕背景主题：aurora(极光) | pink(粉嫩) | dark(深色) | mint(薄荷) | sunset(日落)
    "fontStyle": "default",  # 字体风格（兼容旧配置，已废弃——用 fontStyles 每模块）
    "fontStyles": {"time": "default", "date": "default", "weather": "default", "bubble": "default", "wifi": "default", "bt": "default"},  # 各模块字体风格：default/round/quicksand/nunito/baloo/fredoka/orbitron/serif/cnround
    "showWifi": True,  # 显示 WiFi 连接状态模块
    "showBt": True,  # 显示蓝牙连接状态模块
    "infoSource": "wifi",  # 兼容旧配置（单值）；新配置用 netSources 多选
    "netSources": ["wifi", "usb"],  # 联网方式多选（互不干扰可共存）：wifi(无线) | usb(USB 共享网络/电脑 ICS)
    "astrbotUrl": "",  # AstrBot 主机地址（板子壳连接用）：局域网如 http://192.168.5.6:6185，或 DDNS 域名
    "astrbotKey": "",  # AstrBot API Key（WebUI 设置→API Key 创建，勾选 plugin/chat/file scope）
    "astrbotSession": "",  # 显示指定会话的消息（空 = 全部；后台「智能助手」页下拉选择）
    "layout": {
        "time": {"x": 0, "y": 0, "scale": 1},
        "date": {"x": 0, "y": 0, "scale": 1},
        "weather": {"x": 0, "y": 0, "scale": 1},
        "bubble": {"x": 0, "y": 0, "scale": 1},
        "model": {"x": 0, "y": 0, "scale": 1},
        "wifi": {"x": 0, "y": 0, "scale": 1},
        "bt": {"x": 0, "y": 0, "scale": 1},
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
    for k in ("showTime", "showDate", "showWeather", "showBubble", "showWifi", "showBt", "city", "weatherUnit", "weatherProvider", "weatherKey", "model", "zoom", "layout", "bubbleScrollSpeed", "bubbleHold", "bubblePlaceholder", "infoSource", "netSources", "bubbleFontSize", "fontColors", "bubbleBgColor", "bgTheme", "fontStyles", "astrbotUrl", "astrbotKey", "astrbotSession"):
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


# ---------- 蓝牙管理（bluetoothctl） ----------
# 后台扫描状态（边扫边显示）：线程内更新，API 实时读取
BT_SCAN = {"scanning": False, "devices": []}


def _bt(cmd, timeout=20):
    """运行 bluetoothctl 命令（--timeout 控制扫描时长），stdout 完整捕获
    注意：外层 subprocess 超时必须 > 命令时长，否则扫描输出在完成前被掐断"""
    return _sh2(f"bluetoothctl {cmd} 2>/dev/null", timeout + 6)


def _sh2(cmd, timeout=30):
    """subprocess 封装：超时参数可独立指定（扫描类命令需 > 内部时长）"""
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    except Exception:
        return None


def _bt_parse_line(line, seen):
    """从 bluetoothctl 输出行解析设备（支持 [NEW]/Device 行），返回是否新增"""
    line = line.strip()
    if "Device " not in line:
        return False
    idx = line.find("Device ")
    parts = line[idx + len("Device "):].split()
    if len(parts) < 1:
        return False
    mac = parts[0]
    if mac in seen:
        return False
    seen[mac] = {"mac": mac, "name": " ".join(parts[1:]) or "(未命名)"}
    return True


def _bt_scan_background():
    """后台扫描线程：Popen 逐行实时解析，设备边扫边收集"""
    _bt("power on")
    seen = {}
    try:
        proc = subprocess.Popen(
            ["bluetoothctl", "--timeout", "28", "scan", "on"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        )
        # 实时读行直到扫描结束（--timeout 28 自动停止）
        for line in proc.stdout:
            _bt_parse_line(line, seen)
    except Exception:
        pass
    finally:
        try:
            proc.kill()
        except Exception:
            pass
        _bt("scan off", timeout=3)
    # 空结果：重置 hci0 重扫一次（aw859a UART 偶发扫描失灵）
    if not seen:
        _sh("sudo hciconfig hci0 reset 2>/dev/null; sleep 2")
        try:
            proc2 = subprocess.Popen(
                ["bluetoothctl", "--timeout", "28", "scan", "on"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
            )
            for line in proc2.stdout:
                _bt_parse_line(line, seen)
        except Exception:
            pass
        finally:
            try:
                proc2.kill()
            except Exception:
                pass
            _bt("scan off", timeout=3)
    # 补充 devices 缓存（含已配对但未广播的设备）
    r2 = _bt("devices")
    if r2:
        for line in r2.stdout.splitlines():
            _bt_parse_line(line, seen)
    BT_SCAN["devices"] = list(seen.values())
    BT_SCAN["scanning"] = False


def bt_scan():
    """启动后台扫描（非阻塞，立即返回；设备实时写入 BT_SCAN）"""
    if BT_SCAN["scanning"]:
        return BT_SCAN["devices"]
    BT_SCAN["scanning"] = True
    BT_SCAN["devices"] = []
    threading.Thread(target=_bt_scan_background, daemon=True).start()
    return BT_SCAN["devices"]


@app.route("/api/bt/scan", methods=["GET"])
def api_bt_scan():
    try:
        devices = bt_scan()
        return jsonify({"scanning": BT_SCAN["scanning"], "devices": devices})
    except Exception as e:
        return jsonify({"error": f"蓝牙扫描失败: {e}", "devices": []})


@app.route("/api/bt/devices", methods=["GET"])
def api_bt_devices():
    """边扫边显示：实时返回当前扫描状态与已发现设备"""
    try:
        return jsonify({"scanning": BT_SCAN["scanning"], "devices": BT_SCAN["devices"]})
    except Exception as e:
        return jsonify({"error": f"获取设备失败: {e}", "devices": []})


@app.route("/api/bt/connect", methods=["POST"])
def api_bt_connect():
    data = request.get_json(silent=True) or {}
    mac = (data.get("mac") or "").strip()
    if not mac:
        return jsonify({"error": "缺少设备 MAC"}), 400
    _bt("power on")
    # 不调 agent on/default-agent（常驻 bt-agent 服务已注册默认 agent，劫持会破坏配对）
    _bt(f"pair {mac}", timeout=30)
    _bt(f"trust {mac}", timeout=10)
    _bt(f"connect {mac}", timeout=30)
    # 校验是否已连接
    info = _bt(f"info {mac}", timeout=10)
    connected = bool(info and "Connected: yes" in info.stdout)
    if connected:
        return jsonify({"ok": True, "msg": f"蓝牙设备 {mac} 已连接"})
    return jsonify({"ok": False, "error": "连接失败（设备可能不可达或需先配对）"})


@app.route("/api/bt/disconnect", methods=["POST"])
def api_bt_disconnect():
    data = request.get_json(silent=True) or {}
    mac = (data.get("mac") or "").strip()
    if mac:
        _bt(f"disconnect {mac}", timeout=10)
    return jsonify({"ok": True, "msg": "蓝牙已断开"})


@app.route("/api/bt/status", methods=["GET"])
def api_bt_status():
    r = _bt("devices")
    connected, paired = [], []
    if r:
        for line in r.stdout.splitlines():
            parts = line.strip().split()
            if len(parts) < 3:
                continue
            mac = parts[1]
            name = " ".join(parts[2:])
            info = _bt(f"info {mac}", timeout=8)
            if info and "Connected: yes" in info.stdout:
                connected.append({"mac": mac, "name": name})
            if info and "Paired: yes" in info.stdout:
                paired.append({"mac": mac, "name": name})
    return jsonify({"connected": connected, "paired": paired})


# ---------- 网络状态总览（WiFi / USB ICS / eth） ----------
@app.route("/api/net/status", methods=["GET"])
def api_net_status():
    def iface_ip(iface):
        r = _sh(f"ip -4 addr show {iface} 2>/dev/null | grep inet")
        return r.stdout.strip().split()[1] if r and r.stdout.strip() else ""
    return jsonify({
        "wifi": {
            "up": bool(_sh("ip link show wlan0 2>/dev/null | grep -q 'state UP'") and _sh("iw dev wlan0 link 2>/dev/null") and "Connected to" in (_sh("iw dev wlan0 link 2>/dev/null").stdout or "")),
            "ssid": (lambda r: (r.stdout.split("SSID:")[1].strip() if r and "SSID:" in r.stdout else ""))(_sh("iw dev wlan0 link 2>/dev/null")),
            "ip": iface_ip("wlan0"),
        },
        "usb": {"up": bool(_sh("ip link show usb0 2>/dev/null | grep -q 'state UP'")), "ip": iface_ip("usb0")},
        "eth": {"up": bool(_sh("ip link show eth0 2>/dev/null | grep -q 'state UP'")), "ip": iface_ip("eth0")},
    })



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
    """清空屏幕消息：清插件队列（代理）+ 本地队列 + 通知页面恢复占位
    用 clear_ts 版本号（幂等）：kiosk/预览 iframe 各自 poll 比对，避免消息竞争丢失"""
    global CLEAR_TS
    import urllib.request
    import time as _t

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
    CLEAR_TS = _t.time()  # 版本号更新：所有消费者下次 poll 都会看到并清屏
    broadcast({"type": "clear"})  # 兼容旧消费者（如无 poll 比对的旧页面）
    return jsonify({"ok": True, "cleared": cleared_remote, "clear_ts": CLEAR_TS})


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


@app.route("/api/geoip")
def api_geoip():
    """IP 定位代理（板子 IPv6 出口；高德 /v3/ip 对 IPv6 返回空，改用 myip.ipip.net 解析省市）"""
    import re as _re
    import urllib.request

    try:
        with urllib.request.urlopen("https://myip.ipip.net", timeout=8) as r:
            text = r.read().decode("utf-8", errors="ignore")
        # 格式：当前 IP：xxx  来自于：中国 贵州 贵阳  电信
        m = _re.search(r"来自于：(.+)", text)
        if not m:
            return jsonify({"ok": False, "error": "无法解析定位结果"})
        parts = [p for p in m.group(1).split() if p]
        # parts 形如 ["中国","贵州","贵阳","电信"]；直辖市如 ["中国","上海","上海市","电信"]
        if len(parts) >= 3 and parts[0] == "中国":
            province, city = parts[1], parts[2]
            # 直辖市省名=市名时（如"上海市"），返回去掉"市"的城市名
            if province in ("北京", "上海", "天津", "重庆"):
                city = province
            elif city.endswith("市"):
                city = city[:-1]
            return jsonify({"ok": True, "province": province, "city": city})
        return jsonify({"ok": False, "error": "定位信息不完整"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/poll")
def api_poll():
    """页面轮询：拉取最近消息并清空（附带 clear_ts 版本号供清屏比对）"""
    with _RECENT_LOCK:
        msgs = list(RECENT_MESSAGES)
        RECENT_MESSAGES.clear()
    return jsonify({"messages": msgs, "clear_ts": CLEAR_TS})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=ADMIN_PORT, debug=False)
