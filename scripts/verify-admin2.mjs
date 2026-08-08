// 本机 Edge headless 验证管理后台（保存按钮模式 + 重置 + wsPort）
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9335
const URL = 'http://192.168.5.32:8080/'

spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test2', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERROR:', m.text()) })

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

// 1. 基础 UI 检查
const r1 = await page.evaluate(() => ({
  saveBtns: [...document.querySelectorAll('.btn-save')].map((b) => b.textContent.trim()),
  hasReset: !!document.getElementById('btn-reset'),
  wsPort: document.getElementById('inp-wsport')?.value,
  wsAddr: document.getElementById('ws-addr')?.textContent,
  modelBtns: document.querySelectorAll('.model-btn').length,
}))
console.log('UI:', JSON.stringify(r1))

// 2. 保存按钮逻辑：改开关 → 不保存 → config 不变；点保存 → config 变
await page.evaluate(() => { document.getElementById('sw-time').checked = false; document.getElementById('sw-time').dispatchEvent(new Event('change')) })
let cfgAfterChange = await page.evaluate(() => fetch(location.origin + '/api/config').then((r) => r.json()))
console.log('config after toggle (should still true):', cfgAfterChange.showTime)
const dirtyText = await page.evaluate(() => document.querySelector('.btn-save[data-card="display"]').textContent)
console.log('dirty mark:', dirtyText.includes('⚠️'))
await page.click('.btn-save[data-card="display"]')
await new Promise((r) => setTimeout(r, 800))
cfgAfterChange = await page.evaluate(() => fetch(location.origin + '/api/config').then((r) => r.json()))
console.log('config after save (should false):', cfgAfterChange.showTime)

// 3. 重置按钮（恢复默认）
await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-reset').click() })
await new Promise((r) => setTimeout(r, 1200))
const cfgAfterReset = await page.evaluate(() => fetch(location.origin + '/api/config').then((r) => r.json()))
console.log('config after reset (should true):', cfgAfterReset.showTime, '| zoom:', cfgAfterReset.zoom)

await page.screenshot({ path: 'D:/CODE/Live2D/admin-check2.png' })
await browser.disconnect()
edge.kill()
console.log('DONE')
