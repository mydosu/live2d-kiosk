// 帧时间分布测量（找出卡顿模式）+ 模型信息
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const page = (await browser.pages())[0]

async function measure(label) {
  const r = await page.evaluate(async () => {
    await new Promise((res) => setTimeout(res, 2000))
    return await new Promise((resolve) => {
      const intervals = []
      let last = performance.now()
      let frames = 0
      const D = 5000
      function tick(now) {
        frames++
        intervals.push(now - last)
        last = now
        if (now - start < D) requestAnimationFrame(tick)
        else {
          intervals.sort((a, b) => a - b)
          const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
          resolve({
            badge: document.getElementById('model-badge')?.textContent,
            fps: (1000 / avg).toFixed(1),
            frameMs: { min: intervals[0].toFixed(0), p50: intervals[Math.floor(intervals.length / 2)].toFixed(0), p95: intervals[Math.floor(intervals.length * 0.95)].toFixed(0), max: intervals[intervals.length - 1].toFixed(0) },
            gpu: window.__kioskDebug ? 'hook-ok' : 'no-hook',
          })
        }
      }
      const start = performance.now()
      last = start
      requestAnimationFrame(tick)
    })
  })
  console.log(label, JSON.stringify(r))
}

await measure('current:')
await browser.disconnect()
