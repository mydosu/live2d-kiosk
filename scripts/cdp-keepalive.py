#!/usr/bin/env python3
"""
CDP keep-alive v4（完整复刻 puppeteer 的 evaluate 路径）：
Browser attach → Runtime.enable → 等 ExecutionContext.created →
Runtime.callFunctionOn（executionContextId + async IIFE + awaitPromise + userGesture）
fire-and-forget（挂起调用永不返回，不等待响应）。
puppeteer 的 evaluate 挂起实测让帧率 3.8 → 12fps（合成器退避被禁用）。
"""
import asyncio
import json
import urllib.request

import websockets

RETRY_DELAY = 5


def get_browser_ws_url():
    with urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=5) as resp:
        return json.load(resp)["webSocketDebuggerUrl"]


def get_page_target():
    with urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5) as resp:
        for t in json.load(resp):
            if t.get("type") == "page":
                return t["id"]
    return None


async def hold():
    while True:
        try:
            url = get_browser_ws_url()
            target_id = get_page_target()
            if not url or not target_id:
                await asyncio.sleep(RETRY_DELAY)
                continue
            async with websockets.connect(url, max_size=None) as ws:
                msg_id = 0

                async def send(method, params, sid=None):
                    nonlocal msg_id
                    msg_id += 1
                    m = {"id": msg_id, "method": method, "params": params}
                    if sid:
                        m["sessionId"] = sid
                    await ws.send(json.dumps(m))
                    return msg_id

                async def send_and_wait(method, params, sid=None):
                    mid = await send(method, params, sid)
                    while True:
                        msg = json.loads(await ws.recv())
                        if msg.get("id") == mid:
                            if "error" in msg:
                                raise RuntimeError(f"{method}: {msg['error']}")
                            return msg.get("result", {})

                # attach 页面 target（flatten）
                result = await send_and_wait(
                    "Target.attachToTarget", {"targetId": target_id, "flatten": True}
                )
                sid = result["sessionId"]

                # 启用 Runtime，等待页面主执行上下文（isDefault）
                await send_and_wait("Runtime.enable", {}, sid)
                ctx_id = None
                while ctx_id is None:
                    msg = json.loads(await ws.recv())
                    if msg.get("method") == "Runtime.executionContextCreated":
                        aux = msg["params"]["context"].get("auxData", {})
                        if aux.get("isDefault"):
                            ctx_id = msg["params"]["context"]["id"]

                # fire-and-forget 挂起 callFunctionOn（async IIFE + rAF 循环 + 永不 resolve）
                await send(
                    "Runtime.callFunctionOn",
                    {
                        "executionContextId": ctx_id,
                        "functionDeclaration": (
                            "async function() {"
                            "  await new Promise((resolve) => {"
                            "    const loop = () => { requestAnimationFrame(loop); };"
                            "    requestAnimationFrame(loop);"
                            "    window.__kaResolve = resolve;"
                            "  });"
                            "}"
                        ),
                        "awaitPromise": True,
                        "returnByValue": False,
                        "userGesture": True,
                    },
                    sid,
                )
                print(f"[keepalive] holding ctx={ctx_id} target={target_id}", flush=True)
                while True:
                    await asyncio.sleep(3600)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - 重连循环
            print(f"[keepalive] error: {e!r} retry in {RETRY_DELAY}s", flush=True)
            await asyncio.sleep(RETRY_DELAY)


if __name__ == "__main__":
    asyncio.run(hold())
