import { Check } from "lucide-react";
import { useConfirm } from "../../components/feedback";
import { Avatar, Points, Lane } from "../../components/ui";
import { raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { isFinalRace, isGameOver, rankPlayers } from "../../lib/settlement";
import type { RaceStatus } from "../../lib/types";
import { useOpenRoom } from "../../state/AppContext";
import { useCorrectResult } from "./useCorrectResult";

const phases: RaceStatus[] = ["betting", "closed", "settled"];

export function HostHomeScreen() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { room, controller, nav } = useOpenRoom();
  const { actions, busy } = controller;
  const race = room.currentRace;
  const bettorsWithTickets = new Set(race.bets.map((bet) => bet.playerId));
  const pool = race.bets.reduce((sum, bet) => sum + bet.amount, 0);
  const gameOver = isGameOver(room);
  const progress = Math.round(
    ((race.number - (race.status === "settled" ? 0 : 1)) / room.settings.maxRaces) * 100,
  );
  const phaseIndex = phases.indexOf(race.status);
  const leaders = rankPlayers(room.players).slice(0, 3);
  const correctResult = useCorrectResult();

  const close = async () => {
    const missing = room.players.filter((player) => !bettorsWithTickets.has(player.id));
    if (missing.length > 0) {
      const ok = await confirm({
        title: t("ベットを締め切りますか？", "Close betting?"),
        message: t(
          `まだ${missing.map((player) => player.name).join("、")}がベットしていません。`,
          `${missing.map((player) => player.name).join(", ")} haven't bet yet.`,
        ),
        confirmLabel: t("締め切る", "Close betting"),
      });
      if (!ok) return;
    }
    await actions.closeBetting();
  };

  const next = async () => {
    if (await actions.nextRace()) nav.replace({ name: "home" });
  };

  return (
    <div className="screen">
      <section className="card stage-card" aria-labelledby="stage-title">
        <div className="stage-card__head">
          <h2 id="stage-title">
            {raceName(t, race.number)}
            <small>{t(`（全${room.settings.maxRaces}レース）`, ` of ${room.settings.maxRaces}`)}</small>
          </h2>
          {isFinalRace(room) && !gameOver && (
            <span className="badge badge--accent">{t("最終レース", "Final race")}</span>
          )}
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t("大会の進行度", "Tournament progress")}
        >
          <span style={{ width: `${progress}%` }} />
        </div>

        <ol className="phase-steps" aria-label={t("レースの流れ", "Race steps")}>
          {[t("ベット受付", "Betting"), t("着順入力", "Results"), t("精算済み", "Settled")].map(
            (label, index) => (
              <li
                key={label}
                className={index < phaseIndex ? "is-done" : index === phaseIndex ? "is-current" : undefined}
              >
                <span aria-hidden="true">
                  {index < phaseIndex ? <Check size={14} strokeWidth={3} /> : index + 1}
                </span>
                {label}
              </li>
            ),
          )}
        </ol>

        {race.status === "betting" && (
          <>
            {room.players.length === 0 ? (
              <div className="stage-card__empty">
                <p>
                  {t(
                    "まだ参加者がいません。招待するか、代行で追加しましょう。",
                    "No bettors yet. Invite friends or add them yourself.",
                  )}
                </p>
                <div className="button-row">
                  {controller.isOnlineRoom && (
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => nav.push({ name: "invite" })}
                    >
                      {t("招待する", "Invite")}
                    </button>
                  )}
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => nav.replace({ name: "manage", section: "bettors" })}
                  >
                    {t("参加者を追加", "Add bettors")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="bettor-status">
                  <div className="bettor-status__head">
                    <strong>{t("ベット状況", "Who has bet")}</strong>
                    <span>
                      {bettorsWithTickets.size} / {room.players.length}
                      {t("人", "")}
                    </span>
                  </div>
                  <ul>
                    {room.players.map((player) => (
                      <li
                        key={player.id}
                        className={bettorsWithTickets.has(player.id) ? "is-done" : undefined}
                      >
                        <Avatar emoji={player.emoji} accent={player.accent} size="sm" />
                        <span>{player.name}</span>
                        {bettorsWithTickets.has(player.id) && (
                          <Check size={14} strokeWidth={3} aria-label={t("ベット済み", "Bet placed")} />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="button-stack">
                  <button
                    className="button button--primary button--block button--lg"
                    type="button"
                    onClick={() => void close()}
                    disabled={busy}
                  >
                    {t("ベットを締め切る", "Close betting")}
                  </button>
                  <button
                    className="button button--secondary button--block"
                    type="button"
                    onClick={() => nav.replace({ name: "bet" })}
                  >
                    {t("代行でベットを入力", "Enter a bet for someone")}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {race.status === "closed" && (
          <div className="button-stack">
            <p className="stage-card__hint">
              {t(
                `${race.bets.length}枚のベットで締め切りました。レースが終わったら着順を入力してください。`,
                `Closed with ${race.bets.length} tickets. Enter the finishing order once the race is over.`,
              )}
            </p>
            <button
              className="button button--primary button--block button--lg"
              type="button"
              onClick={() => nav.push({ name: "results" })}
            >
              {t("着順を入力する", "Enter results")}
            </button>
            <button
              className="button button--ghost button--block"
              type="button"
              onClick={() => void actions.reopenBetting()}
              disabled={busy}
            >
              {t("ベット受付を再開", "Reopen betting")}
            </button>
          </div>
        )}

        {race.status === "settled" && (
          <div className="button-stack">
            {gameOver ? (
              <button
                className="button button--primary button--block button--lg"
                type="button"
                onClick={() => nav.push({ name: "final" })}
              >
                {t("最終結果を表示", "Show final results")}
              </button>
            ) : (
              <button
                className="button button--primary button--block button--lg"
                type="button"
                onClick={() => void next()}
                disabled={busy}
              >
                {t(`${raceName(t, race.number + 1)}を始める`, `Start ${raceName(t, race.number + 1)}`)}
              </button>
            )}
            <button
              className="button button--secondary button--block"
              type="button"
              onClick={() => nav.push({ name: "race", raceId: race.id })}
            >
              {t("このレースの払戻を見る", "View this race's payouts")}
            </button>
            <button
              className="button button--ghost button--block"
              type="button"
              onClick={() => void correctResult()}
            >
              {t("着順を訂正する", "Correct the finishing order")}
            </button>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="summary-title">
        <h2 id="summary-title" className="card__title">
          {t("このレース", "This race")}
        </h2>
        <dl className="summary">
          <div>
            <dt>{t("ベット総額", "Total staked")}</dt>
            <dd>
              <Points value={pool} />
            </dd>
          </div>
          <div>
            <dt>{t("チケット", "Tickets")}</dt>
            <dd>{t(`${race.bets.length}枚`, `${race.bets.length}`)}</dd>
          </div>
          <div>
            <dt>{t("参加者", "Bettors")}</dt>
            <dd>
              {t(
                `${room.players.length} / ${room.settings.maxPlayers}人`,
                `${room.players.length} / ${room.settings.maxPlayers}`,
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-labelledby="odds-title">
        <header className="card__header">
          <h2 id="odds-title">{t("オッズ表", "Odds board")}</h2>
          <button
            className="link-button"
            type="button"
            onClick={() => nav.replace({ name: "manage", section: "racers" })}
          >
            {t("編集", "Edit")}
          </button>
        </header>
        <ul className="odds-board">
          {room.contestants.map((contestant, index) => (
            <li key={contestant.id}>
              <Lane number={index + 1} accent={contestant.accent} small />
              <span className="odds-board__icon" aria-hidden="true">
                {contestant.icon}
              </span>
              <span className="odds-board__name">{contestant.name}</span>
              <strong>{contestant.odds.toFixed(1)}</strong>
            </li>
          ))}
        </ul>
      </section>

      {leaders.length > 0 && room.raceHistory.length > 0 && (
        <section className="card" aria-labelledby="leaders-title">
          <header className="card__header">
            <h2 id="leaders-title">{t("現在のトップ3", "Top 3 right now")}</h2>
            <button className="link-button" type="button" onClick={() => nav.replace({ name: "ranking" })}>
              {t("すべて見る", "See all")}
            </button>
          </header>
          <ol className="mini-leaderboard">
            {leaders.map(({ player, rank }) => (
              <li key={player.id}>
                <span className={`rank-badge rank-badge--${rank}`}>{rank}</span>
                <Avatar emoji={player.emoji} accent={player.accent} size="sm" />
                <span>{player.name}</span>
                <Points value={player.balance} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
