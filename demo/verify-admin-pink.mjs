// 验证白色+粉色风格 + 功能（保存/重置/模型按钮）
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9336
const URL = 'http://192.168.5.32:8080/'

spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test3', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
let jsErrors = 0
page.on('pageerror', () => jsErrors++)
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

// 样式检查
const style = await page.evaluate(() => {
  const cs = getComputedStyle(document.body)
  const card = getComputedStyle(document.querySelector('.card'))
  const btn = getComputedStyle(document.querySelector('.btn-primary'))
  return {
    bodyBg: cs.backgroundColor, bodyColor: cs.color,
    cardBg: card.backgroundColor, cardBorder: card.borderColor,
    btnBg: btn.backgroundColor,
    h1Color: getComputedStyle(document.querySelector('h1')).color,
    modelBtnBg: getComputedStyle(document.querySelector('.model-btn')).backgroundColor,
  }
})
console.log('样式:', JSON.stringify(style))

// 功能检查（同 verify-admin2：toggle→dirty→save→reset）
const r1 = await page.evaluate(() => ({
  saveBtns: document.querySelectorAll('.btn-save').length,
  modelBtns: document.querySelectorAll('.model-btn').length,
  wsPort: document.getElementById('inp-wsport')?.value,
}))
console.log('UI:', JSON.stringify(r1))

await page.evaluate(() => { document.getElementById('sw-time').checked = false; document.getElementById('sw-time').dispatchEvent(new Event('change')) })
const dirty = await page.evaluate(() => document.querySelector('.btn-save[data-card="display"]').textContent.includes('⚠️'))
await page.click('.btn-save[data-card="display"]')
await new Promise((r) => setTimeout(r, 800))
const cfg = await page.evaluate(() => fetch(location.origin + '/api/config').then((r) => r.json()))
await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-reset').click() })
await new Promise((r) => setTimeout(r, 1200))
const cfg2 = await page.evaluate(() => fetch(location.origin + '/api/config').then((r) => r.json()))
console.log('功能: dirty标记=', dirty, '| 保存后 showTime=', cfg.showTime, '| 重置后 showTime=', cfg2.showTime, '| JS错误=', jsErrors)

await page.screenshot({ path: 'D:/CODE/Live2D/admin-pink.png' })
await browser.disconnect()
edge.kill()
console.log('DONE')
