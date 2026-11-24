export type MessageParams = Record<string, string | number>;

/** Index of the brace that closes the one at `open`. */
function matchBrace(text: string, open: number) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** `one {# ticket} other {# tickets}` → { one: "# ticket", other: "# tickets" } */
function parseBranches(source: string) {
  const branches: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    const match = /\s*(=?\w+)\s*\{/y;
    match.lastIndex = index;
    const found = match.exec(source);
    if (!found) break;
    const open = match.lastIndex - 1;
    const close = matchBrace(source, open);
    if (close < 0) break;
    branches[found[1]] = source.slice(open + 1, close);
    index = close + 1;
  }
  return branches;
}

/**
 * Fills `{name}` placeholders and ICU-style plurals:
 * `{count, plural, one {# ticket} other {# tickets}}`. `#` is the formatted count. Plural
 * categories follow the locale (e.g. Ukrainian uses one/few/many/other).
 */
export function formatMessage(template: string, params: MessageParams | undefined, locale: string): string {
  if (!params || !template.includes("{")) return template;
  let output = "";
  let index = 0;
  while (index < template.length) {
    const open = template.indexOf("{", index);
    if (open < 0) {
      output += template.slice(index);
      break;
    }
    const close = matchBrace(template, open);
    if (close < 0) {
      output += template.slice(index);
      break;
    }
    output += template.slice(index, open);
    const inner = template.slice(open + 1, close);
    const plural = /^(\w+),\s*plural,([\s\S]*)$/.exec(inner);
    if (plural) {
      const count = Number(params[plural[1]]);
      const branches = parseBranches(plural[2]);
      const category =
        branches[`=${count}`] !== undefined ? `=${count}` : new Intl.PluralRules(locale).select(count);
      const branch = branches[category] ?? branches.other ?? "";
      output += formatMessage(
        branch.replace(/#/g, new Intl.NumberFormat(locale).format(count)),
        params,
        locale,
      );
    } else {
      const value = params[inner.trim()];
      output += value === undefined ? template.slice(open, close + 1) : String(value);
    }
    index = close + 1;
  }
  return output;
}
