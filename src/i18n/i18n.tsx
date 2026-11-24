import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { LanguageName } from "../lib/types";

/**
 * The app ships in Japanese and English. Copy lives next to the component that renders it as a
 * `t("日本語", "English")` pair: with two languages this keeps both versions reviewable side by side
 * and makes a missing translation a type error rather than a silent fallback.
 */
export type Translate = (ja: string, en: string) => string;

export type I18n = {
  language: LanguageName;
  setLanguage: (language: LanguageName) => void;
  t: Translate;
  formatNumber: (value: number) => string;
  formatSigned: (value: number) => string;
  formatDateTime: (value: number) => string;
  formatTime: (value: number) => string;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider(props: {
  language: LanguageName;
  onLanguageChange: (language: LanguageName) => void;
  children: ReactNode;
}) {
  const { language, onLanguageChange } = props;
  const t = useCallback<Translate>((ja, en) => (language === "ja" ? ja : en), [language]);
  const value = useMemo<I18n>(() => {
    const locale = language === "ja" ? "ja-JP" : "en-US";
    const number = new Intl.NumberFormat(locale);
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
    return {
      language,
      setLanguage: onLanguageChange,
      t,
      formatNumber: (value) => number.format(value),
      formatSigned: (value) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${number.format(Math.abs(value))}`,
      formatDateTime: (value) => dateTime.format(value),
      formatTime: (value) => time.format(value),
    };
  }, [language, onLanguageChange, t]);
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}
