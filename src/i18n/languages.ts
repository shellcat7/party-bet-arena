import type { LanguageName } from "../lib/types";

/** Supported languages, in the order shown in the language menu (labels are native names). */
export const LANGUAGES: Array<{ code: LanguageName; label: string; locale: string }> = [
  { code: "ja", label: "日本語", locale: "ja-JP" },
  { code: "en", label: "English", locale: "en-US" },
  { code: "zh", label: "简体中文", locale: "zh-CN" },
  { code: "ko", label: "한국어", locale: "ko-KR" },
  { code: "es", label: "Español", locale: "es-ES" },
  { code: "fr", label: "Français", locale: "fr-FR" },
  { code: "de", label: "Deutsch", locale: "de-DE" },
  { code: "it", label: "Italiano", locale: "it-IT" },
  { code: "uk", label: "Українська", locale: "uk-UA" },
];

export const LANGUAGE_CODES = LANGUAGES.map((language) => language.code);

/** Best match for a BCP 47 tag such as "zh-Hant-TW" or "en-GB"; defaults to English. */
export function matchLanguage(tag: string | undefined): LanguageName {
  const base = (tag ?? "").toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_CODES.find((code) => code === base) ?? "en";
}
