/**
 * Regenerates the screenshots used in README.md from the demo room.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/capture-screenshots.mjs [baseUrl] [outDir]
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4173/party-bet-arena/";
const outDir = process.argv[3] ?? "docs/screenshots";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "ja-JP",
  reducedMotion: "reduce",
};

async function newPage(options = {}) {
  const context = await browser.newContext({ ...phone, ...options });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.goto(baseUrl);
  return page;
}

const shot = async (page, name, fullPage = false) => {
  const toast = page.locator(".toast button");
  if (await toast.isVisible()) await toast.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage });
  console.log(`saved ${outDir}/${name}.png`);
};
const tab = (page, label) =>
  page.getByRole("navigation", { name: "メインメニュー" }).getByRole("button", { name: label });

// Launch screen
let page = await newPage();
await shot(page, "launch");

// Host view of the demo
await page.getByRole("button", { name: /デモで試す/ }).click();
await shot(page, "host-home");

// A participant's bet slip
await page.getByLabel("デモ・表示中の視点").selectOption({ label: "🌟 あやか" });
await page.getByRole("radio", { name: "2連単" }).click();
await page.locator(".racer").nth(1).click();
await page.locator(".racer").nth(3).click();
await page.getByLabel("ベット額").fill("150");
await shot(page, "bet");
await page.getByRole("button", { name: "この内容でベット" }).click();

// Host closes the final race and enters the result
await page.getByLabel("デモ・表示中の視点").selectOption({ label: "👑 幹事" });
await tab(page, "管理").click();
await page.getByRole("radio", { name: "ルール" }).click();
const races = page.getByRole("group", { name: "レース数" });
while ((await races.locator("output").textContent()) !== "3") {
  await races.getByRole("button", { name: "レース数を減らす" }).click();
}
await tab(page, "進行").click();
await page.getByRole("button", { name: "ベットを締め切る" }).click();
const close = page.getByRole("dialog").getByRole("button", { name: "締め切る" });
if (await close.isVisible()) await close.click();
await page.getByRole("button", { name: "着順を入力する" }).click();
for (const index of [1, 3, 0]) await page.locator(".finish-pick").nth(index).click();
await shot(page, "results-entry");
await page.getByRole("button", { name: "着順を確定して精算" }).click();
await page.getByRole("dialog").getByRole("button", { name: "確定して精算" }).click();
await page.getByRole("heading", { name: "最終結果" }).waitFor();
await shot(page, "final", true);

// Participant's result, leaderboard and history
await page.getByRole("button", { name: "戻る", exact: true }).click();
await page.getByLabel("デモ・表示中の視点").selectOption({ label: "🌟 あやか" });
await page.getByRole("button", { name: "結果と払戻を見る" }).click();
await shot(page, "race-result");
await page.getByRole("button", { name: "戻る", exact: true }).click();
await tab(page, "順位").click();
await shot(page, "ranking");
await tab(page, "履歴").click();
await shot(page, "history");

// Dark theme
const dark = await newPage({ colorScheme: "dark" });
await dark.getByRole("button", { name: /デモで試す/ }).click();
await tab(dark, "ベット").click();
await dark.locator(".racer").nth(2).click();
await shot(dark, "bet-dark");
await tab(dark, "順位").click();
await shot(dark, "ranking-dark");

// Desktop landing page
const desktop = await newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await shot(desktop, "desktop");

await browser.close();
