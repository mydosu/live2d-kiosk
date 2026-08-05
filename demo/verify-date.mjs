// 验证日期模块控制（后台 UI + 页面效果）
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9340
const URL = 'http://192.168.5.32:8080/'

spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test7', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
let jsErrors = 0
page.on('pageerror', () => jsErrors++)
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

// 1. 后台 UI 检查
const r1 = await page.evaluate(() => ({
  hasDateSwitch: !!document.getElementById('sw-date'),
  hasDateLayout: !!document.getElementById('lay-date-x'),
  hasDateColor: !!document.getElementById('col-date'),
  layoutRows: document.querySelectorAll('.layout-row').length,
  swDateChecked: document.getElementById('sw-date').checked,
}))
console.log('后台UI:', JSON.stringify(r1))

// 2. 页面效果：日期偏移 + 颜色 + 隐藏
// POST layout(date x=40 y=-20) + 颜色 + showDate
await page.evaluate(() => fetch(location.origin + '/api/config', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    layout: { time: { x: 0, y: 0, scale: 1 }, date: { x: 40, y: -20, scale: 1.2 }, weather: { x: 0, y: 0, scale: 1 }, bubble: { x: 0, y: 0, scale: 1 }, model: { x: 0, y: 0, scale: 1 } },
    fontColors: { time: '#ffffff', date: '#ff8800', weather: '#ffffff', bubble: '#e8e8f2' },
    showDate: true,
  }),
}))
await new Promise((r) => setTimeout(r, 2500))

// CDP 查 kiosk 页面
const browser2 = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const kpage = (await browser2.pages())[0]
const r2 = await kpage.evaluate(() => {
  const d = document.getElementById('date-display')
  return {
    transform: getComputedStyle(d).transform,
    color: getComputedStyle(d).color,
    visible: getComputedStyle(d).display !== 'none',
    text: d.textContent,
  }
})
console.log('页面(date x40 y-20 s1.2):', JSON.stringify(r2))
await browser2.disconnect()

// 3. 隐藏日期测试
await page.evaluate(() => fetch(location.origin + '/api/config', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ showDate: false }),
}))
await new Promise((r) => setTimeout(r, 2000))
const browser3 = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const kpage2 = (await browser3.pages())[0]
const r3 = await kpage2.evaluate(() => ({ dateVisible: getComputedStyle(document.getElementById('date-display')).display !== 'none' }))
console.log('隐藏日期后:', JSON.stringify(r3))
await browser3.disconnect()

// 恢复
await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-reset').click() })
await new Promise((r) => setTimeout(r, 1200))
console.log('JS错误 =', jsErrors)
await browser.disconnect()
edge.kill()
console.log('DONE')
