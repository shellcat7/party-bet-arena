/**
 * Builds public/og-image.jpg (the link preview image) from the app icon and two README
 * screenshots, so it always matches the current product.
 *
 *   node scripts/capture-screenshots.mjs   # first, if the UI changed
 *   node scripts/generate-og-image.mjs
 */
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const icon = await readFile("public/favicon.svg", "utf8");
const shot = async (name) =>
  `data:image/png;base64,${(await readFile(`docs/screenshots/${name}.png`)).toString("base64")}`;
const [left, right] = await Promise.all([shot("race-live"), shot("host-home")]);

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #f4f5f7; color: #15171b;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif; }
  .copy { position: absolute; left: 80px; top: 150px; width: 470px; }
  .copy svg { width: 96px; height: 96px; display: block; }
  h1 { margin-top: 28px; font-size: 64px; font-weight: 700; letter-spacing: 0.02em; }
  p { margin-top: 18px; color: #444b56; font-size: 27px; line-height: 1.5; }
  .url { margin-top: 26px; color: #5f6672; font-size: 21px; }
  .phone { position: absolute; top: 56px; width: 300px; border-radius: 34px; overflow: hidden;
    border: 1px solid #d9dce1; background: #fff; }
  .phone img { display: block; width: 100%; }
  .a { left: 610px; } .b { left: 940px; top: 96px; }
</style></head><body>
  <div class="copy">${icon.replace("<svg ", '<svg role="img" ')}
    <h1>ランクパーティ</h1>
    <p>ゲーム大会のオッズ・ベット・順位を<br>まとめて管理するWebアプリ</p>
    <div class="url">shellcat7.github.io/party-bet-arena</div>
  </div>
  <div class="phone a"><img src="${left}"></div>
  <div class="phone b"><img src="${right}"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: "public/og-image.jpg", type: "jpeg", quality: 88 });
await browser.close();
console.log("saved public/og-image.jpg");
