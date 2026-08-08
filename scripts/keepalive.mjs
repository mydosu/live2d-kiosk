// CDP keep-alive（板子本地，puppeteer-core）：
// 保持挂起的 page.evaluate（async Promise 永不 resolve + rAF 循环保引用）。
// DevTools 挂起调用期间 Chromium 禁用合成器帧退避 → 帧率 3.8 → ~12fps。
import puppeteer from 'puppeteer-core'

const RETRY_MS = 5000

async function hold() {
  while (true) {
    try {
      const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })
      const page = (await browser.pages())[0]
      // 挂起 evaluate：永不 resolve（rAF 循环保持 Promise 引用避免被 GC）
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const loop = () => {
              requestAnimationFrame(loop)
            }
            requestAnimationFrame(loop)
            window.__kaResolve = resolve
          }),
      )
      // 上面永不返回；保持连接
      await new Promise(() => {})
    } catch (err) {
      console.log('[keepalive]', err.message, 'retry in', RETRY_MS, 'ms')
      await new Promise((r) => setTimeout(r, RETRY_MS))
    }
  }
}

hold()
