import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Fails the test on any uncaught error or console error (including CSP violations). */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return {
    assertClean: () => expect(errors, errors.join("\n")).toEqual([]),
  };
}

export async function freshStart(page: Page) {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.goto("./");
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(0);
}

export const nav = (page: Page, label: string) =>
  page.getByRole("navigation", { name: /メインメニュー|Main menu/ }).getByRole("button", { name: label });
