import { Share2, Trophy } from "lucide-react";
import { useNotify } from "../../components/feedback";
import { shareText } from "../../lib/share";
import { Avatar, Points, EmptyState, Lane, PageHeader, RankBadge } from "../../components/ui";
import { betTypeCopy, raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { isGameOver } from "../../lib/settlement";
import type { RaceHistoryEntry, Room } from "../../lib/types";
import { useOpenRoom } from "../../state/AppContext";
import { useCorrectResult } from "./useCorrectResult";

export function RaceResultScreen(props: { raceId?: string }) {
  const { t, formatDateTime } = useI18n();
  const notify = useNotify();
  const { room, controller, nav } = useOpenRoom();
  const correctResult = useCorrectResult();
  const entry = props.raceId
    ? room.raceHistory.find((item) => item.raceId === props.raceId)
    : room.raceHistory.at(-1);

  if (!entry) {
    return (
      <div className="screen">
        <PageHeader title={t("レース結果", "Race result")} onBack={nav.back} />
        <EmptyState icon={<Trophy size={28} />} title={t("結果が見つかりません", "Result not found")} />
      </div>
    );
  }

  const isLatest = entry.raceId === room.currentRace.id && room.currentRace.status === "settled";
  const myRow = controller.me ? entry.payouts.find((row) => row.playerId === controller.me?.id) : undefined;
  const contestantName = (id: string) => entry.contestants.find((contestant) => contestant.id === id);

  const share = () => {
    const lines = [
      `${room.name} — ${raceName(t, entry.raceNumber)}`,
      ...entry.resultIds
        .slice(0, 3)
        .map(
          (id, index) => `${index + 1}. ${contestantName(id)?.icon ?? ""} ${contestantName(id)?.name ?? ""}`,
        ),
    ];
    void shareText(lines.join("\n"), room.name, () =>
      notify.success(t("結果をコピーしました", "Result copied")),
    );
  };

  return (
    <div className="screen">
      <PageHeader
        title={t(`${raceName(t, entry.raceNumber)}の結果`, `${raceName(t, entry.raceNumber)} result`)}
        subtitle={formatDateTime(entry.settledAt)}
        onBack={
          nav.canGoBack ? nav.back : () => nav.replace({ name: controller.role === "host" ? "home" : "bet" })
        }
        actions={
          <button
            className="icon-button"
            type="button"
            onClick={share}
            aria-label={t("結果を共有", "Share result")}
          >
            <Share2 size={18} />
          </button>
        }
      />

      {myRow && <PersonalResult entry={entry} playerId={myRow.playerId} />}

      <section className="card" aria-labelledby="finish-title">
        <h2 id="finish-title" className="card__title">
          {t("着順", "Finishing order")}
        </h2>
        <ol className="finish-order">
          {entry.resultIds.map((id, index) => {
            const contestant = contestantName(id);
            const lane = entry.contestants.findIndex((item) => item.id === id) + 1;
            return (
              <li key={id} className={index < 3 ? "is-podium" : undefined}>
                <RankBadge rank={index + 1} />
                <Lane number={lane} accent={contestant?.accent ?? "#999"} small />
                <span className="finish-order__icon" aria-hidden="true">
                  {contestant?.icon}
                </span>
                <strong>{contestant?.name ?? "?"}</strong>
                <small>{contestant ? `${contestant.odds.toFixed(1)}${t("倍", "x")}` : ""}</small>
              </li>
            );
          })}
        </ol>
      </section>

      <PayoutTable room={room} entry={entry} highlightId={controller.me?.id} />
      <TicketResults room={room} entry={entry} />

      {controller.role === "host" && isLatest && (
        <button
          className="button button--ghost button--block"
          type="button"
          onClick={() => void correctResult()}
        >
          {t("着順を訂正する", "Correct the finishing order")}
        </button>
      )}

      {controller.role === "host" && isLatest && (
        <div className="sticky-actions">
          {isGameOver(room) ? (
            <button
              className="button button--primary button--block button--lg"
              type="button"
              onClick={() => nav.replace({ name: "final" })}
            >
              {t("最終結果を表示", "Show final results")}
            </button>
          ) : (
            <button
              className="button button--primary button--block button--lg"
              type="button"
              disabled={controller.busy}
              onClick={async () => {
                if (await controller.actions.nextRace()) nav.reset({ name: "home" });
              }}
            >
              {t(
                `${raceName(t, entry.raceNumber + 1)}を始める`,
                `Start ${raceName(t, entry.raceNumber + 1)}`,
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PersonalResult(props: { entry: RaceHistoryEntry; playerId: string }) {
  const { t } = useI18n();
  const row = props.entry.payouts.find((item) => item.playerId === props.playerId);
  if (!row || row.stake === 0) {
    return (
      <p className="notice" role="status">
        {t("このレースではベットしていません。", "You didn't bet on this race.")}
      </p>
    );
  }
  const won = row.hits > 0;
  return (
    <section className={won ? "result-summary result-summary--hit" : "result-summary"} aria-live="polite">
      <div>
        <span className={won ? "badge badge--success" : "badge"}>
          {won ? t("的中", "Hit") : t("不的中", "Miss")}
        </span>
        <strong>
          <Points value={row.delta} signed />
        </strong>
      </div>
      <dl>
        <dt>{t("残高", "Balance")}</dt>
        <dd>
          <Points value={row.balanceAfter} />
        </dd>
      </dl>
    </section>
  );
}

function PayoutTable(props: { room: Room; entry: RaceHistoryEntry; highlightId?: string }) {
  const { t } = useI18n();
  const rows = [...props.entry.payouts].sort((a, b) => b.delta - a.delta);
  return (
    <section className="card" aria-labelledby="payout-title">
      <h2 id="payout-title" className="card__title">
        {t("精算", "Payouts")}
      </h2>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{t("参加者", "Bettor")}</th>
            <th scope="col">{t("ベット", "Stake")}</th>
            <th scope="col">{t("払戻", "Payout")}</th>
            <th scope="col">{t("収支", "Net")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const player = props.room.players.find((item) => item.id === row.playerId);
            return (
              <tr key={row.playerId} className={row.playerId === props.highlightId ? "is-me" : undefined}>
                <th scope="row">
                  <span className="cell-person">
                    {player && <Avatar emoji={player.emoji} accent={player.accent} size="sm" />}
                    {player?.name ?? t("退出した参加者", "Former bettor")}
                  </span>
                </th>
                <td>
                  <Points value={row.stake} unit={false} />
                </td>
                <td>
                  <Points value={row.payout} unit={false} />
                </td>
                <td>
                  <Points value={row.delta} signed unit={false} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function TicketResults(props: { room: Room; entry: RaceHistoryEntry }) {
  const { t } = useI18n();
  const labels = betTypeCopy(t);
  if (!props.entry.bets.length) return null;
  return (
    <section className="card" aria-labelledby="tickets-result-title">
      <h2 id="tickets-result-title" className="card__title">
        {t("チケット明細", "Tickets")}
      </h2>
      <ul className="ticket-results">
        {props.entry.bets.map((bet) => {
          const player = props.room.players.find((item) => item.id === bet.playerId);
          return (
            <li key={bet.id} className={bet.hit ? "is-hit" : undefined}>
              {player && <Avatar emoji={player.emoji} accent={player.accent} size="sm" />}
              <span className="ticket-results__what">
                <strong>{player?.name ?? "?"}</strong>
                <small>
                  {labels[bet.type].title} · <Points value={bet.amount} /> · ×{bet.multiplier.toFixed(1)}
                </small>
              </span>
              <span className="lane-row">
                {bet.contestantIds.map((id) => {
                  const index = props.entry.contestants.findIndex((contestant) => contestant.id === id);
                  return index >= 0 ? (
                    <Lane key={id} number={index + 1} accent={props.entry.contestants[index].accent} small />
                  ) : null;
                })}
              </span>
              <span className={bet.hit ? "badge badge--success" : "badge"}>
                {bet.voided
                  ? t("無効（返金）", "Void (refunded)")
                  : bet.hit
                    ? t("的中", "Hit")
                    : t("不的中", "Miss")}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
