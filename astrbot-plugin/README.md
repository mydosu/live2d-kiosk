# live2d-kiosk —— astrbot 插件

把 astrbot 接到你的 **Live2D 伪全息小屏幕终端**（Orange Pi + Chromium kiosk + easy-live2d，分光棱镜投影）。

收到消息时，模型会在屏幕上做表情、做动作、显示对话气泡。

## 安装

1. 把本目录（`live2d-kiosk/`）放到 astrbot 的插件目录：

```bash
cd <astrbot安装目录>/data/plugins
git clone https://github.com/mydosu/live2d-kiosk.git
# 或者直接把 live2d-kiosk 目录拷进来
```

2. 在 astrbot WebUI 中启用插件（插件管理 → live2d-kiosk → 启用）

3. 确认插件配置里的板子地址：

| 连接方式 | board_url |
|---|---|
| USB 线连电脑（RNDIS） | `http://192.168.30.1:8080`（默认） |
| 同一 WiFi / 局域网 | `http://192.168.5.32:8080` |

## 使用

```
/屏幕 表情 F01      切换到 Haru 表情 1（F01~F08；Mao 用 exp_01~exp_08）
/屏幕 表情 happy    也可以用情感词（happy/angry/sad/...）
/屏幕 动作 tapbody_0  触发动作（tapbody_0、tap、idle）
/屏幕 说 你好呀     屏幕气泡显示文字
/屏幕 状态          查询屏幕当前模型/信息源
/屏幕 帮助          帮助
```

**自动行为**（可在插件配置关闭）：
- 收到任何消息 → 显示到屏幕气泡（`speak_user_msg`，默认开）
- 消息里检测到情感关键词 → 自动切表情（`auto_emotion`，默认开）

## 对接协议

- 消息格式（emotion / action / speak / timeinfo）详见仓库 `docs/Agent接口文档.md` 或 Obsidian「Agent接口文档」
- 屏幕端要求：模型推荐用 **Haru**（8 个表情 F01~F08）或 **Mao**（exp_01~exp_08）；Hiyori 无表情只有动作
- 板子后台地址 `http://<板子IP>:8080`，消息转发接口 `POST /api/send`

## 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| board_url | `http://192.168.30.1:8080` | 板子管理后台地址 |
| auto_emotion | `true` | 自动按情感关键词切表情 |
| speak_user_msg | `true` | 收到消息转发到屏幕气泡 |
