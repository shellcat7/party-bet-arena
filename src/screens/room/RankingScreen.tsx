import { ArrowDown, ArrowUp, ChevronRight, Trophy } from "lucide-react";
import { Avatar, Points, EmptyState, RankBadge } from "../../components/ui";
import { useI18n } from "../../i18n/i18n";
import { isGameOver, rankMovement, rankPlayers } from "../../lib/settlement";
import { useOpenRoom } from "../../state/AppContext";

function Movement(props: { value?: number }) {
  const { t } = useI18n();
  if (!props.value)
    return (
      <span className="movement movement--flat" aria-label={t("順位変動なし", "No change")}>
        —
      </span>
    );
  const up = props.value > 0;
  return (
    <span
      className={up ? "movement movement--up" : "movement movement--down"}
      aria-label={
        up
          ? t("{count}つ上昇", "Up {count}", { count: props.value })
          : t("{count}つ下降", "Down {count}", { count: -props.value })
      }
    >
      {up ? <ArrowUp size={12} strokeWidth={3} /> : <ArrowDown size={12} strokeWidth={3} />}
      {Math.abs(props.value)}
    </span>
  );
}

export function RankingScreen() {
  const { t } = useI18n();
  const { room, controller, nav } = useOpenRoom();
  const ranking = rankPlayers(room.players);
  const movement = rankMovement(room);
  const lastRace = room.raceHistory.at(-1);
  const lastDelta = new Map(lastRace?.payouts.map((row) => [row.playerId, row.delta]));
  const meId = controller.me?.id;

  if (ranking.length === 0) {
    return (
      <div className="screen">
        <EmptyState icon={<Trophy size={28} />} title={t("まだ参加者がいません", "No bettors yet")}>
          {t("参加者が入るとランキングが表示されます。", "The leaderboard appears once people join.")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="section-heading">
        <h1>{t("ランキング", "Leaderboard")}</h1>
        <p>
          {room.raceHistory.length === 0
            ? t("最初のレースが終わると順位が動きます", "Ranks move after the first race")
            : isGameOver(room)
              ? t("最終結果", "Final standings")
              : t("第{n}レース終了時点", "After race {n}", { n: room.raceHistory.length })}
        </p>
      </header>

      {isGameOver(room) && (
        <button className="callout" type="button" onClick={() => nav.push({ name: "final" })}>
          <Trophy size={20} aria-hidden="true" />
          <span>{t("最終結果を見る", "View final results")}</span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}

      <section className="card card--flush" aria-label={t("全員の順位", "Full standings")}>
        <ol className="standings">
          {ranking.map(({ player, rank }) => {
            const delta = lastDelta.get(player.id);
            return (
              <li key={player.id} className={player.id === meId ? "is-me" : undefined}>
                <RankBadge rank={rank} />
                <Avatar emoji={player.emoji} accent={player.accent} size="sm" />
                <span className="standings__name">
                  <strong>
                    {player.name}
                    {player.id === meId && <em>{t("あなた", "You")}</em>}
                  </strong>
                  {player.isOffline && <small>{t("幹事が代行", "Bets via host")}</small>}
                </span>
                <span className="standings__value">
                  <Points value={player.balance} />
                  {delta !== undefined && delta !== 0 && <Points value={delta} signed unit={false} />}
                </span>
                <Movement value={movement.get(player.id)} />
              </li>
            );
          })}
        </ol>
      </section>

      {controller.role === "host" && room.raceHistory.length > 0 && (
        <button
          className="button button--secondary button--block"
          type="button"
          onClick={() => nav.push({ name: "history" })}
        >
          {t("レース履歴", "Race history")}
        </button>
      )}
    </div>
  );
}
