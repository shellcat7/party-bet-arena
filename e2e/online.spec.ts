import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { nav, trackErrors } from "./helpers";

/**
 * Real multi-device play against the Firebase Auth + Realtime Database emulators:
 * the participant joins by decoding the host's QR code, bets from their own browser,
 * and follows the host's settlement live.
 */
test("a participant joins by QR, bets, and sees the host's result live", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext({ baseURL, locale: "ja-JP" });
  const playerContext = await browser.newContext({ baseURL, locale: "en-US" });
  const host = await hostContext.newPage();
  const player = await playerContext.newPage();
  const hostErrors = trackErrors(host);
  const playerErrors = trackErrors(player);

  await host.goto("./");
  await host.getByRole("button", { name: "ルームを作成" }).click();
  await host.getByLabel("ルーム名").fill("オンライン杯");
  await host.getByRole("button", { name: "ルームを作成" }).click();

  // Decode the rendered QR code exactly as a phone camera would.
  const qr = host.getByTestId("invite-qr").locator("svg");
  await expect(qr).toBeVisible({ timeout: 20_000 });
  const png = PNG.sync.read(await qr.screenshot());
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded?.data).toContain("#roomId=");
  await host.getByRole("button", { name: "進行画面へ" }).click();

  await player.goto(decoded!.data);
  await expect(player.getByText("Invitation details filled in")).toBeVisible();
  await expect(player).not.toHaveURL(/joinCode/);
  await player.getByLabel("Display name").fill("Sam");
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await player.locator(".racer").nth(2).click();
  await player.getByRole("button", { name: "Place bet" }).click();
  await expect(player.getByRole("heading", { name: "Bet placed" })).toBeVisible();

  // The host sees the bet arrive, adds a proxy bettor at the same time, then settles.
  await expect(host.getByText("1 / 1人")).toBeVisible();
  await nav(host, "管理").click();
  await host.getByLabel("新しい参加者の名前").fill("おばあちゃん");
  await host.getByLabel("新しい参加者の名前").press("Enter");
  await nav(host, "ベット").click();
  await host.getByRole("radio", { name: /おばあちゃん/ }).click();
  await host.locator(".racer").nth(0).click();
  await host.getByRole("button", { name: "ベットする" }).click();
  await expect(host.locator(".ticket-list li")).toHaveCount(2);

  await nav(host, "進行").click();
  await host.getByRole("button", { name: "ベットを締め切る" }).click();
  await expect(player.getByText("Betting closed. Waiting for the result")).toBeVisible();
  await host.getByRole("button", { name: "着順を入力する" }).click();
  const picks = host.locator(".finish-pick");
  await picks.nth(2).click();
  await picks.nth(0).click();
  await picks.nth(1).click();
  await host.getByRole("button", { name: "着順を確定して精算" }).click();
  await host.getByRole("dialog").getByRole("button", { name: "確定して精算" }).click();
  await expect(host.getByRole("heading", { name: "第1レースの結果" })).toBeVisible();

  // The participant is taken to their result automatically.
  await expect(player.getByText("Hit", { exact: true }).first()).toBeVisible();
  await expect(player.getByRole("table")).toContainText("Sam");

  // Reloading reconnects to the room; the next race brings them back to betting.
  await player.reload();
  await expect(player.getByText("This race has a result")).toBeVisible();
  await host.getByRole("button", { name: "第2レースを始める" }).click();
  await expect(player.getByRole("heading", { name: "Race 2" })).toBeVisible();

  // When the host removes them, the participant loses access and is returned to the start screen.
  await nav(host, "管理").click();
  await host.getByRole("button", { name: "Samを外す" }).click();
  await host.getByRole("dialog").getByRole("button", { name: "外す" }).click();
  await expect(player.getByText("You no longer have access to this room.")).toBeVisible();
  await expect(player.getByRole("button", { name: "Join with a code" })).toBeVisible();

  hostErrors.assertClean();
  playerErrors.assertClean();
  await hostContext.close();
  await playerContext.close();
});
