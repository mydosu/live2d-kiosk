// 验证美化效果 + 功能
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9339
const URL = 'http://192.168.5.32:8080/'

spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test6', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
let jsErrors = 0
page.on('pageerror', () => jsErrors++)
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

// 样式检查
const style = await page.evaluate(() => {
  const body = getComputedStyle(document.body)
  const card = getComputedStyle(document.querySelector('.card'))
  const sidebar = getComputedStyle(document.getElementById('sidebar'))
  return {
    bodyBg: body.backgroundImage.slice(0, 60),
    cardBg: card.backgroundColor, cardBlur: card.backdropFilter || card.webkitBackdropFilter,
    sidebarBlur: sidebar.backdropFilter || sidebar.webkitBackdropFilter,
    mainWidth: document.querySelector('main').clientWidth,
  }
})
console.log('样式:', JSON.stringify(style, null, 1))

// 功能回归
await page.evaluate(() => { document.querySelector('.nav-item[data-page="layout"]').click() })
const r2 = await page.evaluate(() => ({
  layoutRows: document.querySelectorAll('.layout-row').length,
  axesLabels: [...document.querySelectorAll('.layout-row:first-child .axes label')].map(l => l.textContent),
  activePage: document.querySelector('.page.active')?.id,
}))
console.log('排版结构:', JSON.stringify(r2))

// 数值输入联动
await page.evaluate(() => { const n = document.getElementById('lay-time-xn'); n.value = 80; n.dispatchEvent(new Event('change')) })
const r3 = await page.evaluate(() => ({ slider: document.getElementById('lay-time-x').value, dirty: document.querySelector('.btn-save[data-card="layout"]').textContent.includes('⚠️') }))
await page.click('.btn-save[data-card="layout"]')
await new Promise((r) => setTimeout(r, 800))
const cfg = await page.evaluate(() => fetch(location.origin + '/api/config').then(r => r.json()))
console.log('联动:', JSON.stringify(r3), '| 保存后 x =', cfg.layout?.time?.x)

// 恢复
await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-reset').click() })
await new Promise((r) => setTimeout(r, 1000))
console.log('JS错误 =', jsErrors)

await page.screenshot({ path: 'D:/CODE/Live2D/admin-beauty.png' })
await browser.disconnect()
edge.kill()
console.log('DONE')
