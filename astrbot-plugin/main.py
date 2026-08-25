"""
Live2D Kiosk 插件 —— 把 astrbot 接到 Live2D 伪全息小屏幕终端

功能：
  1. /屏幕 表情 <name>      —— 控制模型表情（如 F01、exp_05、happy）
  2. /屏幕 动作 <name>      —— 控制模型动作（如 tapbody_0、tap、idle）
  3. /屏幕 说 <text>        —— 在屏幕气泡显示一段话
  4. /屏幕 状态             —— 查询屏幕当前配置（模型/信息源等）
  5. /屏幕 帮助             —— 显示本帮助
  6. 自动情感 → 表情         —— 收到普通消息时按情感关键词映射表情（可开关）
  7. 用户消息 → 气泡         —— 可选：把用户说的每句话显示到屏幕气泡

对接协议见：Obsidian「Agent接口文档」/ 仓库 docs/Agent接口文档.md
板子地址：USB 连接 192.168.30.1:8080；局域网 192.168.5.32:8080
"""
from astrbot.api.all import *
import httpx

# 情感关键词 → 表情代号（Haru 的 F 系列，与接口文档一致）
# happy→F01、思考→F04、难过→F05、惊讶→F06、害羞→F07、不满→F08
EMOTION_KEYWORDS = {
    "F01": ["开心", "高兴", "哈哈", "哈哈哈", "嘿嘿", "嘻嘻", "太好了", "万岁", "happy", "joy"],
    "F03": ["生气", "愤怒", "气死", "可恶", "讨厌", "怒", "angry", "mad"],
    "F04": ["思考", "想想", "嗯", "唔", "琢磨", "hmm", "think"],
    "F05": ["难过", "伤心", "哭", "呜呜", "泪", "sad", "cry"],
    "F06": ["惊讶", "震惊", "吓", "哇", "不会吧", "surprised", "wow"],
    "F07": ["害羞", "脸红", "不好意思", "害羞", "shy", "blush"],
    "F08": ["不满", "撇嘴", "哼", "切", "无聊", "哼", "pout"],
}

# 动作名 → 动作代号（组名或 组_编号，页面模糊匹配）
ACTION_ALIASES = {
    "拍": "tapbody", "点": "tapbody", "挥手": "wave", "招": "wave",
    "待机": "idle", "站": "idle",
}


@register("live2d-kiosk", "mydosu", "控制 Live2D 桌面终端：表情/动作/对话气泡", "1.0.0")
class Live2DKioskPlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.board = (config.get("board_url") or "http://192.168.30.1:8080").rstrip("/")
        self.auto_emotion = config.get("auto_emotion", True)
        self.speak_user_msg = config.get("speak_user_msg", True)

    # ---------- 板子通信 ----------
    async def _send(self, payload: dict) -> tuple[bool, str]:
        """POST /api/send 到板子后台，返回 (成功?, 错误信息)"""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.post(f"{self.board}/api/send", json=payload)
                if r.status_code == 200:
                    return True, ""
                return False, f"HTTP {r.status_code}"
        except Exception as e:
            return False, str(e)

    async def _get_config(self) -> dict | None:
        """查询板子当前配置"""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{self.board}/api/config")
                return r.json() if r.status_code == 200 else None
        except Exception:
            return None

    # ---------- 指令处理 ----------
    @event.register(EventMessageType.ALL_MESSAGE)
    async def on_message(self, event: AstrMessageEvent):
        msg = (event.message_str or "").strip()
        if not msg:
            return

        # 屏幕指令：/屏幕 xxx
        if msg.startswith(("/屏幕", "/screen", "/kiosk")):
            yield event.result(await self._handle_cmd(msg))
            return

        # 普通消息：可选转发到气泡 + 自动情感表情
        if self.speak_user_msg:
            await self._send({"type": "speak", "text": f"你：{msg[:80]}"})
        if self.auto_emotion:
            emo = self._detect_emotion(msg)
            if emo:
                await self._send({"type": "emotion", "value": emo})

    async def _handle_cmd(self, msg: str) -> str:
        parts = msg.split(maxsplit=1)
        if len(parts) == 1:
            return self._help()
        _, rest = parts
        sub = rest.split(maxsplit=1)
        action = sub[0]
        arg = sub[1].strip() if len(sub) > 1 else ""

        if action in ("表情", "emotion"):
            if not arg:
                return "用法：/屏幕 表情 <代号>（如 F01、exp_05、happy）\nHaru 模型：F01~F08；Mao：exp_01~exp_08"
            ok, err = await self._send({"type": "emotion", "value": arg})
            return "表情已切换 ✅" if ok else f"发送失败：{err}"

        if action in ("动作", "action"):
            if not arg:
                return "用法：/屏幕 动作 <代号>（如 tapbody_0、tap、idle）"
            v = ACTION_ALIASES.get(arg, arg)
            ok, err = await self._send({"type": "action", "value": v})
            return "动作已触发 ✅" if ok else f"发送失败：{err}"

        if action in ("说", "speak", "say"):
            if not arg:
                return "用法：/屏幕 说 <内容>"
            ok, err = await self._send({"type": "speak", "text": arg[:200]})
            return "已显示到屏幕 ✅" if ok else f"发送失败：{err}"

        if action in ("状态", "status"):
            cfg = await self._get_config()
            if not cfg:
                return "无法连接板子（检查 board_url 配置）"
            src = "WiFi" if cfg.get("infoSource", "wifi") == "wifi" else "RNDIS 电脑推送"
            return (
                f"📺 屏幕状态\n"
                f"模型：{cfg.get('model', '?')}\n"
                f"信息源：{src}\n"
                f"时间/日期：{'开' if cfg.get('showTime') else '关'}/{'开' if cfg.get('showDate') else '关'}\n"
                f"天气：{'开' if cfg.get('showWeather') else '关'} · 气泡：{'开' if cfg.get('showBubble') else '关'}"
            )

        if action in ("帮助", "help"):
            return self._help()

        return "未知指令，/屏幕 帮助 查看用法"

    @staticmethod
    def _help() -> str:
        return (
            "📺 Live2D 屏幕控制\n"
            "/屏幕 表情 <代号>  切换表情（F01、exp_05、happy）\n"
            "/屏幕 动作 <代号>  触发动作（tapbody_0、tap、idle）\n"
            "/屏幕 说 <内容>    气泡显示文字\n"
            "/屏幕 状态         查询屏幕状态\n"
            "/屏幕 帮助         本帮助\n"
            "自动：收到消息按情感显示表情（可在插件配置关闭）"
        )

    # ---------- 情感检测 ----------
    @staticmethod
    def _detect_emotion(text: str) -> str | None:
        """按关键词检测情感，返回表情代号（大小写不敏感）"""
        low = text.lower()
        for emo, words in EMOTION_KEYWORDS.items():
            for w in words:
                if w.lower() in low:
                    return emo
        return None
