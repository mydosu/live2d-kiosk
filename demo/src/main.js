/**
 * Live2D Kiosk Demo
 * 基于 easy-live2d (Pixi.js v8) —— 官方 Cubism Web SDK 的社区封装
 *
 * 功能：模型切换 / 自动待机动作 / 点击交互 / 表情 / 语音口型同步 / 拖拽 / 鼠标跟随
 * 适配：任意小屏幕（kiosk），模型按画布比例自动缩放居中
 */
import { Application, Ticker } from 'pixi.js'
import { Config, Live2DSprite, LogLevel, Priority } from 'easy-live2d'

/* ---------------- 全局配置 ---------------- */
Config.MotionGroupIdle = 'Idle' // 待机动作组
Config.MouseFollow = true // 视线跟随鼠标
Config.MotionSound = true // 动作附带音效（模型有才生效）
Config.CubismLoggingLevel = LogLevel.LogLevel_Warning
// Config.crossOrigin 默认 'anonymous'；同源静态服务器无需改动，跨域 CDN 部署时保持默认

/* ---------------- 模型清单 ---------------- */
// 由管理后台动态下发（/api/models），初始为空，启动时通过配置接口获取
let MODELS = []
const BASE = import.meta.env.BASE_URL // './' —— dev / build 通用

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id)
const loader = $('loader')
const loaderText = $('loader-text')
const loaderError = $('loader-error')
// 加载遮罩对齐屏幕：Chromium viewport(800x600) 与屏幕(640x480) 为 1:1 映射，
// fixed inset:0 会使内容居中于 viewport(400,300) 而非屏幕中心(320,240) → 改为按屏幕尺寸定位
if (loader) {
  const sw = window.screen.width, sh = window.screen.height
  loader.style.width = sw + 'px'
  loader.style.height = sh + 'px'
  loader.style.left = '0px'
  loader.style.top = '0px'
}
const toastEl = $('toast')
const modelBadge = $('model-badge')
const statusDot = $('status-dot')
const controls = $('controls')
const topbar = $('topbar')
const panel = $('panel')
const timeDisplay = $('time-display')
const dateDisplay = $('date-display')
const weatherDisplay = $('weather-display')
const chatBubble = $('chat-bubble')

/* ---------------- 状态 ---------------- */
let app = null
let sprite = null
let currentIndex = 0
let autoIdle = true
let idleTimer = null
let realModelSize = null // 像素分析得到的模型真实尺寸（画布单位）

// 运行配置（来自管理后台 /api/config）
let CONFIG = {
  model: 'Hiyori',
  showTime: true,
  showWeather: true,
  showBubble: true,
  city: '',
  weatherUnit: 'c',
  zoom: 1.43, // 模型缩放（管理后台可调，适配画布空白大的模型）
  bubbleScrollSpeed: 20, // 气泡循环滚动速度（px/s）
  bubbleHold: 0, // 气泡滞留秒数（0 = 一直显示，直到下一条消息替换）
  bubblePlaceholder: '等待 agent 消息…', // 气泡空消息占位文本
  bubbleFontSize: 14, // 气泡字体大小基准（px，长消息自动缩小）
  fontColors: { time: '#ffffff', date: '#9a9ab0', weather: '#ffffff', bubble: '#e8e8f2' }, // 各模块字体颜色
  showDate: true, // 显示日期/星期
  infoSource: 'wifi', // 时间/天气信息来源：wifi(网络获取) | rndis(用户电脑推送)
  // 模块自由排版：每个模块相对默认位置的像素偏移 + 缩放
  layout: {
    time: { x: 0, y: 0, scale: 1 },
    date: { x: 0, y: 0, scale: 1 },
    weather: { x: 0, y: 0, scale: 1 },
    bubble: { x: 0, y: 0, scale: 1 },
    model: { x: 0, y: 0, scale: 1 },
  },
}

// kiosk 模式：?kiosk=1 时精简显示（仅展示，无需鼠标操作）
const IS_KIOSK = new URLSearchParams(location.search).has('kiosk')

/* ---------------- 左侧面板：时间 / 天气 / 气泡 ---------------- */
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
let externalClock = null // RNDIS 推送的时间/日期（infoSource=rndis 时使用）
let externalWeather = null // RNDIS 推送的天气/位置

function startClock() {
  const tick = () => {
    if (CONFIG.infoSource === 'rndis' && externalClock) {
      timeDisplay.textContent = externalClock.time
      dateDisplay.textContent = externalClock.date
    } else {
      const now = new Date()
      timeDisplay.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      dateDisplay.textContent = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEK[now.getDay()]}`
    }
  }
  tick()
  setInterval(tick, 10000) // 分钟级更新即可
}

let weatherTimer = null
async function updateWeather() {
  if (!CONFIG.showWeather) return
  // RNDIS 模式：使用电脑推送的天气/位置数据
  if (CONFIG.infoSource === 'rndis') {
    weatherDisplay.textContent = externalWeather || '等待电脑推送天气…'
    return
  }
  const city = (CONFIG.city || '').trim()
  const unitFlag = CONFIG.weatherUnit === 'f' ? 'u' : 'm'
  const url = `https://wttr.in/${encodeURIComponent(city || '')}?format=j1&${unitFlag}`
  try {
    const d = await (await fetch(url)).json()
    const cur = d.current_condition?.[0]
    if (!cur) throw new Error('no data')
    const area = d.nearest_area?.[0]?.areaName?.[0]?.value || city || ''
    const temp = CONFIG.weatherUnit === 'f' ? `${cur.temp_F}°F` : `${cur.temp_C}°C`
    const desc = cur.weatherDesc?.[0]?.value || ''
    weatherDisplay.textContent = `${area} · ${temp} · ${desc}`
  } catch {
    weatherDisplay.textContent = '天气不可用'
  }
}
function startWeather() {
  updateWeather()
  clearInterval(weatherTimer)
  weatherTimer = setInterval(updateWeather, 30 * 60 * 1000) // 30 分钟刷新
}

let bubbleTimer = null
let scrollTimer = null

// 气泡循环滚动：滚到底后自动回到第一行继续（kiosk 无鼠标，纯自动）
function stopAutoScroll() {
  if (scrollTimer) {
    cancelAnimationFrame(scrollTimer)
    scrollTimer = null
  }
}
function startAutoScroll() {
  stopAutoScroll()
  const el = chatBubble
  const maxScroll = el.scrollHeight - el.clientHeight
  if (maxScroll <= 0) return // 内容不高，无需滚动
  const speed = Math.max(5, Number(CONFIG.bubbleScrollSpeed) || 20) // px/s
  let last = performance.now()
  const step = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000) // 限制单步时长，避免切后台后跳变
    last = now
    el.scrollTop += speed * dt
    if (el.scrollTop >= maxScroll) el.scrollTop = 0 // 回到第一行继续滚动
    scrollTimer = requestAnimationFrame(step)
  }
  scrollTimer = requestAnimationFrame(step)
}

function showBubble(text) {
  if (!CONFIG.showBubble) return
  chatBubble.textContent = text || ''
  chatBubble.classList.toggle('empty', !text)
  // 字体自适应：按消息长度自动缩小（长消息小字，短消息大字），下限 11px
  const base = Number(CONFIG.bubbleFontSize) || 14
  const len = (text || '').length
  let fs = base
  if (len > 60) fs = Math.max(11, base - Math.floor((len - 60) / 50))
  chatBubble.style.fontSize = fs + 'px'
  // 自动循环滚动（等布局完成再启动）
  requestAnimationFrame(startAutoScroll)
  clearTimeout(bubbleTimer)
  const hold = Number(CONFIG.bubbleHold) || 0
  if (hold > 0) {
    bubbleTimer = setTimeout(() => {
      chatBubble.classList.add('empty')
      chatBubble.textContent = CONFIG.bubblePlaceholder || '等待 agent 消息…'
      chatBubble.style.fontSize = (Number(CONFIG.bubbleFontSize) || 14) + 'px' // 恢复基准字号
      stopAutoScroll()
    }, hold * 1000)
  }
}

/* ---------------- 配置与模型列表（管理后台 API） ---------------- */
async function fetchConfig() {
  try {
    const r = await fetch(`${API_BASE}/api/config`)
    if (r.ok) CONFIG = { ...CONFIG, ...(await r.json()) }
  } catch {
    // 后台不可达时用默认配置（静态 config.json 兜底）
    try {
      const r = await fetch(`${BASE}config.json`)
      if (r.ok) CONFIG = { ...CONFIG, ...(await r.json()) }
    } catch { /* ignore */ }
  }
  applyDisplayConfig()
}

async function fetchModels() {
  try {
    const r = await fetch(`${API_BASE}/api/models`)
    if (r.ok) {
      const d = await r.json()
      if (Array.isArray(d.models) && d.models.length) MODELS = d.models
    }
  } catch {
    // 后台不可达时回退到本地已知模型（config.json 的 models 字段优先）
    try {
      const r = await fetch(`${BASE}config.json`)
      if (r.ok) {
        const d = await r.json()
        if (Array.isArray(d.models) && d.models.length) MODELS = d.models
      }
    } catch { /* ignore */ }
  }
  if (!MODELS.length) MODELS = ['Hiyori', 'Haru', 'Mao', 'Mark', 'Natori', 'Ren', 'Rice', 'Wanko']
}

// 管理后台地址：同主机名，端口 8080
const API_BASE = `${location.protocol}//${location.hostname || 'localhost'}:8080`

function applyDisplayConfig() {
  const t = $('side-panel')
  if (!t) return
  t.querySelector('#time-display').parentElement.style.display = CONFIG.showTime ? '' : 'none'
  // 日期/星期独立显示开关
  const dEl = t.querySelector('#date-display')
  if (dEl) dEl.style.display = CONFIG.showDate ? '' : 'none'
  weatherDisplay.style.display = CONFIG.showWeather ? '' : 'none'
  chatBubble.style.display = CONFIG.showBubble ? '' : 'none'
  // 空气泡时同步自定义占位文本
  if (chatBubble.classList.contains('empty')) {
    chatBubble.textContent = CONFIG.bubblePlaceholder || '等待 agent 消息…'
  }
  if (CONFIG.showTime) startClock()
  if (CONFIG.showWeather) startWeather()
  // 各模块字体颜色
  const fc = CONFIG.fontColors || {}
  if (fc.time) timeDisplay.style.color = fc.time
  if (fc.date && dEl) dEl.style.color = fc.date
  if (fc.weather) weatherDisplay.style.color = fc.weather
  if (fc.bubble) chatBubble.style.color = fc.bubble
  applyLayout()
  // 缩放/布局配置变化时重新适配模型（模型不变则不重载）
  if (sprite) fitSprite(sprite, realModelSize)
}

// 模块自由排版：按 layout 配置设置每个模块的偏移与缩放（transform）
function applyLayout() {
  const L = CONFIG.layout || {}
  const set = (id, k) => {
    const el = document.getElementById(id)
    if (!el) return
    const v = L[k] || { x: 0, y: 0, scale: 1 }
    const sx = Number(v.scale) || 1
    el.style.transform = `translate(${Number(v.x) || 0}px, ${Number(v.y) || 0}px) scale(${sx})`
    if (id === 'chat-bubble') el.style.setProperty('--bubble-scale', sx) // 气泡宽度/高度随缩放反比（不覆盖模型/面板）
  }
  set('time-block', 'time')
  set('date-display', 'date')
  set('weather-display', 'weather')
  set('chat-bubble', 'bubble')
}

/* ---------------- 消息轮询（去 ws：GET /api/poll 拉取控制消息） ---------------- */
function initPoll() {
  const poll = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/poll`)
      const data = await r.json()
      ;(data.messages || []).forEach(handleWSMessage)
    } catch { /* ignore */ }
  }
  poll()
  setInterval(poll, 2000) // 2s 轮询（轻量，不影响渲染帧率）
}

function handleWSMessage(msg) {
  if (!msg || !msg.type) return
  switch (msg.type) {
    case 'init': // 后台推送：模型列表 + 配置
      if (Array.isArray(msg.models) && msg.models.length) MODELS = msg.models
      if (msg.config) {
        CONFIG = { ...CONFIG, ...msg.config }
        applyDisplayConfig()
        reloadIfNeeded()
      }
      break
    case 'config':
      if (msg.config) {
        CONFIG = { ...CONFIG, ...msg.config }
        applyDisplayConfig()
        reloadIfNeeded()
      }
      break
    case 'emotion':
      setEmotionByName(msg.value)
      break
    case 'action':
      playActionByName(msg.value)
      break
    case 'speak':
      showBubble(msg.text)
      break
    case 'clear': // 后台「清空消息」：气泡恢复占位
      chatBubble.classList.add('empty')
      chatBubble.textContent = CONFIG.bubblePlaceholder || '等待 agent 消息…'
      chatBubble.style.fontSize = (Number(CONFIG.bubbleFontSize) || 14) + 'px'
      stopAutoScroll()
      break
    case 'timeinfo': // RNDIS 模式：电脑推送时间/日期/天气/位置
      if (msg.time || msg.date) {
        externalClock = { time: msg.time || '', date: msg.date || '' }
        if (CONFIG.showTime) startClock()
      }
      if (msg.weather || msg.location) {
        externalWeather = msg.weather || msg.location || externalWeather
        if (CONFIG.showWeather) updateWeather()
      }
      break
  }
}

let currentModelName = null // 当前已加载的模型名

function reloadIfNeeded() {
  if (sprite && CONFIG.model && currentModelName !== CONFIG.model) {
    loadModelByName(CONFIG.model)
  }
}

/* ---------------- 表情 / 动作控制（agent 消息入口） ---------------- */
function setEmotionByName(name) {
  if (!sprite || !name) return
  const exprs = sprite.getExpressions()
  const target = name.toLowerCase()
  const hit =
    exprs.find((e) => e.name.toLowerCase() === target) ||
    exprs.find((e) => e.name.toLowerCase().includes(target))
  if (hit) {
    sprite.setExpression({ index: exprs.indexOf(hit) })
    console.log('[agent] emotion:', hit.name)
  } else {
    console.log('[agent] emotion not found:', name, 'available:', exprs.map((e) => e.name))
  }
}

function playActionByName(name) {
  if (!sprite || !name) return
  const motions = sprite.getMotions()
  const target = name.toLowerCase()
  const hit =
    motions.find((m) => `${m.group}_${m.no}`.toLowerCase() === target) ||
    motions.find((m) => m.group.toLowerCase().includes(target)) ||
    motions.find((m) => (m.name || '').toLowerCase().includes(target))
  if (hit) {
    sprite.startMotion({ group: hit.group, no: hit.no, priority: Priority.Normal })
    console.log('[agent] action:', `${hit.group}_${hit.no}`)
  } else {
    console.log('[agent] action not found:', name)
  }
}

/* ---------------- Toast ---------------- */
let toastTimer = null
function toast(msg, isErr = false) {
  toastEl.textContent = msg
  toastEl.classList.toggle('err', isErr)
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200)
}

function setBusy(busy) {
  statusDot.classList.toggle('busy', busy)
}

/* ---------------- Pixi 初始化 ---------------- */
async function initApp() {
  app = new Application()
  try {
    // 超时保护：极端环境下 Pixi 初始化可能挂起，便于诊断而非白屏
    // canvas 尺寸固定为屏幕物理尺寸（window.screen）：
    // 部分 kiosk 环境（无 WM 的 X11）Chromium viewport 会溢出屏幕，
    // 用 screen 尺寸保证模型居中在屏幕可见区域
    const SW = window.screen.width || window.innerWidth
    const SH = window.screen.height || window.innerHeight
    // 左侧面板宽度 = 物理屏幕一半（viewport 可能溢出，% 会错位）
    const panelEl = $('side-panel')
    if (panelEl) panelEl.style.width = Math.round(SW / 2) + 'px'
    await Promise.race([
      app.init({
        canvas: $('live2d'),
        width: SW,
        height: SH,
        backgroundAlpha: 0,
        autoDensity: true,
        // 保持原始渲染分辨率（降分辨率对帧率无提升，反而损失清晰度）
        resolution: Math.max(window.devicePixelRatio || 1, 1),
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Pixi app.init 超时 (15s)')), 15000)),
    ])
  } catch (e) {
    console.error('[initApp failed]', e)
    loaderText.textContent = '初始化失败'
    loaderError.style.display = 'block'
    loaderError.textContent = String(e?.message || e)
    throw e
  }
  // 窗口尺寸变化时重新适配模型（仅在窗口正常 resize 时触发）
  window.addEventListener('resize', () => {
    if (sprite) fitSprite(sprite)
  })
}

/* ---------------- 小屏适配 ---------------- */
// 按模型尺寸缩放，保持纵横比，居中于右半区域
// real: 像素分析得到的真实显示尺寸（部分模型画布周围有空白，真实人物更小）
function fitSprite(s, real) {
  const size = s.getModelCanvasSize()
  if (!size) return
  const screen = app.renderer.screen
  // 模型缩放：优先界面排版的 S 滑条（layout.model.scale），兼容旧 zoom 配置
  const ZOOM = Number(CONFIG.layout?.model?.scale) || CONFIG.zoom || 1.43
  // 屏幕平分为左右两半：模型区 = 右半区域（x: w/2..w），模型居中于区域中央
  const zoneX = screen.width / 2
  const zoneW = screen.width / 2
  const zoneH = screen.height
  // 用真实尺寸计算缩放（若已测量），避免画布空白导致模型偏小
  const rw = real?.realW || size.width
  const rh = real?.realH || size.height
  const scale = Math.min(zoneW / rw, zoneH / rh) * ZOOM
  s.setSize({ width: size.width * scale, height: size.height * scale })
  // 模型偏移（layout.model：管理后台可调，相对右半区域中心的像素偏移）
  const mx = Number(CONFIG.layout?.model?.x) || 0
  const my = Number(CONFIG.layout?.model?.y) || 0
  s.x = zoneX + (zoneW - s.width) / 2 + mx
  s.y = (zoneH - s.height) / 2 + my
}

/* ---------------- 模型加载 ---------------- */
let isLoading = false // 切换锁：防止并发加载

async function loadModelByName(name, { silent = false } = {}) {
  if (isLoading) {
    console.warn('[live2d] 正在加载中，忽略切换请求:', name)
    return
  }
  if (!MODELS.includes(name)) {
    console.error('[live2d] 模型不在列表:', name)
    return
  }
  isLoading = true
  setBusy(true)

  if (!silent) {
    loader.classList.remove('hidden')
    loaderError.style.display = 'none'
    loaderText.textContent = `加载 ${name} …`
  }

  try {
    // 销毁旧模型
    if (sprite) {
      try { sprite.destroy() } catch { /* ignore */ }
      sprite = null
    }
    realModelSize = null

    const modelPath = `${BASE}Resources/${name}/${name}.model3.json`
    sprite = new Live2DSprite({
      modelPath,
      ticker: Ticker.shared,
      draggable: false, // kiosk 纯展示，不需要拖拽
    })
    sprite.eventMode = 'static' // 启用指针事件（命中检测）

    // 注意：必须先加入舞台再 await ready ——
    // ready 由渲染循环（renderFrame）触发，sprite 未入舞台则永远不会 resolve
    app.stage.addChild(sprite)
    // 超时保护：ready 卡住则报错（不进入后续步骤）
    await Promise.race([
      sprite.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('模型 ready 超时 (30s)')), 30000)),
    ])
    // 注：不做像素测量 —— Mali GLES 下 readPixels 同步读 GPU 可能永久阻塞主线程
    // （异步超时保护在阻塞中不触发，导致页面冻结）。自适应改用画布尺寸 + 后台 zoom 配置。
    realModelSize = null
    fitSprite(sprite, null)
    console.log(`[live2d] ${name} 画布=${sprite.width.toFixed(0)}x${sprite.height.toFixed(0)} 真实比例=${realModelSize ? `${realModelSize.ratioW}x${realModelSize.ratioH}` : 'N/A'}`)

    // 命中检测：点中模型身体 → 播放 Tap 动作
    sprite.onLive2D('hit', ({ hitAreaName }) => {
      playTapMotion()
    })

    modelBadge.textContent = name
    currentModelName = name
    if (!IS_KIOSK) {
      buildMotionUI()
      buildExprUI()
    }
    setBusy(false)
    loader.classList.add('hidden')

    // 调试钩子（kiosk 排障用）
    window.__kioskDebug = {
      sprite,
      fit: () => fitSprite(sprite, realModelSize),
      real: () => realModelSize,
      screen: () => ({ w: app.renderer.screen.width, h: app.renderer.screen.height }),
      canvas: () => ({ w: $('live2d').width, h: $('live2d').height }),
    }

    // 内置 FPS 统计（每 10s 输出到 console → chromium 日志，用于无 CDP 时检测真实帧率）
    if (!window.__fpsLoopStarted) {
      window.__fpsLoopStarted = true
      let __fpsFrames = 0
      let __fpsLast = performance.now()
      const __fpsLoop = (now) => {
        __fpsFrames++
        if (now - __fpsLast >= 60000) {  // 60s 报一次（省 SD 卡写入），排障时可临时改回 10s
          const fps = (__fpsFrames * 1000) / (now - __fpsLast)
          console.log(`[FPS] ${fps.toFixed(1)} vis=${document.visibilityState} focus=${document.hasFocus()} inner=${window.innerWidth}x${window.innerHeight}`)
          __fpsFrames = 0
          __fpsLast = now
        }
        requestAnimationFrame(__fpsLoop)
      }
      requestAnimationFrame(__fpsLoop)
    }

    // 自动播放待机动作
    playRandomIdle()
  } catch (err) {
    console.error('[live2d] 模型加载失败:', err)
    // 清理半初始化 sprite（超时/失败时防止残留导致后续异常）
    if (sprite) {
      try { sprite.destroy() } catch { /* ignore */ }
      sprite = null
    }
    currentModelName = null
    loaderText.textContent = '加载失败'
    loaderError.style.display = 'block'
    loaderError.textContent = String(err?.message || err)
    loader.classList.remove('hidden')
    setBusy(false)
  } finally {
    isLoading = false
  }
}

async function loadModel(index, { silent = false } = {}) {
  const name = MODELS[index]
  if (!name) return
  currentIndex = index
  // 同步模型按钮高亮
  document.querySelectorAll('#model-list .act-btn').forEach((b, i) => {
    b.classList.toggle('active', i === index)
  })
  await loadModelByName(name, { silent })
}

function switchModel(index) {
  const n = MODELS.length
  const i = ((index % n) + n) % n
  if (i === currentIndex) return
  loadModel(i)
}

/* ---------------- 动作 ---------------- */
function playRandomIdle(force = false) {
  if (!sprite || !autoIdle) return
  if (idleTimer && !force) return // 已在队列中
  const motions = sprite.getMotions().filter((m) => m.group === Config.MotionGroupIdle)
  if (!motions.length) return
  const pick = motions[Math.floor(Math.random() * motions.length)]
  sprite.startMotion({
    group: pick.group,
    no: pick.no,
    priority: Priority.Idle,
    onFinished: () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (autoIdle && sprite) playRandomIdle()
      }, 500) // 动作间隙
    },
  })
}

function playTapMotion() {
  if (!sprite) return
  const motions = sprite.getMotions()
  const tap =
    motions.find((m) => /tap/i.test(m.group)) ||
    motions.find((m) => m.group !== Config.MotionGroupIdle)
  if (tap) {
    sprite.startMotion({ group: tap.group, no: tap.no, priority: Priority.Normal })
    toast(`动作: ${tap.group}_${tap.no}`)
  }
}

/* ---------------- UI 构建 ---------------- */
function buildModelUI() {
  const box = $('model-list')
  box.innerHTML = ''
  MODELS.forEach((name, i) => {
    const b = document.createElement('button')
    b.className = 'act-btn' + (i === currentIndex ? ' active' : '')
    b.textContent = name
    b.onclick = () => switchModel(i)
    box.appendChild(b)
  })
}

function buildMotionUI() {
  const box = $('motion-list')
  box.innerHTML = ''
  const motions = sprite.getMotions()
  if (!motions.length) {
    box.innerHTML = '<button class="act-btn wide" disabled>此模型无动作</button>'
    return
  }
  // 按动作组分组展示
  const groups = {}
  for (const m of motions) (groups[m.group] ??= []).push(m)
  for (const [group, list] of Object.entries(groups)) {
    const label = document.createElement('div')
    label.className = 'group-label'
    label.style.marginTop = '6px'
    label.style.gridColumn = 'span 2'
    label.textContent = group
    box.appendChild(label)
    for (const m of list) {
      const b = document.createElement('button')
      b.className = 'act-btn'
      b.textContent = `${group}_${m.no}`
      b.title = m.name
      b.onclick = () => {
        sprite.startMotion({ group: m.group, no: m.no, priority: Priority.Normal })
        toast(`动作: ${m.group}_${m.no}`)
      }
      box.appendChild(b)
    }
  }
}

function buildExprUI() {
  const box = $('expr-list')
  box.innerHTML = ''
  const exprs = sprite.getExpressions()
  if (!exprs.length) {
    box.innerHTML = '<button class="act-btn wide" disabled>此模型无表情</button>'
    return
  }
  for (const e of exprs) {
    const b = document.createElement('button')
    b.className = 'act-btn'
    b.textContent = e.name
    b.onclick = () => {
      sprite.setExpression({ index: exprs.indexOf(e) })
      toast(`表情: ${e.name}`)
    }
    box.appendChild(b)
  }
}

function buildVoiceUI(name) {
  const box = $('voice-list')
  box.innerHTML = ''
  const voices = VOICES[name]
  if (!voices) {
    box.innerHTML = '<button class="act-btn wide" disabled>此模型无语音</button>'
    return
  }
  for (const v of voices) {
    const b = document.createElement('button')
    b.className = 'act-btn'
    b.textContent = `🔊 ${v.label}`
    b.onclick = async () => {
      try {
        await sprite.playVoice({ voicePath: v.path })
      } catch (e) {
        toast('语音播放失败: ' + (e?.message || e), true)
      }
    }
    box.appendChild(b)
  }
}

/* ---------------- 控制条 ---------------- */
const btnTalk = $('btn-talk')
btnTalk.onclick = () => {
  const b = document.querySelector('#voice-list .act-btn')
  if (b) b.click()
  else toast('当前模型无语音', true)
}

$('btn-idle').onclick = () => {
  autoIdle = true
  playRandomIdle(true)
}
$('btn-tap').onclick = playTapMotion
$('btn-prev').onclick = () => switchModel(currentIndex - 1)
$('btn-next').onclick = () => switchModel(currentIndex + 1)

/* ---------------- 开关 ---------------- */
$('sw-follow').addEventListener('change', (e) => {
  Config.MouseFollow = e.target.checked
})
$('sw-drag').addEventListener('change', (e) => {
  if (sprite) sprite.draggable = e.target.checked
})
$('sw-auto-idle').addEventListener('change', (e) => {
  autoIdle = e.target.checked
  if (autoIdle && sprite) playRandomIdle(true)
})
$('sw-auto-hide').addEventListener('change', () => {
  if ($('sw-auto-hide').checked) armHide()
  else wakeHUD(true)
})

/* ---------------- 面板 ---------------- */
function togglePanel(force) {
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('open')
  panel.classList.toggle('open', open)
  if (open) wakeHUD(true)
}
$('btn-panel').onclick = () => togglePanel()
$('panel-close').onclick = () => togglePanel(false)

/* ---------------- HUD 自动隐藏（kiosk 模式） ---------------- */
let hideTimer = null
function armHide() {
  if (!$('sw-auto-hide').checked) return
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (panel.classList.contains('open')) return
    controls.classList.add('hide-hud')
    topbar.classList.add('hide-hud')
  }, 3500)
}
function wakeHUD(keep) {
  controls.classList.remove('hide-hud')
  topbar.classList.remove('hide-hud')
  if (!keep) armHide()
}
document.addEventListener('pointermove', () => wakeHUD())
document.addEventListener('pointerdown', () => wakeHUD())

/* ---------------- 全屏 ---------------- */
$('btn-fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch { /* 浏览器策略限制时忽略 */ }
}

/* ---------------- 键盘快捷键 ---------------- */
document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowLeft':
      switchModel(currentIndex - 1)
      break
    case 'ArrowRight':
      switchModel(currentIndex + 1)
      break
    case ' ':
      e.preventDefault()
      autoIdle = true
      playRandomIdle(true)
      break
    case 'f':
    case 'F':
      $('btn-fullscreen').click()
      break
    case 'h':
    case 'H':
      togglePanel()
      break
  }
})

/* ---------------- 启动 ---------------- */
// 注意：不要用顶层 await 启动 —— rollup 打包后 pixi 的动态 import chunk
// 依赖主 bundle，若主 bundle 求值被顶层 await 阻塞会形成模块求值死锁
if (!IS_KIOSK) buildModelUI()
// kiosk 模式初始隐藏 HUD（保持画面纯净）
if (IS_KIOSK) {
  controls.classList.add('hide-hud')
  topbar.classList.add('hide-hud')
}
initPoll() // 轮询管理后台消息（agent 控制）
fetchConfig() // 读取显示开关/城市/模型
  .then(fetchModels)
  .then(() => initApp())
  .then(() => loadModelByName(CONFIG.model))
  .catch((err) => console.error('[bootstrap failed]', err))
