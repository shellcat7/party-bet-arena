import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Eye,
  Flag,
  History,
  House,
  QrCode,
  Settings2,
  Ticket,
  Trophy,
  UserX,
} from "lucide-react";
import { Points, EmptyState } from "../../components/ui";
import { betTypeCopy, raceName, raceStatusCopy } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { getAvailableBalance, getPlayerBets } from "../../lib/betting";
import { getBetPickIds } from "../../lib/odds";
import { isGameOver } from "../../lib/settlement";
import { useOpenRoom } from "../../state/AppContext";
import type { Screen, ScreenName } from "../../state/navigation";
import { TAB_SCREENS } from "../../state/navigation";
import { BetScreen } from "./BetScreen";
import { PlayerRaceScreen } from "./PlayerRaceScreen";
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
      {/* Switching perspective belongs to the tabs; pushed screens keep their own header on top. */}
      {room.isDemo && isTab && <DemoBanner />}
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

/** The host enters bets for others here; a participant's tab follows the race instead. */
function BetTab() {
  const { controller } = useOpenRoom();
  return controller.role === "host" ? <BetScreen /> : <PlayerRaceScreen />;
}

function renderScreen(screen: Screen) {
  switch (screen.name) {
    case "home":
      return <HostHomeScreen />;
    case "bet":
      return <BetTab />;
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
 * Participants follow the host: when betting closes they are brought to the race screen (which
 * now shows the race in progress), when a race is settled they are taken to their result, and
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
    if (before.id === race.id && before.status === "betting" && race.status === "closed") {
      reset({ name: "bet" });
    } else if (before.id === race.id && before.status !== "settled" && race.status === "settled") {
      push(gameOver ? { name: "final" } : { name: "race", raceId: race.id });
    } else if (before.id !== race.id || (before.status === "settled" && race.status !== "settled")) {
      // A new race opened, or the host undid the settlement to correct the order.
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
        className="glass-button"
        type="button"
        onClick={controller.actions.closeRoom}
        aria-label={t("ルーム一覧に戻る", "Back to rooms")}
        title={t("ルーム一覧に戻る", "Back to rooms")}
      >
        <ChevronLeft size={22} />
      </button>
      <div className="topbar__title">
        <strong>{room.name}</strong>
        <span>
          {t("第{n}/{max}レース", "Race {n}/{max}", {
            n: room.currentRace.number,
            max: room.settings.maxRaces,
          })}
          <i className={`status-dot status-dot--${room.currentRace.status}`} aria-hidden="true" />
          {status[room.currentRace.status]}
        </span>
      </div>
      {me ? (
        <div className="balance-chip glass-capsule" aria-label={t("あなたの残高", "Your balance")}>
          <small>{t("残高", "Balance")}</small>
          <Points value={room.settings.allowDebt ? me.balance : getAvailableBalance(room, me.id)} />
        </div>
      ) : controller.isOnlineRoom ? (
        <button
          className="glass-button"
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
          { name: "home", label: t("進行", "Run"), icon: <House size={24} /> },
          { name: "bet", label: t("ベット", "Bet"), icon: <Ticket size={24} /> },
          { name: "ranking", label: t("順位", "Ranks"), icon: <Trophy size={24} /> },
          { name: "manage", label: t("管理", "Manage"), icon: <Settings2 size={24} /> },
        ]
      : [
          { name: "bet", label: t("レース", "Race"), icon: <Flag size={24} /> },
          { name: "ranking", label: t("順位", "Ranks"), icon: <Trophy size={24} /> },
          { name: "history", label: t("履歴", "History"), icon: <History size={24} /> },
        ];
  const active = items.findIndex((item) => item.name === nav.screen.name);

  return (
    <div className="tab-dock">
      <RaceAccessory />
      <nav
        className="bottom-nav"
        aria-label={t("メインメニュー", "Main menu")}
        style={{ "--tabs": items.length, "--active": Math.max(0, active) } as CSSProperties}
      >
        {/* The glass lens slides to the selected tab; the inner element restarts its stretch. */}
        {active >= 0 && (
          <span className="bottom-nav__lens" aria-hidden="true">
            <span key={active} />
          </span>
        )}
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
    </div>
  );
}

/**
 * The current race, always one tap away: a capsule above the tab bar (like a mini player) on every
 * tab except the race screen itself.
 */
function RaceAccessory() {
  const { t, formatNumber } = useI18n();
  const { room, controller, nav } = useOpenRoom();
  const isHost = controller.role === "host";
  const raceTab: ScreenName = isHost ? "home" : "bet";
  if (nav.screen.name === raceTab) return null;

  const race = room.currentRace;
  const labels = betTypeCopy(t);
  let detail: string | undefined;
  if (isHost) {
    const placed = new Set(race.bets.map((bet) => bet.playerId)).size;
    if (race.status === "betting") {
      detail = t("{count} / {max}人がベット", "{count} of {max} have bet", {
        count: placed,
        max: room.players.length,
      });
    } else if (race.status === "closed") {
      detail = t("着順の入力待ち", "Waiting for the result");
    }
  } else {
    const ticket = controller.me ? getPlayerBets(room, controller.me.id)[0] : undefined;
    if (ticket) {
      const names = getBetPickIds(ticket).map(
        (id) => room.contestants.find((contestant) => contestant.id === id)?.name ?? "?",
      );
      detail = `${labels[ticket.type].title} ${names.join(" → ")} · ${formatNumber(ticket.amount)}pt`;
    } else if (race.status === "betting") {
      detail = t("まだベットしていません", "You haven't bet yet");
    }
  }

  return (
    <button className="race-accessory" type="button" onClick={() => nav.replace({ name: raceTab })}>
      <i className={`status-dot status-dot--${race.status}`} aria-hidden="true" />
      <span className="race-accessory__text">
        <strong>{raceName(t, race.number)}</strong>
        <small>
          {raceStatusCopy(t)[race.status]}
          {detail && ` · ${detail}`}
        </small>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
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
          <option value="host">{t("幹事", "Host")}</option>
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
