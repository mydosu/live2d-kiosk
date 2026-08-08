// DevTools 连接 keep-alive 测试：只连接不操作，验证连接本身是否提升帧率
import puppeteer from 'puppeteer-core'

console.log('connecting...')
const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
console.log('connected, holding for 40s...')
await new Promise((r) => setTimeout(r, 40000))
await browser.disconnect()
console.log('done')
