// 手动启动 Edge(headless) + CDP 端口，再用 puppeteer.connect 驱动
// 绕开 puppeteer.launch 与 Edge 的参数兼容问题
import { spawn, execSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const PROFILE = 'D:\\CODE\\Liv2D\\demo\\.edge-verify-profile'
const URL = process.env.URL || 'http://localhost:5173/'
const SHOT = process.env.SHOT || 'D:\\CODE\\Liv2D\\demo\\verify-shot2.png'

// 清理占用该 profile 的残留 Edge 进程（避免新实例异常）
try {
  execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${PROFILE}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
    { stdio: 'ignore', timeout: 20000 },
  )
} catch { /* ignore */ }
try { execSync(`powershell -NoProfile -Command "Remove-Item '${PROFILE}' -Recurse -Force -ErrorAction SilentlyContinue"`, { stdio: 'ignore', timeout: 20000 }) } catch { /* ignore */ }

// 启动 Edge
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--window-size=1024,768',
  'about:blank',
], { stdio: 'ignore' })

// 等待 CDP 就绪
async function waitForCDP() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/version`)
      if (r.ok) return
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('CDP not ready')
}

let browser = null
try {
  await waitForCDP()
  browser = await puppeteer.connect({ browserURL: `http://localhost:${PORT}`, defaultViewport: { width: 1024, height: 768 } })

  const page = await browser.newPage()
  page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text().slice(0, 300)))
  page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 500), '\n', (e.stack || '').split('\n').slice(0, 8).join('\n')))
  page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText))
  page.on('response', (r) => {
    if (r.status() >= 400) console.log('[http', r.status() + ']', r.url())
  })
  await page.evaluateOnNewDocument(() => {
    window.__errors = []
    window.addEventListener('error', (e) => window.__errors.push('error: ' + e.message))
    window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + (e.reason?.message || e.reason)))
  })

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

  let done = false
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const st = await page.evaluate(() => ({
      hidden: document.getElementById('loader').classList.contains('hidden'),
      err: document.getElementById('loader-error').textContent,
      badge: document.getElementById('model-badge').textContent,
      toast: document.getElementById('toast').textContent,
      dotBusy: document.getElementById('status-dot').classList.contains('busy'),
    }))
    if (st.hidden) {
      console.log('MODEL READY after', i + 1, 's | badge =', st.badge, '| toast =', st.toast)
      done = true
      break
    }
    if (st.err) {
      console.log('LOAD ERROR:', st.err)
      done = true
      break
    }
    if (i % 5 === 4) console.log(`waiting... ${i + 1}s | badge=${st.badge} toast=${st.toast} busy=${st.dotBusy}`)
  }
  if (!done) {
    console.log('TIMEOUT: model did not become ready in 25s')
    const st2 = await page.evaluate(() => ({
      err: document.getElementById('loader-error').textContent,
      loaderText: document.getElementById('loader-text').textContent,
      errDisplay: document.getElementById('loader-error').style.display,
      core: window.Live2DCubismCore ? 'present' : 'MISSING',
      errors: window.__errors,
      canvasW: document.getElementById('live2d').width,
      canvasH: document.getElementById('live2d').height,
      modelBtns: document.querySelectorAll('#model-list .act-btn').length,
      coreType: window.Live2DCubismCore ? typeof window.Live2DCubismCore.Moc?.fromArrayBuffer : 'n/a',
    }))
    console.log('STATE:', JSON.stringify(st2))
  }

  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: SHOT })
  console.log('screenshot saved:', SHOT)
} catch (e) {
  console.log('[fatal]', e.message)
} finally {
  try { await browser?.disconnect() } catch { /* ignore */ }
  edge.kill()
}
