/**
 * Live2D Kiosk Demo
 * 基于 easy-live2d (Pixi.js v8) —— 官方 Cubism Web SDK 的社区封装
 *
 * 功能：模型切换 / 自动待机动作 / 点击交互 / 表情 / 语音口型同步 / 拖拽 / 鼠标跟随
 * 适配：任意小屏幕（kiosk），模型按画布比例自动缩放居中
 */
import { Application, Ticker } from 'pixi.js'
import { Config, Live2DSprite, LogLevel, Priority } from 'easy-live2d'
// 艺术字字体（构建时打包进 dist，板子本地加载无网络依赖）
import '@fontsource/comfortaa/400.css'
import '@fontsource/comfortaa/700.css'
import '@fontsource/orbitron/500.css'
import '@fontsource/playfair-display/600.css'
import '@fontsource/quicksand/500.css'
import '@fontsource/nunito/600.css'
import '@fontsource/baloo-2/600.css'
import '@fontsource/fredoka/500.css'

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
  weatherProvider: 'amap', // 天气源：amap(高德，默认，需weatherKey) | wttr(海外备选)
  weatherKey: '', // 高德天气 API Key（可选；配了则 wttr 失败自动降级高德）
  zoom: 1.43, // 模型缩放（管理后台可调，适配画布空白大的模型）
  bubbleScrollSpeed: 20, // 气泡循环滚动速度（px/s）
  bubbleHold: 0, // 气泡滞留秒数（0 = 一直显示，直到下一条消息替换）
  bubblePlaceholder: '等待 agent 消息…', // 气泡空消息占位文本
  bubbleFontSize: 14, // 气泡字体大小基准（px，长消息自动缩小）
  fontColors: { time: '#ffffff', date: '#9a9ab0', weather: '#ffffff', bubble: '#e8e8f2' }, // 各模块字体颜色
  bubbleBgColor: '#7c5cff', // 气泡背景色（半透明磨砂渐变基色）
  bgTheme: 'aurora', // 屏幕背景主题：aurora(极光) | pink(粉嫩) | dark(深色) | mint(薄荷) | sunset(日落)
  fontStyles: { time: 'default', date: 'default', weather: 'default', bubble: 'default' }, // 各模块字体风格（每模块独立选择）
  showDate: true, // 显示日期/星期
  infoSource: 'wifi', // 联网方式：wifi(无线) | usb(USB 共享网络/电脑 ICS)——都是联网后网络自动获取时间/天气/位置
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
// 预览模式：?preview=1 时嵌入后台排版页 iframe——跳过 Live2D 初始化（板子 2GB 跑不动双实例），
// 模块显示可拖拽/缩放控制框，布局变化实时 postMessage 给父窗口（后台滑条同步）
const IS_PREVIEW = new URLSearchParams(location.search).has('preview')

/* ---------------- 左侧面板：时间 / 天气 / 气泡 ---------------- */
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
// 时间/天气统一走网络自动获取（WiFi 或 USB 共享网络皆可），不再依赖电脑推送

function startClock() {
  const tick = () => {
    const now = new Date()
    timeDisplay.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    dateDisplay.textContent = `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEK[now.getDay()]}`
  }
  tick()
  setInterval(tick, 10000) // 分钟级更新即可
}

let weatherTimer = null
// 天气源：amap(高德，默认，国内稳定) | wttr(wttr.in，海外备选)
const W_PROVIDER = () => CONFIG.weatherProvider || 'amap'
// 带超时的 fetch（6s 内失败，避免网络不通时长时间空白等待）
async function fetchTimeout(url, ms = 6000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await (await fetch(url, { signal: ctrl.signal })).json()
  } finally {
    clearTimeout(t)
  }
}
async function fetchAmapWeather() {
  // 高德天气：需 weatherKey；填了城市名直查，留空自动 IP 定位（走本地 /api/geoip 代理，兼容 IPv6 出口）
  const key = CONFIG.weatherKey
  if (!key) throw new Error('no amap key')
  let city = (CONFIG.city || '').trim()
  let cur = null
  let area = ''
  if (city) {
    // 用户指定城市：直查（城市名/adcode 都支持）
    const d = await fetchTimeout(`https://restapi.amap.com/v3/weather/weatherInfo?key=${encodeURIComponent(key)}&city=${encodeURIComponent(city)}&extensions=base`)
    cur = d.lives?.[0]
    if (cur) area = cur.city || city
  } else {
    // 城市留空 → 自动定位：请求板子本地代理（服务端用 myip.ipip.net 解析省市，兼容 IPv6 出口）
    try {
      const geo = await (await fetch(`${API_BASE}/api/geoip`)).json()
      city = geo.city || ''
      if (city) {
        const d = await fetchTimeout(`https://restapi.amap.com/v3/weather/weatherInfo?key=${encodeURIComponent(key)}&city=${encodeURIComponent(city)}&extensions=base`)
        cur = d.lives?.[0]
        if (cur) area = cur.city || city
      }
    } catch { /* 定位失败则走下方 IP 定位兜底 */ }
  }
  if (!cur) {
    // 兜底：直接调高德 IP 定位（仅 IPv4 出口有效）
    try {
      const ip = await fetchTimeout(`https://restapi.amap.com/v3/ip?key=${encodeURIComponent(key)}`)
      const adcode = ip.adcode
      if (adcode) {
        const d = await fetchTimeout(`https://restapi.amap.com/v3/weather/weatherInfo?key=${encodeURIComponent(key)}&city=${encodeURIComponent(adcode)}&extensions=base`)
        cur = d.lives?.[0]
        if (cur) area = cur.city || area
      }
    } catch { /* 忽略 */ }
  }
  if (!cur) throw new Error('amap no data')
  return {
    area,
    temp: CONFIG.weatherUnit === 'f' ? `${Math.round(cur.temperature * 9 / 5 + 32)}°F` : `${cur.temperature}°C`,
    desc: cur.weather || '',
  }
}
async function fetchWttrWeather() {
  const city = (CONFIG.city || '').trim()
  const unitFlag = CONFIG.weatherUnit === 'f' ? 'u' : 'm'
  const url = `https://wttr.in/${encodeURIComponent(city || '')}?format=j1&${unitFlag}`
  const w = await fetchTimeout(url, 8000)
  const cur = w.current_condition?.[0]
  if (!cur) throw new Error('wttr no data')
  return {
    area: w.nearest_area?.[0]?.areaName?.[0]?.value || city || '',
    temp: CONFIG.weatherUnit === 'f' ? `${cur.temp_F}°F` : `${cur.temp_C}°C`,
    desc: cur.weatherDesc?.[0]?.value || '',
  }
}
async function updateWeather() {
  if (!CONFIG.showWeather) return
  // 联网模式统一网络获取（USB 共享 / WiFi 都走这里），不再有电脑推送
  const provider = W_PROVIDER()
  const fetchers = provider === 'wttr' ? [fetchWttrWeather, fetchAmapWeather] : [fetchAmapWeather, fetchWttrWeather]
  for (const fn of fetchers) {
    try {
      const { area, temp, desc } = await fn()
      if (temp) { weatherDisplay.textContent = `${area} · ${temp} · ${desc}`; return }
    } catch { /* 换下一个源 */ }
  }
  weatherDisplay.textContent = '天气不可用'
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
  applyBg()
  applyBubbleBg()
  applyFont()
  // 缩放/布局配置变化时重新适配模型（模型不变则不重载）
  if (sprite) fitSprite(sprite, realModelSize)
}

// 屏幕背景主题（渐变预设；管理后台「显示设置」切换）
const BG_THEMES = {
  aurora: 'radial-gradient(ellipse at 20% 85%, rgba(124,92,255,.28), transparent 55%), radial-gradient(ellipse at 82% 12%, rgba(255,92,138,.20), transparent 50%), linear-gradient(160deg,#14142a 0%,#101018 55%,#0a0a14 100%)',
  pink: 'linear-gradient(160deg,#ffd9e5 0%,#ffeef4 55%,#fde8ff 100%)',
  dark: 'linear-gradient(160deg,#14142a 0%,#0a0a14 100%)',
  mint: 'linear-gradient(160deg,#cdeee4 0%,#e9fff7 55%,#d6eaff 100%)',
  sunset: 'linear-gradient(160deg,#ffb98a 0%,#ffd2c2 55%,#ffe3d6 100%)',
  ocean: 'linear-gradient(160deg,#0e2a47 0%,#14557d 50%,#1a7a9e 100%)',
  nebula: 'radial-gradient(ellipse at 25% 30%, rgba(140,90,255,.35), transparent 55%), radial-gradient(ellipse at 80% 70%, rgba(255,90,160,.25), transparent 50%), linear-gradient(160deg,#1a1033 0%,#12082a 60%,#0c0620 100%)',
  peach: 'linear-gradient(160deg,#ffc9a3 0%,#ffb59e 45%,#ff9eb5 100%)',
  lavender: 'linear-gradient(160deg,#e6d9ff 0%,#f0e6ff 55%,#d9ccff 100%)',
  candy: 'linear-gradient(160deg,#ffd6e8 0%,#d6ecff 55%,#e8f6ff 100%)',
}
function applyBg() {
  const el = document.getElementById('bg')
  if (!el) return
  const img = CONFIG.bgImage
  if (img) {
    // 自定义背景图优先：cover 铺满 + 居中
    el.style.background = `url(${API_BASE}/bg/${img}) center/cover no-repeat`
  } else {
    el.style.background = BG_THEMES[CONFIG.bgTheme] || BG_THEMES.aurora
  }
}

// 字体风格：艺术字映射（每个风格配对应中文字体——中文不再回落到黑体）
// 圆润系 → 站酷快乐体（圆润）；优雅系 → 站酷小薇体（宋体优雅）；科技/默认 → 系统黑体
const FONT_STYLES = {
  default: `'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, sans-serif`,
  round: `'Comfortaa', 'ZCOOL KuaiLe', 'Noto Sans CJK SC', system-ui, sans-serif`,
  quicksand: `'Quicksand', 'ZCOOL KuaiLe', 'Noto Sans CJK SC', system-ui, sans-serif`,
  nunito: `'Nunito', 'ZCOOL KuaiLe', 'Noto Sans CJK SC', system-ui, sans-serif`,
  baloo: `'Baloo 2', 'ZCOOL KuaiLe', 'Noto Sans CJK SC', system-ui, sans-serif`,
  fredoka: `'Fredoka', 'ZCOOL KuaiLe', 'Noto Sans CJK SC', system-ui, sans-serif`,
  orbitron: `'Orbitron', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, sans-serif`,
  serif: `'Playfair Display', 'ZCOOL XiaoWei', 'Noto Sans CJK SC', Georgia, serif`,
  cnround: `'ZCOOL KuaiLe', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, sans-serif`, // 中文圆体（全中文）
}
let fontApplySeq = 0 // 防竞态：快速切换字体时只应用最新一次
async function applyFont() {
  const seq = ++fontApplySeq
  const fs = CONFIG.fontStyles || {}
  // 预加载所需字体（等就绪再切换——保持旧字体直到新字体 ready，避免闪现/空白）
  const needed = new Set()
  Object.values(fs).forEach(k => {
    const fam = (FONT_STYLES[k] || FONT_STYLES.default).split(',')[0].replace(/['"]/g, '').trim()
    if (fam && fam !== 'Noto Sans CJK SC') needed.add(fam)
  })
  if (needed.size) {
    try {
      await Promise.all([...needed].map(f => document.fonts.load(`16px "${f}"`)))
    } catch (e) { /* 字体加载失败则用 fallback */ }
  }
  if (seq !== fontApplySeq) return // 已有更新的切换请求，丢弃本次
  const pick = (k) => FONT_STYLES[fs[k]] || FONT_STYLES.default
  document.body.style.fontFamily = pick('time')
  if (timeDisplay) timeDisplay.style.fontFamily = pick('time')
  if (dateDisplay) dateDisplay.style.fontFamily = pick('date')
  if (weatherDisplay) weatherDisplay.style.fontFamily = pick('weather')
  if (chatBubble) chatBubble.style.fontFamily = pick('bubble')
}

// 气泡背景：用户色 → 半透明磨砂渐变（与主体背景不冲突）
function hexToRgba(hex, a) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
function applyBubbleBg() {
  const c = CONFIG.bubbleBgColor || '#7c5cff'
  chatBubble.style.background = `linear-gradient(135deg, ${hexToRgba(c, 0.88)} 0%, ${hexToRgba(c, 0.55)} 60%, ${hexToRgba(c, 0.35)} 100%)`
  chatBubble.style.backdropFilter = 'blur(8px)'
  chatBubble.style.webkitBackdropFilter = 'blur(8px)'
  chatBubble.style.borderColor = hexToRgba(c, 0.45)
}

// 模块自由排版：按 layout 配置设置每个模块的偏移与缩放（transform）
function applyLayout() {
  const L = CONFIG.layout || {}
  const set = (id, k) => {
    const el = document.getElementById(id)
    if (!el) return
    const v = L[k] || { x: 0, y: 0, scale: 1 }
    const sx = Number(v.scale) || 1
    const target = el.querySelector?.('.pv-wrap') || el // 预览模式：transform 套在包裹层上
    target.style.transform = `translate(${Number(v.x) || 0}px, ${Number(v.y) || 0}px) scale(${sx})`
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

/* ---------------- 启动 ---------------- */
// 注意：不要用顶层 await 启动 —— rollup 打包后 pixi 的动态 import chunk
// 依赖主 bundle，若主 bundle 求值被顶层 await 阻塞会形成模块求值死锁
initPoll() // 轮询管理后台消息（agent 控制）
if (IS_PREVIEW) {
  // 预览模式：跳过 Live2D（双实例会 OOM），显示模型占位框 + 启用拖拽/缩放控制
  fetchConfig()
    .then(fetchModels)
    .then(() => { initPreview(); })
    .catch((err) => console.error('[preview bootstrap failed]', err))
} else {
  fetchConfig() // 读取显示开关/城市/模型
    .then(fetchModels)
    .then(() => initApp())
    .then(() => loadModelByName(CONFIG.model))
    .catch((err) => console.error('[bootstrap failed]', err))
}

/* ================= 预览模式：拖拽 / 缩放 / 与后台同步（?preview=1） ================= */
// 每个模块包一层 .pv-wrap（放 transform + 标签 + 缩放手柄），避免覆盖模块自身样式
/* 预览模式：可拖拽/缩放模块（模型无占位框，位置大小由后台滑条调节） */
const PV_MODULES = [
  { id: 'time-block', key: 'time', name: '时间' },
  { id: 'date-display', key: 'date', name: '日期' },
  { id: 'weather-display', key: 'weather', name: '天气' },
  { id: 'chat-bubble', key: 'bubble', name: '气泡' },
]

function pvEmit() {
  // 把当前全部 layout 通知父窗口（后台滑条/草稿同步）
  try { window.parent?.postMessage({ type: 'preview-layout', layout: CONFIG.layout }, '*') } catch { /* ignore */ }
}

function pvApply(key) {
  applyLayout() // 文字模块（含包裹层 transform）
}

function initPreview() {
  document.body.classList.add('preview-mode')
  // 隐藏加载遮罩，只留屏幕内容
  if (loader) loader.classList.add('hidden')
  // 时间/日期/天气/气泡真实显示，方便预览效果
  if (CONFIG.showTime) startClock()
  if (CONFIG.showWeather) startWeather()
  if (chatBubble.classList.contains('empty')) {
    chatBubble.textContent = CONFIG.bubblePlaceholder || '等待 agent 消息…'
  }
  // 为每个模块包裹 .pv-wrap + 标签；虚线框即缩放手柄（拖边框=缩放，拖内部=移动）
  const EDGE = 10 // 边缘阈值 px：按下点距 wrap 边缘 ≤ 此值 → 缩放模式
  for (const m of PV_MODULES) {
    const el = $(m.id)
    if (!el) continue
    if (el.querySelector('.pv-wrap')) continue
    const wrap = document.createElement('div')
    wrap.className = 'pv-wrap'
    el.parentNode.insertBefore(wrap, el)
    wrap.appendChild(el)
    // 名称标签
    const label = document.createElement('div')
    label.className = 'pv-label'
    label.textContent = m.name
    wrap.appendChild(label)

    // 统一指针交互：边缘→缩放，内部→移动
    let gesture = null // { mode:'move'|'resize', px,py, ox,oy, s0, c0 }
    wrap.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      wrap.setPointerCapture(e.pointerId)
      const v = CONFIG.layout?.[m.key] || { x: 0, y: 0, scale: 1 }
      const rect = wrap.getBoundingClientRect()
      // 边缘检测（含 outline-offset 的视觉边框区域）
      const nearEdge =
        e.clientX - rect.left <= EDGE || rect.right - e.clientX <= EDGE ||
        e.clientY - rect.top <= EDGE || rect.bottom - e.clientY <= EDGE
      if (nearEdge) {
        // 缩放模式：以 wrap 中心为基准，拖拽距离比例 → scale
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        gesture = {
          mode: 'resize',
          px: e.clientX, py: e.clientY,
          s0: Number(v.scale) || 1,
          c0: Math.max(30, Math.hypot(e.clientX - cx, e.clientY - cy)), // 按下点到中心距离
        }
        wrap.classList.add('pv-resizing')
      } else {
        // 移动模式
        gesture = {
          mode: 'move',
          px: e.clientX, py: e.clientY,
          ox: Number(v.x) || 0, oy: Number(v.y) || 0,
        }
      }
      const move = (ev) => {
        if (!gesture) return
        if (gesture.mode === 'move') {
          CONFIG.layout[m.key] = {
            ...(CONFIG.layout[m.key] || {}),
            x: Math.round((gesture.ox + (ev.clientX - gesture.px)) / 5) * 5,
            y: Math.round((gesture.oy + (ev.clientY - gesture.py)) / 5) * 5,
          }
        } else {
          // 缩放：拖得离中心越远 scale 越大（从 0.3 到 3，步进 0.05）
          const rect = wrap.getBoundingClientRect()
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          const dist = Math.max(30, Math.hypot(ev.clientX - cx, ev.clientY - cy))
          let ns = Math.round((gesture.s0 * (dist / gesture.c0)) * 20) / 20
          ns = Math.min(3, Math.max(0.3, ns))
          CONFIG.layout[m.key] = { ...(CONFIG.layout[m.key] || {}), scale: ns }
        }
        pvApply(m.key)
        pvEmit()
      }
      const up = () => {
        gesture = null
        wrap.classList.remove('pv-resizing')
        wrap.removeEventListener('pointermove', move)
        wrap.removeEventListener('pointerup', up)
      }
      wrap.addEventListener('pointermove', move)
      wrap.addEventListener('pointerup', up)
    })
  }

  // 接收父窗口（后台）的布局同步消息：滑条改动实时反映到预览
  window.addEventListener('message', (e) => {
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'preview-sync' && d.layout) {
      CONFIG.layout = { ...(CONFIG.layout || {}), ...d.layout }
      applyLayout()
    }
  })

  // 通知父窗口：预览已就绪（可回发当前布局）
  pvEmit()
  // 预览模式下也继续轮询（后台保存后自动刷新）——initPoll 已在启动时调用
}
