import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' })
const page = (await browser.pages())[0]
const session = await page.target().createCDPSession()
const info = await session.send('SystemInfo.getInfo')
const gpu = info.gpu
console.log('GPU devices:', JSON.stringify(gpu.devices, null, 1))
console.log('GPU featureStatus:', JSON.stringify(gpu.featureStatus, null, 1))
await browser.disconnect()
