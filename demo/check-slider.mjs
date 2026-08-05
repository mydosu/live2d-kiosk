// 验证滑条颜色（浅色轨道 + 粉色滑块）
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9337
const URL = 'http://192.168.5.32:8080/'

spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test4', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

const r = await page.evaluate(() => {
  const lay = document.getElementById('lay-time-x')
  const zoom = document.getElementById('rng-zoom')
  const cs1 = getComputedStyle(lay)
  const cs2 = getComputedStyle(zoom)
  // 伪元素轨道色（WebKit）
  const track = getComputedStyle(lay, '::-webkit-slider-runnable-track')
  const thumb = getComputedStyle(lay, '::-webkit-slider-thumb')
  return {
    layoutSlider: { appearance: cs1.appearance, bg: cs1.backgroundColor, height: cs1.height },
    zoomSlider: { appearance: cs2.appearance, bg: cs2.backgroundColor },
    trackColor: track.backgroundColor,
    thumbBg: thumb.backgroundColor,
    thumbSize: thumb.width + 'x' + thumb.height,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  }
})
console.log(JSON.stringify(r, null, 2))

await page.screenshot({ path: 'D:/CODE/Live2D/admin-pink2.png' })
await browser.disconnect()
edge.kill()
console.log('DONE')
