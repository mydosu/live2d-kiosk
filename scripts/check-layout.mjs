import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const page = (await browser.pages())[0]
const r = await page.evaluate(() => {
  const g = (id) => {
    const el = document.getElementById(id)
    return el ? getComputedStyle(el).transform : null
  }
  const d = window.__kioskDebug
  let sp = null
  try {
    const s = d?.sprite
    if (s) sp = { x: s.x.toFixed(0), y: s.y.toFixed(0) }
  } catch (e) { sp = 'ERR' }
  return { time: g('time-block'), weather: g('weather-display'), bubble: g('chat-bubble'), sprite: sp }
})
console.log(JSON.stringify(r, null, 2))
await browser.disconnect()
