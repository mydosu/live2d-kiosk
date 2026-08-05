// 验证新后台：侧边栏分页 + 数值输入 + 模型缩放迁移 + 保存/重置
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9338
const URL = 'http://192.168.5.32:8080/'

spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test5', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
let jsErrors = 0
page.on('pageerror', () => jsErrors++)
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

// 1. 侧边栏 + 页面切换
const r1 = await page.evaluate(() => ({
  navItems: [...document.querySelectorAll('.nav-item')].map((b) => b.textContent.trim()),
  activePage: document.querySelector('.page.active')?.id,
  hasCollapse: !!document.getElementById('btn-collapse'),
  modelBtns: document.querySelectorAll('.model-btn').length,
}))
console.log('侧边栏:', JSON.stringify(r1))

// 点击"界面排版"导航
await page.evaluate(() => { document.querySelector('.nav-item[data-page="layout"]').click() })
const r2 = await page.evaluate(() => ({
  activePage: document.querySelector('.page.active')?.id,
  layoutVisible: getComputedStyle(document.getElementById('page-layout')).display !== 'none',
  modelS: !!document.getElementById('lay-model-s'),
  displayZoom: !!document.getElementById('rng-zoom'),  // 应为 false（已迁移）
}))
console.log('切页:', JSON.stringify(r2))

// 2. 数值输入联动（布局 X 输入 100 → 滑条同步 + draft）
await page.evaluate(() => {
  const num = document.getElementById('lay-time-xn')
  num.value = 100; num.dispatchEvent(new Event('change'))
})
const r3 = await page.evaluate(() => ({
  slider: document.getElementById('lay-time-x').value,
  dirty: document.querySelector('.btn-save[data-card="layout"]').textContent.includes('⚠️'),
}))
console.log('数值输入联动:', JSON.stringify(r3))

// 3. 保存排版 → config 生效
await page.click('.btn-save[data-card="layout"]')
await new Promise((r) => setTimeout(r, 800))
const cfg = await page.evaluate(() => fetch(location.origin + '/api/config').then((r) => r.json()))
console.log('保存后 layout.time.x =', cfg.layout?.time?.x)

// 4. 伸缩侧边栏
await page.evaluate(() => { document.getElementById('btn-collapse').click() })
const r4 = await page.evaluate(() => ({
  collapsed: document.getElementById('app').classList.contains('collapsed'),
  btnText: document.getElementById('btn-collapse').textContent,
}))
console.log('伸缩:', JSON.stringify(r4))

// 5. 重置恢复
await page.evaluate(() => { window.confirm = () => true; document.getElementById('btn-reset').click() })
await new Promise((r) => setTimeout(r, 1200))
const cfg2 = await page.evaluate(() => fetch(location.origin + '/api/config').then((r) => r.json()))
console.log('重置后 layout.time.x =', cfg2.layout?.time?.x, '| JS错误 =', jsErrors)

await page.screenshot({ path: 'D:/CODE/Live2D/admin-nav.png' })
await browser.disconnect()
edge.kill()
console.log('DONE')
