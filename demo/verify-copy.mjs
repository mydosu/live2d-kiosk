// 验证新文案 + 功能无回归
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9341
const URL = 'http://192.168.5.32:8080/'

spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test8', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
let jsErrors = 0
page.on('pageerror', () => jsErrors++)
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

const r = await page.evaluate(() => ({
  title: document.querySelector('h1').textContent,
  nav: [...document.querySelectorAll('.nav-item')].map((b) => b.textContent.trim()),
  saveBtnText: document.querySelector('.btn-save[data-card="display"]')?.textContent.trim(),
  agentPage: document.querySelector('#page-agent h2')?.textContent,
  resetBtn: document.getElementById('btn-reset')?.textContent.trim(),
  powerBtn: document.getElementById('btn-poweroff')?.textContent.trim(),
  modelBtns: document.querySelectorAll('.model-btn').length,
}))
console.log(JSON.stringify(r, null, 1))

// 功能回归：保存按钮（先切到显示设置页）
await page.evaluate(() => { document.querySelector('.nav-item[data-page="display"]').click() })
await page.evaluate(() => { const s = document.getElementById('sw-date'); s.checked = false; s.dispatchEvent(new Event('change')) })
await page.evaluate(() => document.querySelector('.btn-save[data-card="display"]').click())
await new Promise((r) => setTimeout(r, 800))
const cfg = await page.evaluate(() => fetch(location.origin + '/api/config').then((r) => r.json()))
await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-reset').click() })
await new Promise((r) => setTimeout(r, 1200))
console.log('保存/恢复功能:', 'showDate after save =', cfg.showDate, '| JS错误 =', jsErrors)

await browser.disconnect()
edge.kill()
console.log('DONE')
