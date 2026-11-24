// 카톡·SNS 링크 미리보기용 대표 이미지(1200×630) 만들기 → web/public/og-image.png
// 사용법: node scripts/make-og-image.mjs
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const logo = (await fs.readFile(path.join(root, 'web/public/icon-512.png'))).toString('base64')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #20203e; font-family: 'Pretendard', 'Malgun Gothic', sans-serif; color: #fff; overflow: hidden; }
  .wrap { position: relative; display: flex; align-items: center; gap: 64px; height: 100%; padding: 0 96px; }
  .ring { position: absolute; border: 3px solid #eb5499; border-radius: 50%; opacity: .14; }
  .r1 { width: 900px; height: 900px; right: -300px; top: -135px; }
  .r2 { width: 620px; height: 620px; right: -160px; top: 5px; }
  .r3 { width: 340px; height: 340px; right: -20px; top: 145px; }
  img { width: 300px; height: 300px; border-radius: 56px; flex: none; position: relative; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
  .text { position: relative; }
  h1 { font-size: 104px; font-weight: 800; letter-spacing: -2px; line-height: 1.05; }
  h1 span { color: #eb5499; }
  p { margin-top: 26px; font-size: 38px; font-weight: 600; line-height: 1.45; color: #d6d7ec; }
  .tags { display: flex; gap: 14px; margin-top: 34px; }
  .tag { padding: 10px 22px; border-radius: 999px; border: 2px solid #eb5499; color: #eb5499; font-size: 28px; font-weight: 700; }
</style></head><body><div class="wrap">
  <div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>
  <img src="data:image/png;base64,${logo}">
  <div class="text">
    <h1>굿즈<span>레이더</span></h1>
    <p>흩어진 굿즈샵의 입고 소식을<br>한곳에서 모아 보세요</p>
    <div class="tags"><span class="tag">입고</span><span class="tag">콜라보·팝업</span><span class="tag">이벤트</span></div>
  </div>
</div></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html, { waitUntil: 'load' })
const out = path.join(root, 'web/public/og-image.png')
await page.screenshot({ path: out })
await browser.close()
console.log('만듦:', out)
