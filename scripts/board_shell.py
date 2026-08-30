#!/usr/bin/env python3
"""板子壳：轮询 AstrBot 插件消息队列 → 控制屏幕

- 配置读取：/opt/dashboard/live2D panel/config.json 的 astrbotUrl / astrbotKey
  （管理后台「智能助手」页填写）
- 轮询 AstrBot open API：GET {astrbotUrl}/api/v1/plugins/extensions/live2d-kiosk/pending
  （AstrBot 自动鉴权 plugin scope API Key；拉取后队列清空）
- 消息 → 调用板子后台 :8080/api/send → 屏幕表情/动作/气泡
- 通信方向：板子 → AstrBot（主动出站），板子无需公网/端口开放
"""
import json
import time
import urllib.error
import urllib.request

CONFIG_PATH = "/opt/dashboard/live2D panel/config.json"
SEND_URL = "http://localhost:8080/api/send"
PENDING_PATH = "/api/v1/plugins/extensions/live2d-kiosk/pending"
POLL_INTERVAL = 3  # 秒


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def http_get_json(url, key, timeout=8):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def post_send(payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        SEND_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status == 200


def poll_once():
    """单轮：拉取队列并按配置会话过滤后分发到屏幕。返回处理消息数（未配置返回 -1）。"""
    cfg = load_config()
    base = (cfg.get("astrbotUrl") or "").rstrip("/")
    key = cfg.get("astrbotKey") or ""
    if not base or not key:
        print("[shell] 未配置 AstrBot 地址/Key，等待后台填写…", flush=True)
        return -1
    target = (cfg.get("astrbotSession") or "").strip()  # 只显示该会话（空 = 全部）
    resp = http_get_json(f"{base}{PENDING_PATH}", key, timeout=8)
    count = 0
    for m in resp.get("messages", []):
        origin = m.get("origin") or ""
        if target and origin and origin != target:
            continue  # 非选中会话的消息跳过
        t = m.get("type")
        if t == "emotion":
            post_send({"type": "emotion", "value": m.get("value", "F01")})
            count += 1
        elif t == "action":
            post_send({"type": "action", "value": m.get("value", "")})
            count += 1
        elif t == "speak":
            post_send({"type": "speak", "text": (m.get("text") or "")[:200]})
            count += 1
    print(f"[shell] 拉取 {len(resp.get('messages', []))} 条（显示 {count} 条）", flush=True)
    return count


def main():
    while True:
        try:
            poll_once()
        except Exception as e:
            print(f"[shell] {str(e)[:120]}", flush=True)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
