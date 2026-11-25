import type { ReactNode } from "react";
import { History, ListChecks, RotateCcw, Trophy, Users } from "lucide-react";
import { Pass, PassPicks, PassStub } from "../../components/BetPass";
import type { PassPick, PassStatus } from "../../components/BetPass";
import { useConfirm } from "../../components/feedback";
import { Tile } from "../../components/Tile";
import { Avatar, PhaseTag, Points } from "../../components/ui";
import type { PhaseTone } from "../../components/ui";
import { betTypeCopy, raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { getDraftMultiplier, getPlayerBets } from "../../lib/betting";
import { getBetPickIds } from "../../lib/odds";
import { biomeForRace, ticketCode } from "../../lib/pass";
import { isGameOver, rankPlayers } from "../../lib/settlement";
import type { Bet, BetType, Room } from "../../lib/types";
import { useOpenRoom } from "../../state/AppContext";
import { BetScreen } from "./BetScreen";

/**
 * A participant's race tab follows the race. Each phase has one screen and at most one thing to
 * do; the ticket itself, laid out like a boarding pass, is the centre of it:
 *
 *   betting, no ticket  → bet slip
 *   betting, ticket     → the ticket, "placed"; who is still to bet; cancel
 *   closed              → the ticket, "racing"; nothing to do until the result arrives
 *   settled             → the ticket stamped hit or miss, waiting for the next race
 *   game over           → link to the final results
 */
export function PlayerRaceScreen() {
  const { room, controller } = useOpenRoom();
  const race = room.currentRace;
  const me = controller.me;
  const ticket = me ? getPlayerBets(room, me.id)[0] : undefined;

  if (race.status === "betting") {
    return ticket ? <PlacedScreen room={room} ticket={ticket} /> : <BetScreen />;
  }
  if (race.status === "closed") return <RacingScreen room={room} ticket={ticket} />;
  if (isGameOver(room)) return <GameOverScreen room={room} />;
  return <SettledScreen room={room} playerId={me?.id} />;
}

function RaceScreen(props: {
  tone: PhaseTone;
  phase: string;
  title: string;
  message: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="screen race-screen">
      <header className="race-screen__head">
        <PhaseTag tone={props.tone}>{props.phase}</PhaseTag>
        <h1>{props.title}</h1>
        <p role="status">{props.message}</p>
      </header>
      {props.children}
    </div>
  );
}

function PlacedScreen(props: { room: Room; ticket: Bet }) {
  const { t } = useI18n();
  const { room, ticket } = props;
  const { controller } = useOpenRoom();
  const confirm = useConfirm();
  const placed = new Set(room.currentRace.bets.map((bet) => bet.playerId));
  const waitingFor = room.players.length - placed.size;

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
    <RaceScreen
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
    >
      <CurrentTicket room={room} ticket={ticket} status="placed" />
      <div className="tiles">
        <Tile
          icon={<Users size={16} />}
          tone="green"
          title={t("ベット状況", "Bet status")}
          detail={t("{count} / {max}人", "{count} / {max}", { count: placed.size, max: room.players.length })}
        >
          <ul className="tile__avatars">
            {room.players.map((player) => (
              <li
                key={player.id}
                className={placed.has(player.id) ? "is-done" : undefined}
                title={player.name}
              >
                <Avatar emoji={player.emoji} accent={player.accent} size="sm" />
                <span className="sr-only">
                  {player.name}
                  {placed.has(player.id) ? `: ${t("ベット済み", "Bet placed")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Tile>
        <Tile
          icon={<RotateCcw size={16} />}
          tone="gray"
          title={t("取り消して選び直す", "Cancel and choose again")}
          detail={t("締切までは変更できます", "Possible until betting closes")}
          onClick={() => void cancel()}
        />
      </div>
    </RaceScreen>
  );
}

function RacingScreen(props: { room: Room; ticket?: Bet }) {
  const { t } = useI18n();
  const { room, ticket } = props;
  return (
    <RaceScreen
      tone="live"
      phase={raceName(t, room.currentRace.number)}
      title={t("レース中", "Race in progress")}
      message={t(
        "ベットは締め切られました。幹事が着順を入力すると、結果がこの画面に届きます。",
        "Betting is closed. The result appears here as soon as the host enters the finishing order.",
      )}
    >
      {ticket ? (
        <CurrentTicket room={room} ticket={ticket} status="closed" />
      ) : (
        <p className="no-ticket">{t("このレースはベットしていません。", "You didn't bet on this race.")}</p>
      )}
      <StandingTiles room={room} />
    </RaceScreen>
  );
}

function SettledScreen(props: { room: Room; playerId?: string }) {
  const { t } = useI18n();
  const { nav } = useOpenRoom();
  const { room, playerId } = props;
  const entry = room.raceHistory.find((item) => item.raceId === room.currentRace.id);
  const result = entry?.bets.find((bet) => bet.playerId === playerId);
  const title = !result
    ? t("結果が出ました", "The result is in")
    : result.voided
      ? t("このチケットは無効になりました", "This ticket was voided")
      : result.hit
        ? t("的中しました", "Your ticket hit")
        : t("今回は外れました", "No luck this time");

  return (
    <RaceScreen
      tone="result"
      phase={raceName(t, room.currentRace.number)}
      title={title}
      message={t(
        "次のレースが始まると、この画面でベットできます。",
        "You can bet here as soon as the next race opens.",
      )}
    >
      {result && entry && (
        <TicketPass
          room={room}
          raceNumber={entry.raceNumber}
          contestants={entry.contestants}
          ticket={{ ...result, contestantIds: result.contestantIds }}
          multiplier={result.multiplier}
          payout={result.payout}
          status={result.voided ? "void" : result.hit ? "hit" : "miss"}
        />
      )}
      <div className="tiles">
        <Tile
          icon={<ListChecks size={16} />}
          tone="purple"
          title={t("結果と払戻", "Result and payouts")}
          detail={t("着順と全員の収支", "Finishing order and everyone's result")}
          onClick={() => nav.push({ name: "race", raceId: room.currentRace.id })}
        />
        <RankTile room={room} playerId={playerId} />
      </div>
    </RaceScreen>
  );
}

function GameOverScreen(props: { room: Room }) {
  const { t } = useI18n();
  const { nav } = useOpenRoom();
  return (
    <RaceScreen
      tone="result"
      phase={t("全{max}レース終了", "All {max} races finished", { max: props.room.settings.maxRaces })}
      title={t("大会が終わりました", "The tournament is over")}
      message={t("最終順位と記録を確認できます。", "See the final standings and records.")}
    >
      <button
        className="button button--primary button--block button--lg"
        type="button"
        onClick={() => nav.push({ name: "final" })}
      >
        {t("最終結果を見る", "See final results")}
      </button>
    </RaceScreen>
  );
}

/* -------------------------------------------------------------------------------- tickets */

function CurrentTicket(props: { room: Room; ticket: Bet; status: PassStatus }) {
  const { room, ticket } = props;
  const pickIds = getBetPickIds(ticket);
  const multiplier = getDraftMultiplier(room, { type: ticket.type, contestantIds: pickIds });
  return (
    <TicketPass
      room={room}
      raceNumber={room.currentRace.number}
      contestants={room.contestants}
      ticket={{ ...ticket, contestantIds: pickIds }}
      multiplier={multiplier}
      payout={Math.floor(ticket.amount * multiplier)}
      status={props.status}
    />
  );
}

function TicketPass(props: {
  room: Room;
  raceNumber: number;
  contestants: Array<{ id: string; name: string; icon: string; accent: string }>;
  ticket: {
    id: string;
    playerId: string;
    type: BetType;
    contestantIds: string[];
    amount: number;
    createdAt: number;
  };
  multiplier: number;
  payout: number;
  status: PassStatus;
}) {
  const { t, formatTime } = useI18n();
  const { room, ticket, status } = props;
  const labels = betTypeCopy(t);
  const positions = [t("1着", "1st"), t("2着", "2nd"), t("3着", "3rd")];
  const picks: PassPick[] = ticket.contestantIds.map((id, index) => {
    const lane = props.contestants.findIndex((contestant) => contestant.id === id);
    const contestant = props.contestants[lane];
    return {
      lane: lane + 1,
      name: contestant?.name ?? "?",
      icon: contestant?.icon ?? "",
      accent: contestant?.accent ?? "#6b7280",
      position: ticket.contestantIds.length > 1 ? positions[index] : undefined,
    };
  });
  const bettor = room.players.find((player) => player.id === ticket.playerId)?.name ?? "";
  const estimate = status === "placed" && room.settings.marketOdds;

  const stub: Record<PassStatus, ReactNode> = {
    placed: (
      <PassStub
        status="placed"
        title={t("受付済み", "Placed")}
        detail={
          estimate
            ? t("倍率は締切時に確定します", "The odds are fixed when betting closes")
            : t("締め切られるとレースが始まります", "The race starts when betting closes")
        }
      />
    ),
    closed: (
      <PassStub
        status="closed"
        title={t("レース中", "Race in progress")}
        detail={t("結果を待っています", "Waiting for the result")}
      />
    ),
    hit: (
      <PassStub
        status="hit"
        title={t("的中", "Hit")}
        detail={t("払戻", "Payout")}
        value={<Points value={props.payout} />}
      />
    ),
    miss: (
      <PassStub status="miss" title={t("不的中", "Miss")} value={<Points value={-ticket.amount} signed />} />
    ),
    void: (
      <PassStub
        status="void"
        title={t("無効（返金）", "Void (refunded)")}
        value={<Points value={ticket.amount} />}
      />
    ),
  };

  return (
    <Pass
      accent={picks[0]?.accent ?? "#6b7280"}
      brand={t("ランクパーティ", "Rank Party")}
      label={t("{race}のチケット", "Ticket for {race}", { race: raceName(t, props.raceNumber) })}
      headerFields={[
        { label: t("レース", "Race"), value: props.raceNumber },
        { label: t("券種", "Type"), value: labels[ticket.type].title },
      ]}
      primary={<PassPicks picks={picks} />}
      art={{
        biome: biomeForRace(props.raceNumber),
        label: t("油絵風の風景", "An oil-painting-style landscape"),
        animate: status === "closed",
      }}
      fields={[
        { label: t("ベット額", "Stake"), value: <Points value={ticket.amount} /> },
        { label: t("倍率", "Odds"), value: `×${props.multiplier.toFixed(1)}` },
        {
          label: estimate ? t("的中時（目安）", "If it hits (est.)") : t("的中時", "If it hits"),
          value: <Points value={Math.floor(ticket.amount * props.multiplier)} />,
          align: "end",
        },
      ]}
      auxFields={[
        { label: t("名前", "Name"), value: bettor },
        { label: t("受付", "Placed at"), value: formatTime(ticket.createdAt) },
        { label: t("チケット番号", "Ticket no."), value: ticketCode(ticket.id), align: "end" },
      ]}
      stub={stub[status]}
    />
  );
}

/* ---------------------------------------------------------------------------------- tiles */

function RankTile(props: { room: Room; playerId?: string }) {
  const { t } = useI18n();
  const { nav } = useOpenRoom();
  const rank = rankPlayers(props.room.players).find((item) => item.player.id === props.playerId)?.rank;
  return (
    <Tile
      icon={<Trophy size={16} />}
      tone="blue"
      title={t("順位", "Standings")}
      detail={
        rank
          ? t("いま{rank}位（{count}人中）", "Rank {rank} of {count}", {
              rank,
              count: props.room.players.length,
            })
          : undefined
      }
      onClick={() => nav.replace({ name: "ranking" })}
    />
  );
}

function StandingTiles(props: { room: Room }) {
  const { t } = useI18n();
  const { controller, nav } = useOpenRoom();
  return (
    <div className="tiles">
      <RankTile room={props.room} playerId={controller.me?.id} />
      <Tile
        icon={<History size={16} />}
        tone="purple"
        title={t("これまでの結果", "Earlier races")}
        detail={t("{count}レース確定", "{count, plural, one {# race settled} other {# races settled}}", {
          count: props.room.raceHistory.length,
        })}
        onClick={() => nav.replace({ name: "history" })}
      />
    </div>
  );
}
