import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatMessage } from "../format";
import { LANGUAGES } from "../languages";

const SOURCE_ROOT = join(__dirname, "../..");
const CALL = /\bt\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Every English source string passed to t(), i.e. every key a catalog must translate. */
function englishKeys() {
  const keys = new Set<string>();
  for (const file of sourceFiles(SOURCE_ROOT)) {
    for (const match of readFileSync(file, "utf8").matchAll(CALL)) keys.add(JSON.parse(`"${match[2]}"`));
  }
  return keys;
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)(?:,|\})/g)]
    .map((match) => match[1])
    .sort()
    .filter((name, i, all) => all.indexOf(name) === i);

describe("translation catalogs", () => {
  const keys = englishKeys();

  it("finds the strings used in the app", () => {
    expect(keys.size).toBeGreaterThan(300);
  });

  for (const { code } of LANGUAGES.filter((language) => language.code !== "ja" && language.code !== "en")) {
    it(`${code} translates every string, with the same placeholders`, async () => {
      const catalog: Record<string, string> = (await import(`../locales/${code}.ts`)).default;
      const missing = [...keys].filter((key) => !catalog[key]);
      const stale = Object.keys(catalog).filter((key) => !keys.has(key));
      expect(missing, `missing in ${code}`).toEqual([]);
      expect(stale, `unused in ${code}`).toEqual([]);
      for (const [key, value] of Object.entries(catalog)) {
        expect(placeholders(value), `${code}: ${key}`).toEqual(placeholders(key));
      }
    });
  }
});

describe("formatMessage", () => {
  it("fills placeholders", () => {
    expect(formatMessage("Race {n} of {max}", { n: 2, max: 5 }, "en-US")).toBe("Race 2 of 5");
  });

  it("chooses plural forms by locale", () => {
    const message = "{count, plural, one {# ticket} other {# tickets}}";
    expect(formatMessage(message, { count: 1 }, "en-US")).toBe("1 ticket");
    expect(formatMessage(message, { count: 1200 }, "en-US")).toBe("1,200 tickets");
    const uk = "{count, plural, one {# квиток} few {# квитки} many {# квитків} other {# квитка}}";
    expect([1, 3, 5, 21].map((count) => formatMessage(uk, { count }, "uk-UA"))).toEqual([
      "1 квиток",
      "3 квитки",
      "5 квитків",
      "21 квиток",
    ]);
  });

  it("allows placeholders inside plural branches", () => {
    const message = "{count, plural, one {{names} hasn't bet yet.} other {{names} haven't bet yet.}}";
    expect(formatMessage(message, { count: 2, names: "A and B" }, "en-US")).toBe("A and B haven't bet yet.");
  });

  it("leaves text without parameters untouched", () => {
    expect(formatMessage("{literal}", undefined, "en-US")).toBe("{literal}");
  });
});
