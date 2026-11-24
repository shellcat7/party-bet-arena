import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, freshStart, nav, trackErrors } from "./helpers";

test("a host runs a complete two-race game on one device", async ({ page }) => {
  const errors = trackErrors(page);
  await freshStart(page);

  // Create a room with two races.
  await page.getByRole("button", { name: "ルームを作成" }).click();
  await page.getByLabel("ルーム名").fill("E2E カップ");
  const races = page.getByRole("group", { name: "レース数" });
  while ((await races.locator("output").textContent()) !== "2") {
    await races.getByRole("button", { name: "レース数を減らす" }).click();
  }
  await page.getByRole("button", { name: "ルームを作成" }).click();
  await expect(page.getByRole("heading", { name: "ルームを作成しました" })).toBeVisible();
  await page.getByRole("button", { name: "進行画面へ" }).click();

  // Add three bettors who don't have phones.
  await page.getByRole("button", { name: "参加者を追加" }).first().click();
  for (const name of ["ゆうた", "たくみ", "あやか"]) {
    await page.getByLabel("新しい参加者の名前").fill(name);
    await page.getByLabel("新しい参加者の名前").press("Enter");
  }
  await expect(page.getByRole("radio", { name: /参加者 3/ })).toBeVisible();

  for (let race = 1; race <= 2; race += 1) {
    // Enter a 100pt win ticket for each bettor; the selection advances automatically.
    await nav(page, "ベット").click();
    for (let index = 0; index < 3; index += 1) {
      await page.locator(".racer").nth(index).click();
      await page.getByRole("button", { name: "ベットする" }).click();
      await expect(page.getByRole("status").filter({ hasText: "ベットを受け付けました" })).toBeVisible();
    }
    await expect(page.locator(".ticket-list li")).toHaveCount(3);
    await expectNoHorizontalOverflow(page);

    // Close betting, enter the finish order and settle.
    await nav(page, "進行").click();
    await expect(page.getByText("3 / 3人")).toBeVisible();
    await page.getByRole("button", { name: "ベットを締め切る" }).click();
    await page.getByRole("button", { name: "着順を入力する" }).click();
    const picks = page.locator(".finish-pick");
    await picks.nth(0).click();
    await picks.nth(1).click();
    await picks.nth(2).click(); // the last racer is placed automatically
    await expect(page.getByRole("heading", { name: "精算プレビュー" })).toBeVisible();
    await page.getByRole("button", { name: "着順を確定して精算" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "確定して精算" }).click();

    if (race === 1) {
      await expect(page.getByRole("heading", { name: "第1レースの結果" })).toBeVisible();
      await expect(page.getByRole("table")).toContainText("ゆうた");
      await page.getByRole("button", { name: "第2レースを始める" }).click();
      await expect(page.getByRole("heading", { name: /第2レース/ })).toBeVisible();
    }
  }

  // The final screen crowns the bettor who backed the winner both times.
  await expect(page.getByRole("heading", { name: "最終結果" })).toBeVisible();
  await expect(page.locator("#champion-title")).toHaveText("ゆうた");
  await expect(page.getByRole("figure", { name: "残高の推移" })).toBeVisible();

  // Browser back returns to the host screen instead of leaving the app.
  await page.goBack();
  await expect(page.getByRole("button", { name: "最終結果を表示" })).toBeVisible();

  // The room survives a reload.
  await page.reload();
  await expect(page.getByText("E2E カップ")).toBeVisible();
  await nav(page, "順位").click();
  await expect(page.getByRole("heading", { name: "ランキング" })).toBeVisible();
  errors.assertClean();
});

test("betting validates the stake against the available balance", async ({ page }) => {
  await freshStart(page);
  await page.getByRole("button", { name: "デモを見る" }).click();
  await nav(page, "ベット").click();
  await page.getByRole("radio", { name: /たくみ/ }).click();
  await page.locator(".racer").first().click();
  await page.getByLabel("ベット額").fill("999999");
  await expect(page.getByRole("alert")).toHaveText("残高が足りません");
  await expect(page.getByRole("button", { name: "ベットする" })).toBeDisabled();
  await page.getByRole("button", { name: "全額" }).click();
  await expect(page.getByRole("button", { name: "ベットする" })).toBeEnabled();
});
