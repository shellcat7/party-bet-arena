import type { ReactNode } from "react";
import { Pass, PassPicks, PassStub } from "../../components/BetPass";
import type { PassPick, PassStatus } from "../../components/BetPass";
import { useConfirm } from "../../components/feedback";
import { Points } from "../../components/ui";
import { betTypeCopy, landscapeLabel, raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { getDraftMultiplier, getPlayerBets } from "../../lib/betting";
import { frameColor } from "../../lib/constants";
import { getBetPickIds } from "../../lib/odds";
import { biomeForRace, ticketCode } from "../../lib/pass";
import { isGameOver } from "../../lib/settlement";
import type { BetType, Room } from "../../lib/types";
import { useOpenRoom } from "../../state/AppContext";
import { BetScreen } from "./BetScreen";

/**
 * A participant's race tab follows the race. Once they have a ticket, the ticket is all they see,
 * as in Wallet: its stub says what is happening and holds the one action there is.
 *
 *   betting, no ticket  → bet slip
 *   betting, ticket     → the ticket: placed, who is still to bet, cancel
 *   closed              → the ticket: racing, waiting for the result
 *   settled             → the ticket stamped hit or miss, a link to the result
 *   game over           → link to the final results
 */
export function PlayerRaceScreen() {
  const { room, controller } = useOpenRoom();
  const race = room.currentRace;
  const me = controller.me;
  const ticket = me ? getPlayerBets(room, me.id)[0] : undefined;

  if (race.status === "betting" && !ticket) return <BetScreen />;
  if (isGameOver(room) && race.status === "settled") return <GameOverScreen room={room} />;
  return <TicketScreen room={room} playerId={me?.id} />;
}

function TicketScreen(props: { room: Room; playerId?: string }) {
  const { t } = useI18n();
  const { controller, nav } = useOpenRoom();
  const confirm = useConfirm();
  const { room, playerId } = props;
  const race = room.currentRace;
  const current = playerId ? getPlayerBets(room, playerId)[0] : undefined;
  const entry = room.raceHistory.find((item) => item.raceId === race.id);
  const result = race.status === "settled" ? entry?.bets.find((bet) => bet.playerId === playerId) : undefined;
  const seeResult = () => nav.push({ name: "race", raceId: race.id });

  const cancel = async () => {
    const ok = await confirm({
      title: t("ベットを取り消しますか？", "Cancel this bet?"),
      message: t("締切までなら、もう一度ベットできます。", "You can bet again until betting closes."),
      confirmLabel: t("取り消す", "Cancel bet"),
      tone: "danger",
    });
    if (ok) await controller.actions.cancelOwnBet();
  };

  // The screen's name, for assistive technology; the ticket carries everything visible.
  const heading = {
    betting: t("ベットしました", "You're in"),
    closed: t("レース中", "Race in progress"),
    settled: !result
      ? t("結果が出ました", "The result is in")
      : result.voided
        ? t("このチケットは無効になりました", "This ticket was voided")
        : result.hit
          ? t("的中しました", "Your ticket hit")
          : t("今回は外れました", "No luck this time"),
  }[race.status];

  let ticket: ReactNode;
  if (race.status === "settled" && result && entry) {
    ticket = (
      <TicketPass
        room={room}
        raceNumber={entry.raceNumber}
        contestants={entry.contestants}
        ticket={result}
        multiplier={result.multiplier}
        status={result.voided ? "void" : result.hit ? "hit" : "miss"}
        payout={result.payout}
        action={
          <button className="pass-stub__action" type="button" onClick={seeResult}>
            {t("結果を見る", "View result")}
          </button>
        }
      />
    );
  } else if (race.status !== "settled" && current) {
    const pickIds = getBetPickIds(current);
    const multiplier = getDraftMultiplier(room, { type: current.type, contestantIds: pickIds });
    const waitingFor = room.players.length - new Set(race.bets.map((bet) => bet.playerId)).size;
    ticket = (
      <TicketPass
        room={room}
        raceNumber={race.number}
        contestants={room.contestants}
        ticket={{ ...current, contestantIds: pickIds }}
        multiplier={multiplier}
        status={race.status === "betting" ? "placed" : "closed"}
        detail={
          race.status === "betting"
            ? waitingFor > 0
              ? t(
                  "あと{count}人のベットを待っています",
                  "{count, plural, one {Waiting for # more bettor} other {Waiting for # more bettors}}",
                  { count: waitingFor },
                )
              : t("全員がベットしました", "Everyone has bet")
            : t("結果を待っています", "Waiting for the result")
        }
        action={
          race.status === "betting" ? (
            <button className="pass-stub__action" type="button" onClick={() => void cancel()}>
              {t("取り消す", "Cancel bet")}
            </button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="screen race-screen">
      <h1 className="sr-only">{heading}</h1>
      {ticket ?? (
        <NoTicket
          raceNumber={race.number}
          message={
            race.status === "settled"
              ? t("このレースはベットしていません。", "You didn't bet on this race.")
              : t(
                  "このレースはベットしていません。結果が出るまでお待ちください。",
                  "You didn't bet on this race. The result will appear here.",
                )
          }
          action={
            race.status === "settled" ? (
              <button className="button button--secondary" type="button" onClick={seeResult}>
                {t("結果を見る", "View result")}
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

function NoTicket(props: { raceNumber: number; message: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="no-ticket" aria-label={raceName(t, props.raceNumber)}>
      <strong>{raceName(t, props.raceNumber)}</strong>
      <p>{props.message}</p>
      {props.action}
    </section>
  );
}

function GameOverScreen(props: { room: Room }) {
  const { t } = useI18n();
  const { nav } = useOpenRoom();
  return (
    <div className="screen race-screen">
      <h1 className="sr-only">{t("大会が終わりました", "The tournament is over")}</h1>
      <section className="no-ticket">
        <strong>
          {t("全{max}レース終了", "All {max} races finished", { max: props.room.settings.maxRaces })}
        </strong>
        <p>{t("最終順位と記録を確認できます。", "See the final standings and records.")}</p>
        <button
          className="button button--primary button--lg"
          type="button"
          onClick={() => nav.push({ name: "final" })}
        >
          {t("最終結果を見る", "See final results")}
        </button>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------------- ticket */

function TicketPass(props: {
  room: Room;
  raceNumber: number;
  contestants: Array<{ id: string; name: string; icon: string }>;
  ticket: {
    id: string;
    playerId: string;
    type: BetType;
    contestantIds: string[];
    amount: number;
    createdAt: number;
  };
  multiplier: number;
  status: PassStatus;
  payout?: number;
  detail?: ReactNode;
  action?: ReactNode;
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
      accent: frameColor(lane + 1),
      position: ticket.contestantIds.length > 1 ? positions[index] : undefined,
    };
  });
  const bettor = room.players.find((player) => player.id === ticket.playerId)?.name ?? "";
  const estimate = status === "placed" && room.settings.marketOdds;

  const stubs: Record<PassStatus, ReactNode> = {
    placed: (
      <PassStub status="placed" title={t("受付済み", "Placed")} detail={props.detail} action={props.action} />
    ),
    closed: (
      <PassStub
        status="closed"
        title={t("レース中", "Race in progress")}
        detail={props.detail}
        action={props.action}
      />
    ),
    hit: (
      <PassStub
        status="hit"
        title={t("的中", "Hit")}
        value={<Points value={props.payout ?? 0} />}
        action={props.action}
      />
    ),
    miss: (
      <PassStub
        status="miss"
        title={t("不的中", "Miss")}
        value={<Points value={-ticket.amount} signed />}
        action={props.action}
      />
    ),
    void: (
      <PassStub
        status="void"
        title={t("無効（返金）", "Void (refunded)")}
        value={<Points value={ticket.amount} />}
        action={props.action}
      />
    ),
  };

  return (
    <Pass
      accent={picks[0]?.accent ?? frameColor(1)}
      brand={t("ランクパーティ", "Rank Party")}
      label={t("{race}のチケット", "Ticket for {race}", { race: raceName(t, props.raceNumber) })}
      headerFields={[
        { label: t("レース", "Race"), value: props.raceNumber },
        { label: t("券種", "Type"), value: labels[ticket.type].title },
      ]}
      primary={<PassPicks picks={picks} />}
      art={{
        biome: biomeForRace(props.raceNumber),
        label: landscapeLabel(t, biomeForRace(props.raceNumber)),
        seed: 1875 + props.raceNumber,
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
      stub={stubs[status]}
    />
  );
}
