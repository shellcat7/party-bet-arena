import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LanguageName } from "../lib/types";
import type { MessageParams } from "./format";
import { formatMessage } from "./format";
import { LANGUAGES } from "./languages";

/**
 * Copy is written next to the component that renders it, as `t(japanese, english, params)`.
 * Japanese and English are the source languages. Every other language has a catalog in
 * `locales/<code>.ts` keyed by the English text (gettext style); a test fails if any catalog is
 * missing a string used in the code. Catalogs load on demand, so only the active one is fetched.
 */
export type Translate = (ja: string, en: string, params?: MessageParams) => string;
type Catalog = Record<string, string>;

export type I18n = {
  language: LanguageName;
  setLanguage: (language: LanguageName) => void;
  t: Translate;
  formatNumber: (value: number) => string;
  formatSigned: (value: number) => string;
  formatDateTime: (value: number) => string;
  formatTime: (value: number) => string;
  formatList: (items: string[]) => string;
};

const catalogLoaders = import.meta.glob<{ default: Catalog }>("./locales/*.ts");
const loadedCatalogs = new Map<LanguageName, Catalog>();

async function loadCatalog(language: LanguageName) {
  const loader = catalogLoaders[`./locales/${language}.ts`];
  if (!loader) return undefined;
  const catalog = (await loader()).default;
  loadedCatalogs.set(language, catalog);
  return catalog;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider(props: {
  language: LanguageName;
  onLanguageChange: (language: LanguageName) => void;
  children: ReactNode;
}) {
  const { language, onLanguageChange } = props;
  const needsCatalog = language !== "ja" && language !== "en";
  const [catalog, setCatalog] = useState<Catalog | undefined>(() => loadedCatalogs.get(language));
  const activeCatalog = needsCatalog ? (loadedCatalogs.get(language) ?? catalog) : undefined;

  useEffect(() => {
    if (!needsCatalog || loadedCatalogs.has(language)) return;
    let cancelled = false;
    loadCatalog(language).then((loaded) => {
      if (!cancelled) setCatalog(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [language, needsCatalog]);

  const locale = LANGUAGES.find((item) => item.code === language)?.locale ?? "en-US";

  const t = useCallback<Translate>(
    (ja, en, params) => {
      const template = language === "ja" ? ja : language === "en" ? en : (activeCatalog?.[en] ?? en);
      return formatMessage(template, params, locale);
    },
    [activeCatalog, language, locale],
  );

  const value = useMemo<I18n>(() => {
    const number = new Intl.NumberFormat(locale);
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
    const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    return {
      language,
      setLanguage: onLanguageChange,
      t,
      formatNumber: (value) => number.format(value),
      formatSigned: (value) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${number.format(Math.abs(value))}`,
      formatDateTime: (value) => dateTime.format(value),
      formatTime: (value) => time.format(value),
      formatList: (items) => list.format(items),
    };
  }, [language, locale, onLanguageChange, t]);

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}
