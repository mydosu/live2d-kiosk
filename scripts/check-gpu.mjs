import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const page = (await browser.pages())[0]
const r = await page.evaluate(() => {
  const c = document.getElementById('live2d')
  const gl = c?.getContext('webgl2') || c?.getContext('webgl')
  if (!gl) return { error: 'no gl' }
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    webgl2: !!c.getContext('webgl2'),
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  }
})
console.log(JSON.stringify(r, null, 2))
await browser.disconnect()
