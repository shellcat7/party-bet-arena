import { ChevronDown, ChevronRight, Github, Globe, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useConfirm } from "../components/feedback";
import { PixelCarriers } from "../components/scenes/PixelCarriers";
import { BrandMark } from "../components/ui";
import { raceStatusCopy } from "../i18n/copy";
import { useI18n } from "../i18n/i18n";
import { LANGUAGES } from "../i18n/languages";
import type { RoomSummary, ThemePreference } from "../lib/storage";
import type { LanguageName } from "../lib/types";
import { useApp } from "../state/AppContext";
import { homeScreenFor } from "../state/navigation";

const REPOSITORY_URL = "https://github.com/shellcat7/party-bet-arena";

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="language-select">
      <Globe size={16} aria-hidden="true" />
      <span className="sr-only">{t("表示言語", "Language")}</span>
      <select value={language} onChange={(event) => setLanguage(event.target.value as LanguageName)}>
        {LANGUAGES.map((item) => (
          <option key={item.code} value={item.code} lang={item.code}>
            {item.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}

export function ThemeSwitch() {
  const { t } = useI18n();
  const { preferences, setPreferences } = useApp();
  const order: ThemePreference[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(preferences.theme) + 1) % order.length];
  const labels: Record<ThemePreference, string> = {
    system: t("端末の設定", "System"),
    light: t("ライト", "Light"),
    dark: t("ダーク", "Dark"),
  };
  const Icon = preferences.theme === "dark" ? Moon : preferences.theme === "light" ? Sun : Monitor;
  return (
    <button
      className="icon-button"
      type="button"
      onClick={() => setPreferences({ theme: next })}
      aria-label={t("表示テーマ：{current}（{next}に切り替え）", "Theme: {current} (switch to {next})", {
        current: labels[preferences.theme],
        next: labels[next],
      })}
      title={labels[preferences.theme]}
    >
      <Icon size={18} />
    </button>
  );
}

export function LaunchScreen() {
  const { t } = useI18n();
  const { controller, nav } = useApp();
  const { actions, summaries } = controller;
  const hasRooms = summaries.length > 0;

  const startDemo = () => {
    actions.startDemo();
    nav.reset({ name: "home" });
  };

  return (
    <div className="launch">
      <header className="launch__bar">
        {hasRooms ? (
          <div className="brand">
            <BrandMark size={28} />
            <strong>{t("ランクパーティ", "Rank Party")}</strong>
          </div>
        ) : (
          <span />
        )}
        <div className="launch__tools">
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </header>

      <main className={hasRooms ? "launch__body" : "launch__body launch__body--intro"}>
        {hasRooms ? (
          <SavedRooms summaries={summaries} />
        ) : (
          <div className="launch__intro">
            <div className="launch__scene">
              <PixelCarriers
                label={t("チケットを運ぶ小さなキャラクター", "Little helpers carrying tickets")}
              />
            </div>
            <BrandMark size={72} />
            <h1>{t("ランクパーティ", "Rank Party")}</h1>
            <p>
              {t(
                "ゲーム大会のオッズ・ベット・順位をまとめて管理",
                "Odds, bets and standings for game nights",
              )}
            </p>
          </div>
        )}
      </main>

      <div className="launch__actions">
        <button
          className="button button--primary button--block button--lg"
          type="button"
          onClick={() => nav.push({ name: "create" })}
        >
          {t("ルームを作成", "Create a room")}
        </button>
        <button
          className="button button--secondary button--block button--lg"
          type="button"
          onClick={() => nav.push({ name: "join" })}
        >
          {t("招待コードで参加", "Join with a code")}
        </button>
        <button className="button button--ghost button--block" type="button" onClick={startDemo}>
          {t("デモを見る", "View demo")}
        </button>
      </div>

      <footer className="launch__footer">
        <p>
          {t(
            "ポイントは遊び用です。現金や景品とは交換できません。",
            "Points are for play only and can't be exchanged for money or prizes.",
          )}
        </p>
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          <Github size={14} aria-hidden="true" />
          GitHub
        </a>
      </footer>
    </div>
  );
}

function SavedRooms(props: { summaries: RoomSummary[] }) {
  const { t } = useI18n();
  const { controller, nav } = useApp();
  const { actions, busy } = controller;
  const confirm = useConfirm();
  const status = raceStatusCopy(t);

  const remove = async (summary: RoomSummary) => {
    const ok = await confirm({
      title: t("「{name}」を削除しますか？", "Delete “{name}”?", { name: summary.name }),
      message:
        summary.role === "host"
          ? t(
              "ルームと全員の記録が削除されます。この操作は取り消せません。",
              "The room and everyone's records will be deleted. This can't be undone.",
            )
          : t(
              "この端末の一覧から削除します。ルームは削除されません。",
              "This only removes it from this device.",
            ),
      confirmLabel: t("削除", "Delete"),
      tone: "danger",
    });
    if (ok) await actions.deleteRoom(summary.id);
  };

  const open = async (summary: RoomSummary) => {
    const role = await actions.openRoom(summary.id);
    if (role) nav.reset(homeScreenFor(role));
  };

  return (
    <section aria-labelledby="saved-rooms-title">
      <h2 id="saved-rooms-title" className="section-label">
        {t("最近のルーム", "Recent rooms")}
      </h2>
      <ul className="list">
        {props.summaries.map((summary) => (
          <li key={summary.id} className="list__row saved-room">
            <button
              type="button"
              className="saved-room__open"
              onClick={() => void open(summary)}
              disabled={busy}
            >
              <span className="saved-room__copy">
                <strong>{summary.name}</strong>
                <small>
                  {summary.role === "host" ? t("幹事", "Host") : t("参加者", "Player")}
                  {" ・ "}
                  {t("第{n}/{max}レース", "Race {n}/{max}", {
                    n: summary.currentRaceNumber,
                    max: summary.maxRaces,
                  })}
                  {" ・ "}
                  {status[summary.status]}
                </small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button icon-button--quiet"
              onClick={() => void remove(summary)}
              aria-label={t("{name}を削除", "Delete {name}", { name: summary.name })}
            >
              <Trash2 size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
