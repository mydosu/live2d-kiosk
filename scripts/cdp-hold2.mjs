// puppeteer 连接 + evaluate 挂起 Promise（无 rAF 循环），验证连接方式 vs rAF 循环
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const page = (await browser.pages())[0]
console.log('evaluating pending promise...')
const evalPromise = page.evaluate(() => new Promise(() => {})) // 永不 resolve
await new Promise((r) => setTimeout(r, 35000))
console.log('done')
await browser.disconnect()
