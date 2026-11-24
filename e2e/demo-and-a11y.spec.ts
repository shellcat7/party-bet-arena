import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expectNoHorizontalOverflow, freshStart, nav, trackErrors } from "./helpers";

// @axe-core/playwright is typed against a newer playwright-core; the runtime API is identical.
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

async function expectAccessible(page: Page) {
  await page.waitForTimeout(250); // let entry transitions settle so colours are measured at rest
  const results = await new AxeBuilder({ page: page as unknown as AxePage })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(
    serious.map(
      (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

test("the demo shows both the host and a participant's view", async ({ page }) => {
  const errors = trackErrors(page);
  await freshStart(page);
  await page.getByRole("button", { name: "デモを見る" }).click();

  await expect(page.getByRole("heading", { name: /第3レース/ })).toBeVisible();
  await expect(page.getByText("2 / 4人")).toBeVisible();

  // Switch to a participant who hasn't bet yet and place their ticket.
  await page.getByLabel("デモ・表示中の視点").selectOption({ label: "🌟 あやか" });
  await expect(page.getByRole("heading", { name: /第3レース/ })).toBeVisible();
  await page.getByRole("radio", { name: "2連単" }).click();
  await page.locator(".racer").nth(1).click();
  await page.locator(".racer").nth(0).click();
  await expect(page.locator(".ticket__pick").first()).toContainText("ブルー");
  await page.getByRole("button", { name: "ベットする" }).click();
  await expect(page.getByRole("heading", { name: "ベットを受け付けました" })).toBeVisible();
  await expect(page.getByText("あと1人のベットを待っています")).toBeVisible();

  // Change of mind before betting closes.
  await page.getByRole("button", { name: "取り消して選び直す" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "取り消す" }).click();
  await expect(page.getByRole("button", { name: "ベットする" })).toBeVisible();
  await page.locator(".racer").nth(0).click();
  await page.getByRole("button", { name: "ベットする" }).click();
  await expect(page.getByRole("heading", { name: "ベットを受け付けました" })).toBeVisible();

  // History with the balance chart and its table view.
  await nav(page, "履歴").click();
  await expect(page.getByRole("figure", { name: "残高の推移" })).toBeVisible();
  await page.getByText("表で見る").click();
  await expect(page.getByRole("table")).toContainText("あやか");
  await page.locator(".race-history button").first().click();
  await expect(page.getByRole("heading", { name: "第2レースの結果" })).toBeVisible();
  errors.assertClean();
});

test("the interface can switch to English", async ({ page }) => {
  await freshStart(page);
  await page.getByRole("radio", { name: "EN" }).click();
  await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Rank Party" })).toBeVisible();
});

test.describe("accessibility and layout", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("entry screens", async ({ page }) => {
    await freshStart(page);
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "招待コードで参加" }).click();
    await expectAccessible(page);
    await page.getByRole("button", { name: "戻る" }).click();
    await page.getByRole("button", { name: "ルームを作成" }).click();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`room screens (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await freshStart(page);
      await page.getByRole("button", { name: "デモを見る" }).click();
      for (const tab of ["進行", "ベット", "順位", "管理"]) {
        await nav(page, tab).click();
        await expectAccessible(page);
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});

test.describe("small phones (320px)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("no screen scrolls horizontally", async ({ page }) => {
    await freshStart(page);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "ルームを作成" }).click();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "戻る" }).click();
    await page.getByRole("button", { name: "デモを見る" }).click();
    for (const tab of ["進行", "ベット", "順位", "管理"]) {
      await nav(page, tab).click();
      await expectNoHorizontalOverflow(page);
    }
    await nav(page, "進行").click();
    await page.getByRole("button", { name: "ベットを締め切る" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "締め切る" }).click();
    await page.getByRole("button", { name: "着順を入力する" }).click();
    await expectNoHorizontalOverflow(page);
  });
});
