// 用 CDP SystemInfo 拿 GPU 硬件信息 + 页面 WebGL 检测
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const pages = await browser.pages()
const page = pages[0]
const cdp = await page.createCDPSession()

// 1. 浏览器 GPU 信息（容错：可能不支持）
try {
  const ws = browser.wsEndpoint()
  const ws2 = new WebSocket(ws)
  await new Promise((res, rej) => { ws2.onopen = res; ws2.onerror = rej })
  const id = 1
  const result = new Promise((res) => { ws2.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === id) res(m.result) } })
  ws2.send(JSON.stringify({ id, method: 'SystemInfo.getInfo' }))
  const info = await result
  console.log('=== GPU devices ===')
  for (const d of (info.gpu?.devices || [])) {
    console.log(JSON.stringify({ vendorId: d.vendorId, deviceId: d.deviceId, driverVendor: d.driverVendor, active: d.active }))
  }
  console.log('auxAttributes:', JSON.stringify(info.gpu?.auxAttributes || {}))
  ws2.close()
} catch (e) {
  console.log('SystemInfo unavailable:', e.message)
}

// 2. 页面 WebGL 状态（带 failIfMajorPerformanceCaveat=false 与属性打印）
const r = await page.evaluate(() => {
  const out = {}
  const c = document.createElement('canvas')
  c.width = 16; c.height = 16
  const gl = c.getContext('webgl', { failIfMajorPerformanceCaveat: false })
  out.webgl1 = gl ? 'ok' : 'null'
  const gl2 = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
  out.webgl2 = gl2 ? 'ok' : 'null'
  const any = gl || gl2
  if (any) {
    out.renderer = any.getParameter(any.RENDERER)
    out.vendor = any.getParameter(any.VENDOR)
    const dbg = any.getExtension('WEBGL_debug_renderer_info')
    if (dbg) {
      out.unmaskedRenderer = any.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      out.unmaskedVendor = any.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
    }
  }
  return out
})
console.log('=== page webgl ===')
console.log(JSON.stringify(r, null, 2))
await browser.disconnect()
