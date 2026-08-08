import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const page = (await browser.pages())[0]
const r = await page.evaluate(() => {
  const el = document.getElementById('chat-bubble')
  const cs = getComputedStyle(el)
  const panel = document.getElementById('side-panel')
  const pr = panel.getBoundingClientRect()
  const er = el.getBoundingClientRect()
  return {
    bubble: { w: er.width, x: er.x, right: er.right, maxWidth: cs.maxWidth, width: cs.width, wordBreak: cs.wordBreak, transform: cs.transform },
    panel: { w: pr.width, x: pr.x, padding: getComputedStyle(panel).padding },
    parent: el.parentElement.id,
  }
})
console.log(JSON.stringify(r, null, 2))
await browser.disconnect()
