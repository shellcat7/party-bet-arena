import { Share2 } from "lucide-react";
import { BalanceChart } from "../../components/BalanceChart";
import { useNotify } from "../../components/feedback";
import { Avatar, Points, PageHeader, RankBadge } from "../../components/ui";
import { betTypeCopy, raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { shareText } from "../../lib/share";
import { gameHighlights, isGameOver, rankPlayers } from "../../lib/settlement";
import { useOpenRoom } from "../../state/AppContext";

export function FinalScreen() {
  const { t, formatNumber } = useI18n();
  const notify = useNotify();
  const { room, controller, nav } = useOpenRoom();
  const ranking = rankPlayers(room.players);
  const champions = ranking.filter((entry) => entry.rank === 1);
  const highlights = gameHighlights(room);
  const labels = betTypeCopy(t);
  const playerName = (id?: string) => room.players.find((player) => player.id === id)?.name ?? "?";
  const finished = isGameOver(room);

  const share = () => {
    const text = [
      t("{room} 最終結果", "{room}: final standings", { room: room.name }),
      ...ranking.map(
        ({ player, rank }) => `${rank}. ${player.emoji} ${player.name} ${formatNumber(player.balance)}pt`,
      ),
    ].join("\n");
    void shareText(text, room.name, () => notify.success(t("結果をコピーしました", "Results copied")));
  };

  return (
    <div className="screen final">
      <PageHeader
        title={finished ? t("最終結果", "Final results") : t("途中経過", "Standings so far")}
        subtitle={room.name}
        onBack={
          nav.canGoBack ? nav.back : () => nav.reset({ name: controller.role === "host" ? "home" : "bet" })
        }
        actions={
          <button
            className="icon-button"
            type="button"
            onClick={share}
            aria-label={t("結果を共有", "Share results")}
          >
            <Share2 size={18} />
          </button>
        }
      />

      {champions.length > 0 && (
        <section className="card champion" aria-labelledby="champion-title">
          <div className="champion__avatars">
            {champions.map(({ player }) => (
              <Avatar key={player.id} emoji={player.emoji} accent={player.accent} size="lg" />
            ))}
          </div>
          <div className="champion__body">
            <span className="badge badge--accent">
              {champions.length > 1 ? t("同率1位", "Tied for 1st") : t("1位", "1st place")}
            </span>
            <h2 id="champion-title">{champions.map(({ player }) => player.name).join("、")}</h2>
            <p>
              <Points value={champions[0].player.balance} />
              <span>
                {t("（開始時から ", "(")}
                <Points value={champions[0].player.balance - room.startingBalance} signed unit={false} />
                {t("）", " from start)")}
              </span>
            </p>
          </div>
        </section>
      )}

      <section className="card card--flush" aria-label={t("最終順位", "Final standings")}>
        <ol className="standings">
          {ranking.map(({ player, rank }) => (
            <li key={player.id} className={player.id === controller.me?.id ? "is-me" : undefined}>
              <RankBadge rank={rank} />
              <Avatar emoji={player.emoji} accent={player.accent} size="sm" />
              <span className="standings__name">
                <strong>{player.name}</strong>
              </span>
              <span className="standings__value">
                <Points value={player.balance} />
                <Points value={player.balance - room.startingBalance} signed unit={false} />
              </span>
            </li>
          ))}
        </ol>
      </section>

      {room.raceHistory.length > 0 && (
        <section className="card">
          <BalanceChart room={room} highlightId={controller.me?.id} />
        </section>
      )}

      {(highlights.biggestWin || highlights.sharpshooter || highlights.favouriteWinner) && (
        <section className="card" aria-labelledby="records-title">
          <h2 id="records-title" className="card__title">
            {t("記録", "Records")}
          </h2>
          <dl className="summary summary--stacked">
            {highlights.biggestWin && (
              <div>
                <dt>{t("最高配当", "Biggest payout")}</dt>
                <dd>
                  <strong>{playerName(highlights.biggestWin.playerId)}</strong>
                  <span>
                    <Points value={highlights.biggestWin.payout} />
                    {t("（{race}・{type} {odds}倍）", " ({race}, {type} ×{odds})", {
                      race: raceName(t, highlights.biggestWin.raceNumber),
                      type: labels[highlights.biggestWin.type].title,
                      odds: highlights.biggestWin.multiplier.toFixed(1),
                    })}
                  </span>
                </dd>
              </div>
            )}
            {highlights.sharpshooter && (
              <div>
                <dt>{t("的中数", "Most hits")}</dt>
                <dd>
                  <strong>{playerName(highlights.sharpshooter.playerId)}</strong>
                  <span>
                    {t(
                      "{tickets}枚中{hits}枚",
                      "{hits} of {tickets, plural, one {# ticket} other {# tickets}}",
                      { tickets: highlights.sharpshooter.tickets, hits: highlights.sharpshooter.hits },
                    )}
                  </span>
                </dd>
              </div>
            )}
            {highlights.favouriteWinner && (
              <div>
                <dt>{t("最多勝利", "Most wins")}</dt>
                <dd>
                  <strong>{highlights.favouriteWinner.name}</strong>
                  <span>
                    {t("{count}勝", "{count, plural, one {# win} other {# wins}}", {
                      count: highlights.favouriteWinner.wins,
                    })}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <div className="button-stack">
        <button className="button button--primary button--block button--lg" type="button" onClick={share}>
          {t("結果を共有", "Share results")}
        </button>
        <button
          className="button button--ghost button--block"
          type="button"
          onClick={controller.actions.closeRoom}
        >
          {t("ルーム一覧に戻る", "Back to rooms")}
        </button>
      </div>
    </div>
  );
}
