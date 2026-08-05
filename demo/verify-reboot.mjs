// 验证重启按钮存在 + confirm 拦截（不触发真实重启）
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9342
const URL = 'http://192.168.5.32:8080/'

spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test9', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
let jsErrors = 0
page.on('pageerror', () => jsErrors++)
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

// 切到智能助手页
await page.evaluate(() => document.querySelector('.nav-item[data-page="agent"]').click())
const r = await page.evaluate(() => ({
  hasReboot: !!document.getElementById('btn-reboot'),
  rebootText: document.getElementById('btn-reboot')?.textContent.trim(),
  btnCount: document.querySelectorAll('.bottom-btns .btn').length,
}))
console.log('重启按钮:', JSON.stringify(r))

// confirm 拦截 + 点击（confirm=false 不应触发请求）
let called = false
page.on('request', (req) => { if (req.url().includes('/api/reboot')) called = true })
await page.evaluate(() => { window.confirm = () => false; document.getElementById('btn-reboot').click() })
await new Promise((r) => setTimeout(r, 500))
console.log('confirm=false 时未触发请求:', !called, '| JS错误 =', jsErrors)

await browser.disconnect()
edge.kill()
console.log('DONE')
