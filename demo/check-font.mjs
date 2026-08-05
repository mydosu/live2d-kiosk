import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const page = (await browser.pages())[0]
const r = await page.evaluate(() => {
  const el = document.getElementById('chat-bubble')
  const scripts = [...document.querySelectorAll('script')].map((s) => s.src).filter((s) => s && s.includes('assets'))
  return {
    bundle: scripts[0] ? scripts[0].slice(-25) : 'none',
    fontSize: getComputedStyle(el).fontSize,
    color: getComputedStyle(el).color,
    len: el.textContent.length,
    time: getComputedStyle(document.getElementById('time-display')).color,
    weather: getComputedStyle(document.getElementById('weather-display')).color,
  }
})
console.log(JSON.stringify(r, null, 2))
await browser.disconnect()
