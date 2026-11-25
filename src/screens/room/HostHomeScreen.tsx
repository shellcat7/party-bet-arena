import type { ReactNode } from "react";
import { Check, ChevronRight, Flag, QrCode, SlidersHorizontal, Trophy, Users } from "lucide-react";
import { useConfirm } from "../../components/feedback";
import { Avatar, Points, Lane } from "../../components/ui";
import type { PhaseTone } from "../../components/ui";
import { raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { isFinalRace, isGameOver, rankPlayers } from "../../lib/settlement";
import type { RaceStatus } from "../../lib/types";
import { useOpenRoom } from "../../state/AppContext";
import { useCorrectResult } from "./useCorrectResult";

const phases: RaceStatus[] = ["betting", "closed", "settled"];
const tones: Record<RaceStatus, PhaseTone> = { betting: "open", closed: "live", settled: "result" };

export function HostHomeScreen() {
  const { t, formatList } = useI18n();
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
          "まだ{names}がベットしていません。",
          "{count, plural, one {{names} hasn't bet yet.} other {{names} haven't bet yet.}}",
          { names: formatList(missing.map((player) => player.name)), count: missing.length },
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
      <section className={`card stage-card stage-card--${tones[race.status]}`} aria-labelledby="stage-title">
        <div className="stage-card__head">
          <h2 id="stage-title">
            {raceName(t, race.number)}
            <small>{t("（全{max}レース）", "({max} races in total)", { max: room.settings.maxRaces })}</small>
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
                    "まだ参加者がいません。招待するか、参加者を追加してください。",
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
                      {t("{count} / {max}人", "{count} / {max}", {
                        count: bettorsWithTickets.size,
                        max: room.players.length,
                      })}
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
                "{count}枚のベットで締め切りました。レースが終わったら着順を入力してください。",
                "{count, plural, one {Closed with # ticket.} other {Closed with # tickets.}} Enter the finishing order once the race is over.",
                { count: race.bets.length },
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
                {t("{race}を始める", "Start {race}", { race: raceName(t, race.number + 1) })}
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

      {race.status === "closed" && <WhileRacing />}

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
            <dd>
              {t("{count}枚", "{count, plural, one {# ticket} other {# tickets}}", {
                count: race.bets.length,
              })}
            </dd>
          </div>
          <div>
            <dt>{t("参加者", "Bettors")}</dt>
            <dd>
              {t("{count} / {max}人", "{count} / {max}", {
                count: room.players.length,
                max: room.settings.maxPlayers,
              })}
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

/** Things a host can get ready while everyone waits for the race to finish. */
function WhileRacing() {
  const { t } = useI18n();
  const { controller, nav } = useOpenRoom();
  return (
    <section className="card" aria-labelledby="while-racing-title">
      <h2 id="while-racing-title" className="card__title">
        {t("待っている間に", "While the race runs")}
      </h2>
      <ul className="shortcut-list">
        <Shortcut
          icon={<SlidersHorizontal size={20} />}
          label={t("ルールと設定", "Rules and settings")}
          detail={t("レース数、初期ポイント、オッズの方式", "Races, starting points, odds")}
          onClick={() => nav.replace({ name: "manage", section: "rules" })}
        />
        <Shortcut
          icon={<Flag size={20} />}
          label={t("対戦者", "Racers")}
          detail={t("次のレースの顔ぶれ", "Line-up for the next race")}
          onClick={() => nav.replace({ name: "manage", section: "racers" })}
        />
        <Shortcut
          icon={<Users size={20} />}
          label={t("参加者", "Bettors")}
          detail={t("追加、名前の変更、ポイント付与", "Add, rename, grant points")}
          onClick={() => nav.replace({ name: "manage", section: "bettors" })}
        />
        {controller.isOnlineRoom ? (
          <Shortcut
            icon={<QrCode size={20} />}
            label={t("招待QR", "Invitation QR")}
            detail={t("途中から参加する人に", "For anyone joining late")}
            onClick={() => nav.push({ name: "invite" })}
          />
        ) : (
          <Shortcut
            icon={<Trophy size={20} />}
            label={t("順位", "Standings")}
            detail={t("ここまでの順位", "Standings so far")}
            onClick={() => nav.replace({ name: "ranking" })}
          />
        )}
      </ul>
    </section>
  );
}

function Shortcut(props: { icon: ReactNode; label: string; detail: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={props.onClick}>
        <span className="shortcut-list__icon" aria-hidden="true">
          {props.icon}
        </span>
        <span className="shortcut-list__text">
          <strong>{props.label}</strong>
          <small>{props.detail}</small>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </li>
  );
}
