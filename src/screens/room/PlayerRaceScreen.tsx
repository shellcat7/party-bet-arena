import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { useConfirm } from "../../components/feedback";
import { PainterlyMeadow } from "../../components/scenes/PainterlyMeadow";
import { PixelCarriers } from "../../components/scenes/PixelCarriers";
import { Avatar, Lane, PhaseTag, Points } from "../../components/ui";
import type { PhaseTone } from "../../components/ui";
import { betTypeCopy, raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { getDraftMultiplier, getPlayerBets } from "../../lib/betting";
import { getBetPickIds } from "../../lib/odds";
import { isGameOver } from "../../lib/settlement";
import type { Bet, Room } from "../../lib/types";
import { useOpenRoom } from "../../state/AppContext";
import { BetScreen } from "./BetScreen";

/**
 * A participant's race tab follows the race. Each phase has exactly one screen and at most one
 * thing to do, so nobody has to work out what is going on:
 *
 *   betting, no ticket  → bet slip
 *   betting, ticket     → "you're in", waiting for the host to close betting (can still cancel)
 *   closed              → race in progress; nothing to do until the result arrives
 *   settled             → this race's outcome, waiting for the next race
 *   game over           → link to the final results
 */
export function PlayerRaceScreen() {
  const { room, controller } = useOpenRoom();
  const race = room.currentRace;
  const me = controller.me;
  const ticket = me ? getPlayerBets(room, me.id)[0] : undefined;

  if (race.status === "betting") {
    return ticket ? <BetPlacedStage room={room} ticket={ticket} /> : <BetScreen />;
  }
  if (race.status === "closed") return <RaceLiveStage room={room} ticket={ticket} />;
  if (isGameOver(room)) return <GameOverStage room={room} />;
  return <RaceSettledStage room={room} playerId={me?.id} />;
}

function Stage(props: {
  tone: PhaseTone;
  phase: string;
  title: string;
  message: ReactNode;
  scene: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="screen">
      <section className={`stage stage--${props.tone}`} aria-labelledby="stage-title">
        <div className="stage__scene">{props.scene}</div>
        <div className="stage__body" role="status">
          <PhaseTag tone={props.tone}>{props.phase}</PhaseTag>
          <h1 id="stage-title">{props.title}</h1>
          <p>{props.message}</p>
        </div>
      </section>
      {props.children}
    </div>
  );
}

function BetPlacedStage(props: { room: Room; ticket: Bet }) {
  const { t } = useI18n();
  const { room, ticket } = props;
  const waitingFor = room.players.length - new Set(room.currentRace.bets.map((bet) => bet.playerId)).size;
  return (
    <Stage
      tone="open"
      phase={raceName(t, room.currentRace.number)}
      title={t("ベットしました", "You're in")}
      message={
        waitingFor > 0
          ? t(
              "あと{count}人のベットを待っています。締め切られるとレースが始まります。",
              "{count, plural, one {Waiting for # more bettor.} other {Waiting for # more bettors.}} The race starts when betting closes.",
              { count: waitingFor },
            )
          : t(
              "全員がベットしました。幹事が締め切るとレースが始まります。",
              "Everyone has bet. The race starts when the host closes betting.",
            )
      }
      scene={
        <PixelCarriers label={t("チケットを運ぶ小さなキャラクター", "Little helpers carrying tickets")} />
      }
    >
      <TicketCard room={room} ticket={ticket} />
      <BettorStatus room={room} />
    </Stage>
  );
}

function RaceLiveStage(props: { room: Room; ticket?: Bet }) {
  const { t } = useI18n();
  const { room, ticket } = props;
  return (
    <Stage
      tone="live"
      phase={raceName(t, room.currentRace.number)}
      title={t("レース中", "Race in progress")}
      message={t(
        "ベットは締め切られました。幹事が着順を入力すると、結果がこの画面に届きます。",
        "Betting is closed. The result appears here as soon as the host enters the finishing order.",
      )}
      scene={
        <PainterlyMeadow
          label={t(
            "風の吹く丘で日傘をさす人を描いた油絵風の風景",
            "An oil-painting-style scene of a person with a parasol on a windy hill",
          )}
        />
      }
    >
      {ticket ? (
        <TicketCard room={room} ticket={ticket} />
      ) : (
        <p className="notice">{t("このレースはベットしていません。", "You didn't bet on this race.")}</p>
      )}
    </Stage>
  );
}

function RaceSettledStage(props: { room: Room; playerId?: string }) {
  const { t } = useI18n();
  const { nav } = useOpenRoom();
  const { room, playerId } = props;
  const entry = room.raceHistory.find((item) => item.raceId === room.currentRace.id);
  const row = entry?.payouts.find((item) => item.playerId === playerId);
  const played = Boolean(row && row.stake > 0);
  const title = !played
    ? t("結果が出ました", "The result is in")
    : row && row.hits > 0
      ? t("的中しました", "Your ticket hit")
      : t("今回は外れました", "No luck this time");

  return (
    <Stage
      tone="result"
      phase={raceName(t, room.currentRace.number)}
      title={title}
      message={t(
        "次のレースが始まると、この画面でベットできます。",
        "You can bet here as soon as the next race opens.",
      )}
      scene={
        <PixelCarriers
          label={t("次のレースを準備する小さなキャラクター", "Little helpers setting up the next race")}
        />
      }
    >
      {row && played && (
        <dl className="result-strip">
          <div>
            <dt>{t("このレースの収支", "This race")}</dt>
            <dd>
              <Points value={row.delta} signed />
            </dd>
          </div>
          <div>
            <dt>{t("残高", "Balance")}</dt>
            <dd>
              <Points value={row.balanceAfter} />
            </dd>
          </div>
        </dl>
      )}
      <button
        className="button button--secondary button--block"
        type="button"
        onClick={() => nav.push({ name: "race", raceId: room.currentRace.id })}
      >
        {t("結果と払戻を見る", "See the result and payouts")}
      </button>
    </Stage>
  );
}

function GameOverStage(props: { room: Room }) {
  const { t } = useI18n();
  const { nav } = useOpenRoom();
  return (
    <Stage
      tone="result"
      phase={t("全{max}レース終了", "All {max} races finished", { max: props.room.settings.maxRaces })}
      title={t("大会が終わりました", "The tournament is over")}
      message={t("最終順位と記録を確認できます。", "See the final standings and records.")}
      scene={
        <PainterlyMeadow
          label={t(
            "風の吹く丘で日傘をさす人を描いた油絵風の風景",
            "An oil-painting-style scene of a person with a parasol on a windy hill",
          )}
        />
      }
    >
      <button
        className="button button--primary button--block button--lg"
        type="button"
        onClick={() => nav.push({ name: "final" })}
      >
        {t("最終結果を見る", "See final results")}
      </button>
    </Stage>
  );
}

/** The participant's own ticket, stated as plainly as a receipt. */
function TicketCard(props: { room: Room; ticket: Bet }) {
  const { t } = useI18n();
  const { room, ticket } = props;
  const { controller } = useOpenRoom();
  const confirm = useConfirm();
  const labels = betTypeCopy(t);
  const open = room.currentRace.status === "betting";
  const pickIds = getBetPickIds(ticket);
  const multiplier = getDraftMultiplier(room, { type: ticket.type, contestantIds: pickIds });
  const estimate = Math.floor(ticket.amount * multiplier);

  const cancel = async () => {
    const ok = await confirm({
      title: t("ベットを取り消しますか？", "Cancel this bet?"),
      message: t("締切までなら、もう一度ベットできます。", "You can bet again until betting closes."),
      confirmLabel: t("取り消す", "Cancel bet"),
      tone: "danger",
    });
    if (ok) await controller.actions.cancelOwnBet();
  };

  return (
    <section className="card ticket-card" aria-labelledby="ticket-card-title">
      <header className="ticket-card__head">
        <h2 id="ticket-card-title">{t("あなたのチケット", "Your ticket")}</h2>
        <span className={open ? "status-pill status-pill--placed" : "status-pill status-pill--closed"}>
          {open ? t("受付済み", "Placed") : t("締切", "Closed")}
        </span>
      </header>
      <div className="ticket-card__picks">
        <span className="badge">{labels[ticket.type].title}</span>
        {pickIds.map((id, index) => {
          const contestant = room.contestants.find((item) => item.id === id);
          const lane = room.contestants.findIndex((item) => item.id === id) + 1;
          return (
            <span key={id} className="ticket-card__pick">
              {pickIds.length > 1 && (
                <small>{[t("1着", "1st"), t("2着", "2nd"), t("3着", "3rd")][index]}</small>
              )}
              {contestant && <Lane number={lane} accent={contestant.accent} small />}
              {contestant ? `${contestant.icon} ${contestant.name}` : "?"}
            </span>
          );
        })}
      </div>
      <dl className="ticket-card__math">
        <div>
          <dt>{t("ベット額", "Stake")}</dt>
          <dd>
            <Points value={ticket.amount} />
          </dd>
        </div>
        <div>
          <dt>{t("的中時の払戻", "Payout if it hits")}</dt>
          <dd>
            <Points value={estimate} />
            <small>×{multiplier.toFixed(1)}</small>
          </dd>
        </div>
      </dl>
      {room.settings.marketOdds && open && (
        <p className="form-help">
          {t(
            "人気で倍率が変わるため、払戻は締切時のオッズで確定します。",
            "Pool-based odds: the final multiplier is fixed when betting closes.",
          )}
        </p>
      )}
      {open && (
        <button className="button button--ghost button--block" type="button" onClick={() => void cancel()}>
          {t("取り消して選び直す", "Cancel and choose again")}
        </button>
      )}
    </section>
  );
}

function BettorStatus(props: { room: Room }) {
  const { t } = useI18n();
  const placed = new Set(props.room.currentRace.bets.map((bet) => bet.playerId));
  return (
    <section className="card bettor-status" aria-labelledby="bettor-status-title">
      <div className="bettor-status__head">
        <strong id="bettor-status-title">{t("ベット状況", "Bet status")}</strong>
        <span>
          {placed.size} / {props.room.players.length}
        </span>
      </div>
      <ul>
        {props.room.players.map((player) => (
          <li key={player.id} className={placed.has(player.id) ? "is-done" : undefined}>
            <Avatar emoji={player.emoji} accent={player.accent} size="sm" />
            <span>{player.name}</span>
            {placed.has(player.id) && (
              <Check size={14} strokeWidth={3} aria-label={t("ベット済み", "Bet placed")} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
