import { Crown, Share2, Sparkles, Target, Zap } from "lucide-react";
import { BalanceChart } from "../../components/BalanceChart";
import { useNotify } from "../../components/feedback";
import { Avatar, Coins, PageHeader, RankBadge } from "../../components/ui";
import { betTypeCopy, raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { shareText } from "../../lib/share";
import { gameHighlights, isGameOver, rankPlayers } from "../../lib/settlement";
import { useOpenRoom } from "../../state/AppContext";

const confettiColors = ["#ffc400", "#2a78d6", "#eb6834", "#1baf7a", "#e87ba4", "#6250d6"];

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
      t(`🏆 ${room.name} 最終結果`, `🏆 ${room.name} — final standings`),
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
            aria-label={t("結果をシェア", "Share results")}
          >
            <Share2 size={18} />
          </button>
        }
      />

      {champions.length > 0 && (
        <section className="champion" aria-labelledby="champion-title">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 28 }, (_, index) => (
              <i
                key={index}
                style={{
                  left: `${(index * 37) % 100}%`,
                  background: confettiColors[index % confettiColors.length],
                  animationDelay: `${(index % 7) * 0.18}s`,
                  animationDuration: `${2.6 + (index % 5) * 0.35}s`,
                }}
              />
            ))}
          </div>
          <Crown className="champion__crown" size={34} aria-hidden="true" />
          <div className="champion__avatars">
            {champions.map(({ player }) => (
              <Avatar key={player.id} emoji={player.emoji} accent={player.accent} size="xl" />
            ))}
          </div>
          <p className="eyebrow">
            {champions.length > 1 ? t("同率優勝", "Joint champions") : t("優勝", "Champion")}
          </p>
          <h2 id="champion-title">{champions.map(({ player }) => player.name).join(" & ")}</h2>
          <p className="champion__score">
            <Coins value={champions[0].player.balance} />
            <span>
              {t("開始時から", "from start")}{" "}
              <Coins value={champions[0].player.balance - room.startingBalance} signed />
            </span>
          </p>
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
                <Coins value={player.balance} />
                <Coins value={player.balance - room.startingBalance} signed unit={false} />
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

      <section className="highlights" aria-label={t("ハイライト", "Highlights")}>
        {highlights.biggestWin && (
          <article>
            <Zap size={20} aria-hidden="true" />
            <small>{t("最高配当", "Biggest payout")}</small>
            <strong>{playerName(highlights.biggestWin.playerId)}</strong>
            <span>
              <Coins value={highlights.biggestWin.payout} /> · {labels[highlights.biggestWin.type].title} ×
              {highlights.biggestWin.multiplier.toFixed(2)} · {raceName(t, highlights.biggestWin.raceNumber)}
            </span>
          </article>
        )}
        {highlights.sharpshooter && (
          <article>
            <Target size={20} aria-hidden="true" />
            <small>{t("的中王", "Sharpshooter")}</small>
            <strong>{playerName(highlights.sharpshooter.playerId)}</strong>
            <span>
              {t(
                `${highlights.sharpshooter.tickets}枚中${highlights.sharpshooter.hits}枚的中`,
                `${highlights.sharpshooter.hits} of ${highlights.sharpshooter.tickets} tickets hit`,
              )}
            </span>
          </article>
        )}
        {highlights.favouriteWinner && (
          <article>
            <Sparkles size={20} aria-hidden="true" />
            <small>{t("最多勝の対戦者", "Most wins")}</small>
            <strong>
              {highlights.favouriteWinner.icon} {highlights.favouriteWinner.name}
            </strong>
            <span>
              {t(`${highlights.favouriteWinner.wins}勝`, `${highlights.favouriteWinner.wins} wins`)}
            </span>
          </article>
        )}
      </section>

      <div className="button-stack">
        <button className="button button--primary button--block button--lg" type="button" onClick={share}>
          <Share2 size={18} />
          {t("結果をシェア", "Share results")}
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
