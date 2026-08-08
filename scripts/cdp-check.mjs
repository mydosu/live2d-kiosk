// 通过 ssh 隧道连板子 Chromium CDP，检测 WebGL 渲染器（GPU 加速验证）
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({
  browserURL: 'http://localhost:9222',
  defaultViewport: null,
})

const pages = await browser.pages()
console.log('pages:', pages.length)
for (const p of pages) {
  const url = p.url()
  console.log('page url:', url)
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('live2d')) {
    console.log('checking page:', url)
    const r = await p.evaluate(() => {
      const out = {}
      // 1. 读 Pixi 已使用的 canvas 的现有 context
      try {
        const cv = document.getElementById('live2d')
        out.canvasSize = cv ? cv.width + 'x' + cv.height : 'no canvas'
        const gl = cv.getContext('webgl2') || cv.getContext('webgl')
        if (gl) {
          out.usingExistingContext = true
          out.webgl2 = !!cv.getContext('webgl2')
          out.renderer = gl.getParameter(gl.RENDERER)
          out.vendor = gl.getParameter(gl.VENDOR)
          out.version = gl.getParameter(gl.VERSION)
          const dbg = gl.getExtension('WEBGL_debug_renderer_info')
          if (dbg) {
            out.gpuRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
            out.gpuVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
          }
        } else {
          out.usingExistingContext = false
        }
      } catch (e) {
        out.existingContextError = String(e.message || e)
      }
      // 2. 新 canvas 多参数尝试
      try {
        const c2 = document.createElement('canvas')
        const a = c2.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
        out.newCanvasWebgl2 = a ? 'ok' : 'null'
        if (a) {
          out.newRenderer = a.getParameter(a.RENDERER)
          const dbg = a.getExtension('WEBGL_debug_renderer_info')
          if (dbg) out.newGpuRenderer = a.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        }
      } catch (e) {
        out.newCanvasError = String(e.message || e)
      }
      out.loaderHidden = document.getElementById('loader')?.classList.contains('hidden')
      out.badge = document.getElementById('model-badge')?.textContent
      out.toast = document.getElementById('toast')?.textContent
      return out
    })
    console.log('RESULT:', JSON.stringify(r, null, 2))
  }
}
await browser.disconnect()
