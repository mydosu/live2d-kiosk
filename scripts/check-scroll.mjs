import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const page = (await browser.pages())[0]

// 采样 4 秒内的 scrollTop（验证循环滚动）
const r = await page.evaluate(async () => {
  const el = document.getElementById('chat-bubble')
  const samples = []
  const t0 = performance.now()
  while (performance.now() - t0 < 4000) {
    samples.push(Math.round(el.scrollTop))
    await new Promise((r) => setTimeout(r, 300))
  }
  const maxScroll = el.scrollHeight - el.clientHeight
  const scrollbar = getComputedStyle(el).scrollbarWidth
  return { samples, maxScroll, scrollbarWidth: scrollbar, textLen: el.textContent.length }
})
console.log(JSON.stringify(r))
await browser.disconnect()
