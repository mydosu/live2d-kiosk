// 视口与 canvas 尺寸诊断
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const pages = await browser.pages()
const page = pages[0]
const r = await page.evaluate(() => {
  const cv = document.getElementById('live2d')
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    screenW: window.screen.width,
    screenH: window.screen.height,
    dpr: window.devicePixelRatio,
    canvasW: cv?.width,
    canvasH: cv?.height,
    canvasStyleW: cv ? getComputedStyle(cv).width : null,
    canvasStyleH: cv ? getComputedStyle(cv).height : null,
    docW: document.documentElement.clientWidth,
    docH: document.documentElement.clientHeight,
  }
})
console.log(JSON.stringify(r, null, 2))
await browser.disconnect()
