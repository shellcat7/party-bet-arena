import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  CloudOff,
  Eye,
  History,
  House,
  LogOut,
  QrCode,
  Settings2,
  Ticket,
  Trophy,
  UserX,
} from "lucide-react";
import { Coins, EmptyState } from "../../components/ui";
import { raceStatusCopy } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { getAvailableBalance } from "../../lib/betting";
import { isGameOver } from "../../lib/settlement";
import { useOpenRoom } from "../../state/AppContext";
import type { Screen, ScreenName } from "../../state/navigation";
import { TAB_SCREENS } from "../../state/navigation";
import { BetScreen } from "./BetScreen";
import { FinalScreen } from "./FinalScreen";
import { HistoryScreen } from "./HistoryScreen";
import { HostHomeScreen } from "./HostHomeScreen";
import { ManageScreen } from "./ManageScreen";
import { RaceResultScreen } from "./RaceResultScreen";
import { RankingScreen } from "./RankingScreen";
import { ResultsEntryScreen } from "./ResultsEntryScreen";

export function RoomShell() {
  const { room, controller, nav } = useOpenRoom();
  const { screen } = nav;
  const isTab = TAB_SCREENS.has(screen.name);
  const content = useRef<HTMLDivElement>(null);
  usePlayerAutoNavigation();

  // Move focus to the new screen so keyboard and screen-reader users land on its content.
  useEffect(() => {
    content.current?.focus({ preventScroll: true });
  }, [screen]);

  const removed = controller.role === "player" && !controller.me;

  return (
    <div className={isTab && !removed ? "room room--tab" : "room"}>
      {isTab && <RoomTopBar />}
      {controller.connection === "offline" && <OfflineBanner />}
      {room.isDemo && <DemoBanner />}
      <div className="room__content" key={screen.name} ref={content} tabIndex={-1}>
        {removed ? <RemovedNotice /> : renderScreen(screen)}
      </div>
      {isTab && !removed && <BottomNav />}
    </div>
  );
}

function RemovedNotice() {
  const { t } = useI18n();
  const { controller } = useOpenRoom();
  return (
    <div className="screen">
      <EmptyState
        icon={<UserX size={28} />}
        title={t("参加者から外れています", "You're no longer in this room")}
        action={
          <button className="button button--primary" type="button" onClick={controller.actions.closeRoom}>
            {t("ルーム一覧に戻る", "Back to rooms")}
          </button>
        }
      >
        {t(
          "幹事があなたを参加者から外しました。参加し直すには、もう一度招待を受け取ってください。",
          "The host removed you from the bettors. Ask for a new invitation to rejoin.",
        )}
      </EmptyState>
    </div>
  );
}

function renderScreen(screen: Screen) {
  switch (screen.name) {
    case "home":
      return <HostHomeScreen />;
    case "bet":
      return <BetScreen />;
    case "ranking":
      return <RankingScreen />;
    case "history":
      return <HistoryScreen />;
    case "manage":
      return <ManageScreen initialSection={screen.section} />;
    case "results":
      return <ResultsEntryScreen />;
    case "race":
      return <RaceResultScreen raceId={screen.raceId} />;
    case "final":
      return <FinalScreen />;
    default:
      return null;
  }
}

/**
 * Participants follow the host: when a race is settled they are taken to their result, and
 * when the next race opens they land back on the betting screen.
 */
function usePlayerAutoNavigation() {
  const { room, controller, nav } = useOpenRoom();
  const race = room.currentRace;
  const previous = useRef({ id: race.id, status: race.status });
  const gameOver = isGameOver(room);
  const { push, reset } = nav;

  useEffect(() => {
    const before = previous.current;
    previous.current = { id: race.id, status: race.status };
    if (controller.role !== "player") return;
    if (before.id === race.id && before.status !== "settled" && race.status === "settled") {
      push(gameOver ? { name: "final" } : { name: "race", raceId: race.id });
    } else if (before.id !== race.id) {
      reset({ name: "bet" });
    }
  }, [race.id, race.status, controller.role, gameOver, push, reset]);
}

function RoomTopBar() {
  const { t } = useI18n();
  const { room, controller, nav } = useOpenRoom();
  const status = raceStatusCopy(t);
  const me = controller.me;

  return (
    <header className="topbar">
      <button
        className="icon-button icon-button--quiet"
        type="button"
        onClick={controller.actions.closeRoom}
        aria-label={t("ルームを出る", "Leave room")}
        title={t("ルーム一覧に戻る", "Back to rooms")}
      >
        <LogOut size={20} />
      </button>
      <div className="topbar__title">
        <strong>{room.name}</strong>
        <span>
          {t(
            `第${room.currentRace.number}/${room.settings.maxRaces}レース`,
            `Race ${room.currentRace.number}/${room.settings.maxRaces}`,
          )}
          <i className={`status-dot status-dot--${room.currentRace.status}`} aria-hidden="true" />
          {status[room.currentRace.status]}
        </span>
      </div>
      {me ? (
        <div className="balance-chip" aria-label={t("あなたの残高", "Your balance")}>
          <small>{t("残高", "Balance")}</small>
          <Coins value={room.settings.allowDebt ? me.balance : getAvailableBalance(room, me.id)} />
        </div>
      ) : controller.isOnlineRoom ? (
        <button
          className="icon-button"
          type="button"
          onClick={() => nav.push({ name: "invite" })}
          aria-label={t("招待QRを表示", "Show invitation QR")}
        >
          <QrCode size={20} />
        </button>
      ) : (
        <span className="topbar__spacer" />
      )}
    </header>
  );
}

function BottomNav() {
  const { t } = useI18n();
  const { controller, nav } = useOpenRoom();
  const items: Array<{ name: ScreenName; label: string; icon: ReactNode }> =
    controller.role === "host"
      ? [
          { name: "home", label: t("進行", "Run"), icon: <House size={22} /> },
          { name: "bet", label: t("ベット", "Bet"), icon: <Ticket size={22} /> },
          { name: "ranking", label: t("順位", "Ranks"), icon: <Trophy size={22} /> },
          { name: "manage", label: t("管理", "Manage"), icon: <Settings2 size={22} /> },
        ]
      : [
          { name: "bet", label: t("ベット", "Bet"), icon: <Ticket size={22} /> },
          { name: "ranking", label: t("順位", "Ranks"), icon: <Trophy size={22} /> },
          { name: "history", label: t("履歴", "History"), icon: <History size={22} /> },
        ];

  return (
    <nav className="bottom-nav" aria-label={t("メインメニュー", "Main menu")}>
      {items.map((item) => (
        <button
          key={item.name}
          type="button"
          className={nav.screen.name === item.name ? "is-active" : undefined}
          aria-current={nav.screen.name === item.name ? "page" : undefined}
          onClick={() => nav.replace({ name: item.name } as Screen)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function OfflineBanner() {
  const { t } = useI18n();
  return (
    <p className="banner banner--warning" role="status">
      <CloudOff size={16} aria-hidden="true" />
      {t(
        "オフラインです。再接続すると自動で同期します。",
        "You're offline. Changes sync when you reconnect.",
      )}
    </p>
  );
}

function DemoBanner() {
  const { t } = useI18n();
  const { room, controller, nav } = useOpenRoom();
  const value = controller.role === "host" ? "host" : (controller.session?.playerId ?? "host");
  return (
    <div className="banner banner--demo">
      <Eye size={16} aria-hidden="true" />
      <label>
        <span>{t("デモ・表示中の視点", "Demo · viewing as")}</span>
        <select
          value={value}
          onChange={(event) => {
            const next = event.target.value === "host" ? null : event.target.value;
            controller.actions.switchPerspective(next);
            nav.reset({ name: next ? "bet" : "home" });
          }}
        >
          <option value="host">{t("👑 幹事", "👑 Host")}</option>
          {room.players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.emoji} {player.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
