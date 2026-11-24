import {
  ChevronRight,
  Crown,
  Github,
  LogIn,
  Monitor,
  Moon,
  Play,
  Plus,
  QrCode,
  Sun,
  Ticket,
  Trash2,
  Trophy,
  Users,
} from "lucide-react";
import { useConfirm } from "../components/feedback";
import { BrandMark } from "../components/ui";
import { raceStatusCopy } from "../i18n/copy";
import { useI18n } from "../i18n/i18n";
import type { RoomSummary, ThemePreference } from "../lib/storage";
import { useApp } from "../state/AppContext";
import { homeScreenFor } from "../state/navigation";

const REPOSITORY_URL = "https://github.com/shellcat7/party-bet-arena";

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="pill-switch" role="radiogroup" aria-label={t("表示言語", "Language")}>
      {(["ja", "en"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={language === value}
          className={language === value ? "is-active" : undefined}
          onClick={() => setLanguage(value)}
        >
          {value === "ja" ? "日本語" : "EN"}
        </button>
      ))}
    </div>
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
      aria-label={t(
        `テーマ: ${labels[preferences.theme]}（タップで${labels[next]}）`,
        `Theme: ${labels[preferences.theme]} (switch to ${labels[next]})`,
      )}
      title={labels[preferences.theme]}
    >
      <Icon size={20} />
    </button>
  );
}

export function LaunchScreen() {
  const { t } = useI18n();
  const { controller, nav } = useApp();
  const { actions, summaries, busy } = controller;

  const startDemo = () => {
    actions.startDemo();
    nav.reset({ name: "home" });
  };

  return (
    <div className="launch">
      <header className="launch__bar">
        <div className="brand">
          <BrandMark size={36} />
          <strong>{t("ランクパーティ", "Rank Party")}</strong>
        </div>
        <div className="launch__tools">
          <LanguageSwitch />
          <ThemeSwitch />
        </div>
      </header>

      <div className="launch__layout">
        <section className="launch__hero">
          <p className="eyebrow">{t("パーティゲーム用ベッティングアプリ", "Betting for game nights")}</p>
          <h1>{t("いつもの勝負を、\n賭けて盛り上がろう。", "Bet on your\ngame night.")}</h1>
          <p className="launch__lead">
            {t(
              "対戦ゲーム、カラオケ、ボードゲーム。身内の勝負に、競馬のようなオッズとベット、リアルタイムのランキングを。お金は使わず、遊び用コインだけで楽しめます。",
              "Racing games, karaoke, board games — add race-track odds, bets and a live leaderboard to any friendly match. Play coins only, no real money.",
            )}
          </p>

          <ol className="launch__steps">
            <li>
              <span>
                <QrCode size={20} />
              </span>
              <div>
                <strong>{t("ルームを作ってQRで招待", "Create a room, share the QR")}</strong>
                <small>{t("アカウント登録は不要です", "No sign-up needed")}</small>
              </div>
            </li>
            <li>
              <span>
                <Ticket size={20} />
              </span>
              <div>
                <strong>{t("各自のスマホでベット", "Everyone bets from their phone")}</strong>
                <small>{t("単勝・複勝・2連単・3連単", "Win, place, exacta, trifecta")}</small>
              </div>
            </li>
            <li>
              <span>
                <Trophy size={20} />
              </span>
              <div>
                <strong>{t("着順を入れると自動で精算", "Enter the finish, payouts are automatic")}</strong>
                <small>{t("ランキングが全員の画面に即反映", "Rankings update on every screen")}</small>
              </div>
            </li>
          </ol>
        </section>

        <section className="launch__actions" aria-label={t("はじめる", "Get started")}>
          <button
            className="launch-card launch-card--primary"
            type="button"
            onClick={() => nav.push({ name: "create" })}
          >
            <span className="launch-card__icon">
              <Plus size={30} />
            </span>
            <span className="launch-card__copy">
              <strong>{t("ルームを作る", "Create a room")}</strong>
              <small>{t("幹事として勝負を始める", "Host a new game")}</small>
            </span>
            <ChevronRight size={22} aria-hidden="true" />
          </button>
          <button className="launch-card" type="button" onClick={() => nav.push({ name: "join" })}>
            <span className="launch-card__icon launch-card__icon--dark">
              <LogIn size={28} />
            </span>
            <span className="launch-card__copy">
              <strong>{t("ルームに参加", "Join a room")}</strong>
              <small>{t("招待コードかQRで参加", "Use an invite code or QR")}</small>
            </span>
            <ChevronRight size={22} aria-hidden="true" />
          </button>
          <button className="demo-link" type="button" onClick={startDemo}>
            <Play size={18} />
            <span>
              <strong>{t("デモで試す", "Try the demo")}</strong>
              <small>
                {t("1台で幹事と参加者の両方を体験", "Explore host and player views on one device")}
              </small>
            </span>
          </button>

          {summaries.length > 0 && <SavedRooms summaries={summaries} busy={busy} />}
        </section>
      </div>

      <footer className="launch__footer">
        <p>
          {t(
            "遊び用コインのみを扱います。現金・換金・景品のやり取りには使えません。",
            "Play coins only. Not for real money, prizes or gambling.",
          )}
        </p>
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          <Github size={16} />
          {t("ソースコード", "Source code")}
        </a>
      </footer>
    </div>
  );
}

function SavedRooms(props: { summaries: RoomSummary[]; busy: boolean }) {
  const { t } = useI18n();
  const { controller, nav } = useApp();
  const { actions } = controller;
  const confirm = useConfirm();
  const status = raceStatusCopy(t);
  const remove = async (summary: RoomSummary) => {
    const ok = await confirm({
      title: t(`「${summary.name}」を削除しますか？`, `Delete “${summary.name}”?`),
      message:
        summary.role === "host"
          ? t(
              "ルームと全員の記録が削除され、元に戻せません。",
              "The room and everyone's records are deleted permanently.",
            )
          : t("この端末の一覧から外します。ルーム自体は残ります。", "This removes it from this device only."),
      confirmLabel: summary.role === "host" ? t("削除する", "Delete") : t("一覧から外す", "Remove"),
      tone: "danger",
    });
    if (ok) await actions.deleteRoom(summary.id);
  };
  const open = async (summary: RoomSummary) => {
    if (await actions.openRoom(summary.id)) nav.reset(homeScreenFor(summary.role));
  };

  return (
    <section className="saved-rooms" aria-labelledby="saved-rooms-title">
      <h2 id="saved-rooms-title">{t("最近のルーム", "Recent rooms")}</h2>
      <ul>
        {props.summaries.map((summary) => (
          <li key={summary.id}>
            <button
              type="button"
              className="saved-room"
              onClick={() => void open(summary)}
              disabled={props.busy}
            >
              <span className="saved-room__icon" aria-hidden="true">
                {summary.role === "host" ? <Crown size={18} /> : <Users size={18} />}
              </span>
              <span className="saved-room__copy">
                <strong>{summary.name}</strong>
                <small>
                  {summary.role === "host" ? t("幹事", "Host") : t("参加者", "Player")} ·{" "}
                  {t(
                    `第${summary.currentRaceNumber}/${summary.maxRaces}レース`,
                    `Race ${summary.currentRaceNumber}/${summary.maxRaces}`,
                  )}{" "}
                  · {status[summary.status]}
                </small>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button icon-button--quiet"
              onClick={() => void remove(summary)}
              aria-label={t(`${summary.name}を削除`, `Delete ${summary.name}`)}
            >
              <Trash2 size={18} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
