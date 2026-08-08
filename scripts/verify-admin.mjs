// 本机 Edge headless 验证管理后台（JS 修复后按钮是否可用）
import puppeteer from 'puppeteer-core'
import { spawn } from 'child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9334
const URL = 'http://192.168.5.32:8080/'

// 清理残留 Edge
spawn('taskkill', ['/F', '/IM', 'msedge.exe'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))

const edge = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/edge-admin-test',
  '--no-first-run',
  'about:blank',
], { stdio: 'ignore' })

await new Promise((r) => setTimeout(r, 3500))
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
const page = (await browser.pages())[0]
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 20000 })

const r = await page.evaluate(async () => {
  const out = {}
  out.title = document.title
  out.modelBtns = document.querySelectorAll('.model-btn').length
  out.models = [...document.querySelectorAll('.model-btn')].map((b) => b.textContent).slice(0, 4)
  out.activeModel = document.querySelector('.model-btn.active')?.textContent
  out.swTime = document.getElementById('sw-time')?.checked
  out.zoom = document.getElementById('rng-zoom')?.value
  // 点击"发送测试消息"按钮（验证 JS 绑定生效）
  const btnTest = document.getElementById('btn-test')
  out.btnTestExists = !!btnTest
  if (btnTest) {
    btnTest.click()
    out.clicked = true
  }
  return out
})
console.log(JSON.stringify(r, null, 2))

// 等 toast 出现（点击成功 → JS 活着）
await new Promise((r) => setTimeout(r, 2000))
const toast = await page.evaluate(() => document.getElementById('toast')?.textContent || '')
console.log('toast after click:', toast)

// 截图
await page.screenshot({ path: 'D:/CODE/Live2D/admin-check.png' })
await browser.disconnect()
edge.kill()
console.log('DONE')
