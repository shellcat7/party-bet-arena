import { useMemo, useState } from "react";
import { Check, Flag, Lock, Minus, Plus, Trash2, Users, X } from "lucide-react";
import { useConfirm } from "../../components/feedback";
import { Avatar, Points, EmptyState, Lane, SegmentedControl } from "../../components/ui";
import { betErrorMessage, betTypeCopy, raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import type { BetError } from "../../lib/betting";
import {
  getAvailableBalance,
  getDraftMultiplier,
  getPlayer,
  getPlayerBets,
  validateBet,
} from "../../lib/betting";
import {
  BET_TYPES,
  getBetPickIds,
  getEffectiveMultiplier,
  requiredPickCount,
  isBetTypeAvailable,
} from "../../lib/odds";
import type { Bet, BetType, Room } from "../../lib/types";
import { useOpenRoom } from "../../state/AppContext";

const quickAmounts = [10, 50, 100, 500];

export function BetScreen() {
  const { t } = useI18n();
  const { room, controller, nav } = useOpenRoom();
  const isHost = controller.role === "host";
  const race = room.currentRace;
  const [selectedProxyId, setProxyId] = useState<string>(
    () => firstWithoutTicket(room) ?? room.players[0]?.id ?? "",
  );
  // Fall back gracefully if the selected bettor was removed on another screen or device.
  const proxyId = room.players.some((player) => player.id === selectedProxyId)
    ? selectedProxyId
    : (room.players[0]?.id ?? "");
  const bettorId = isHost ? proxyId : (controller.me?.id ?? "");
  const bettor = getPlayer(room, bettorId);
  const myTicket = !isHost && bettor ? getPlayerBets(room, bettor.id)[0] : undefined;

  if (room.players.length === 0 && isHost) {
    return (
      <div className="screen">
        <EmptyState
          icon={<Users size={28} />}
          title={t("まだ参加者がいません", "No bettors yet")}
          action={
            <button
              className="button button--primary"
              type="button"
              onClick={() => nav.replace({ name: "manage", section: "bettors" })}
            >
              {t("参加者を追加", "Add bettors")}
            </button>
          }
        >
          {t(
            "参加者を追加すると、代行でベットを入力できます。",
            "Add bettors to enter bets on their behalf.",
          )}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="screen">
      {!isHost && myTicket && race.status !== "settled" && <PlacedTicket room={room} bet={myTicket} />}
      {!isHost && race.status === "settled" && (
        <section className="notice notice--card">
          <Flag size={20} aria-hidden="true" />
          <div>
            <strong>{t("このレースの結果が出ました", "This race has a result")}</strong>
            <p>{t("次のレースが始まるとベットできます。", "You can bet again when the next race opens.")}</p>
            <button
              className="link-button"
              type="button"
              onClick={() => nav.push({ name: "race", raceId: race.id })}
            >
              {t("結果と払戻を見る", "See the result and payouts")}
            </button>
          </div>
        </section>
      )}
      {!isHost && myTicket && race.status === "betting" && <BettorStatus room={room} />}

      {race.status !== "betting" && !myTicket && !(race.status === "settled" && !isHost) && (
        <section className="notice notice--card">
          <Lock size={20} aria-hidden="true" />
          <div>
            <strong>
              {race.status === "closed"
                ? t("ベットは締め切られました", "Betting is closed")
                : t("このレースは確定しました", "This race is settled")}
            </strong>
            <p>
              {race.status === "closed"
                ? t("幹事が着順を入力するまでお待ちください。", "Waiting for the host to enter the result.")
                : t("次のレースが始まるとベットできます。", "You can bet again when the next race opens.")}
            </p>
          </div>
        </section>
      )}

      {isHost && race.status === "betting" && (
        <section className="card proxy-picker" aria-labelledby="proxy-title">
          <h2 id="proxy-title" className="card__title">
            {t("誰のベットを入力しますか？", "Who is this bet for?")}
          </h2>
          <div className="chip-scroller" role="radiogroup" aria-labelledby="proxy-title">
            {room.players.map((player) => {
              const count = getPlayerBets(room, player.id).length;
              return (
                <button
                  key={player.id}
                  type="button"
                  role="radio"
                  aria-checked={proxyId === player.id}
                  className={proxyId === player.id ? "person-chip is-active" : "person-chip"}
                  onClick={() => setProxyId(player.id)}
                >
                  <Avatar emoji={player.emoji} accent={player.accent} size="sm" />
                  <span>{player.name}</span>
                  {count > 0 && <em aria-label={t(`${count}枚ベット済み`, `${count} tickets`)}>{count}</em>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {race.status === "betting" && bettor && !myTicket && (
        <BetForm
          key={bettor.id}
          room={room}
          bettorId={bettor.id}
          onPlaced={() => {
            if (isHost) setProxyId(firstWithoutTicket(room, bettor.id) ?? bettor.id);
          }}
        />
      )}

      {isHost && race.bets.length > 0 && <TicketList room={room} />}
    </div>
  );
}

function firstWithoutTicket(room: Room, after?: string) {
  const withTickets = new Set(room.currentRace.bets.map((bet) => bet.playerId));
  if (after) withTickets.add(after);
  return room.players.find((player) => !withTickets.has(player.id))?.id;
}

function BetForm(props: { room: Room; bettorId: string; onPlaced: () => void }) {
  const { t } = useI18n();
  const { controller } = useOpenRoom();
  const { room, bettorId } = props;
  const labels = betTypeCopy(t);
  const [type, setType] = useState<BetType>("win");
  const [picks, setPicks] = useState<string[]>([]);
  const [amount, setAmount] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const pickCount = requiredPickCount(type);
  const available = getAvailableBalance(room, bettorId);
  const multiplier = getDraftMultiplier(room, { type, contestantIds: picks });
  const payout = Math.floor(amount * multiplier);
  const draft = {
    playerId: bettorId,
    contestantIds: picks,
    type,
    amount,
    placedBy: controller.role === "host" ? "host" : "self",
  } as const;
  const error: BetError | null = validateBet(room, draft);
  // Only surface errors the user can act on; a missing pick is shown by the disabled button.
  const visibleError = error === "insufficient-balance" || error === "invalid-amount" ? error : null;

  const changeType = (next: BetType) => {
    setType(next);
    setPicks((current) => current.slice(0, requiredPickCount(next)));
  };

  const toggle = (id: string) => {
    setPicks((current) => {
      if (pickCount === 1) return current[0] === id ? [] : [id];
      if (current.includes(id)) return current.filter((item) => item !== id);
      return current.length >= pickCount ? current : [...current, id];
    });
  };

  const submit = async () => {
    setSubmitting(true);
    const ok = await controller.actions.placeBet({ playerId: bettorId, contestantIds: picks, type, amount });
    setSubmitting(false);
    if (ok) {
      setPicks([]);
      props.onPlaced();
    }
  };

  return (
    <form
      className="bet-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!error) void submit();
      }}
    >
      <section className="card">
        <header className="card__header">
          <h2>{raceName(t, room.currentRace.number)}</h2>
          <span className="badge badge--live">
            <i aria-hidden="true" />
            {t("受付中", "Open")}
          </span>
        </header>
        <SegmentedControl
          label={t("ベットの種類", "Bet type")}
          value={type}
          onChange={changeType}
          options={BET_TYPES.map((value) => ({
            value,
            label: labels[value].title,
            disabled: !isBetTypeAvailable(value, room.contestants.length),
          }))}
        />
        <p className="bet-form__prompt">
          <strong>{labels[type].note}</strong>
          {labels[type].prompt}
        </p>

        <ul className="racer-list">
          {room.contestants.map((contestant, index) => {
            const position = picks.indexOf(contestant.id);
            const selected = position >= 0;
            const single = getEffectiveMultiplier(room, pickCount === 1 ? type : "win", [contestant]);
            const full = pickCount > 1 && picks.length >= pickCount && !selected;
            return (
              <li key={contestant.id}>
                <button
                  type="button"
                  className={selected ? "racer is-selected" : "racer"}
                  aria-pressed={selected}
                  disabled={full}
                  onClick={() => toggle(contestant.id)}
                >
                  <Lane number={index + 1} accent={contestant.accent} />
                  <span className="racer__icon" aria-hidden="true">
                    {contestant.icon}
                  </span>
                  <span className="racer__name">
                    <strong>{contestant.name}</strong>
                    <small>
                      {contestant.isCpu ? `CPU Lv${contestant.cpuLevel}` : t("プレイヤー", "Player")}
                    </small>
                  </span>
                  <span className="racer__odds">
                    {single.toFixed(1)}
                    <small>{pickCount === 1 ? t("倍", "x") : t("単勝", "win")}</small>
                  </span>
                  <span className="racer__check" aria-hidden="true">
                    {selected ? pickCount > 1 ? position + 1 : <Check size={16} strokeWidth={3} /> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card ticket" aria-label={t("ベット内容", "Your ticket")}>
        <div className="ticket__picks">
          <span className="badge">{labels[type].title}</span>
          {Array.from({ length: pickCount }, (_, index) => {
            const contestant = room.contestants.find((item) => item.id === picks[index]);
            return (
              <span key={index} className={contestant ? "ticket__pick" : "ticket__pick is-empty"}>
                {pickCount > 1 && <small>{t(`${index + 1}着`, ["1st", "2nd", "3rd"][index])}</small>}
                {contestant ? `${contestant.icon} ${contestant.name}` : t("未選択", "—")}
              </span>
            );
          })}
          {picks.length > 0 && (
            <button
              className="icon-button icon-button--quiet"
              type="button"
              onClick={() => setPicks([])}
              aria-label={t("選択をクリア", "Clear picks")}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="amount">
          <div className="amount__head">
            <label htmlFor="bet-amount">{t("ベット額", "Stake")}</label>
            <small>
              {t("使える残高", "Available")}{" "}
              <Points
                value={room.settings.allowDebt ? (getPlayer(room, bettorId)?.balance ?? 0) : available}
              />
            </small>
          </div>
          <div className="amount__input">
            <button
              type="button"
              onClick={() => setAmount((value) => Math.max(0, value - 10))}
              aria-label={t("10減らす", "Minus 10")}
            >
              <Minus size={18} />
            </button>
            <input
              id="bet-amount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={amount || ""}
              onChange={(event) => setAmount(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
            />
            <button
              type="button"
              onClick={() => setAmount((value) => value + 10)}
              aria-label={t("10増やす", "Plus 10")}
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="amount__quick">
            {quickAmounts.map((value) => (
              <button key={value} type="button" onClick={() => setAmount((current) => current + value)}>
                +{value}
              </button>
            ))}
            <button type="button" onClick={() => setAmount(available)} disabled={available <= 0}>
              {t("全額", "All in")}
            </button>
          </div>
        </div>

        <div className="ticket__payout">
          <span>
            {t("的中時の払戻", "Payout if it hits")}
            {multiplier > 0 && <small> ×{multiplier.toFixed(1)}</small>}
          </span>
          <strong>{multiplier > 0 ? <Points value={payout} /> : "—"}</strong>
        </div>
        {room.settings.marketOdds && (
          <p className="form-help">
            {t(
              "人気で倍率が変わるため、払戻は締切時のオッズで確定します。",
              "Pool-based odds: the final multiplier is fixed when betting closes.",
            )}
          </p>
        )}
        {visibleError && (
          <p className="form-error" role="alert">
            {betErrorMessage(t, visibleError)}
          </p>
        )}
        <button
          className="button button--primary button--block button--lg"
          type="submit"
          disabled={Boolean(error) || submitting}
        >
          {submitting ? t("送信中…", "Placing…") : t("ベットする", "Place bet")}
        </button>
      </section>
    </form>
  );
}

function PlacedTicket(props: { room: Room; bet: Bet }) {
  const { t } = useI18n();
  const { room, bet } = props;
  const labels = betTypeCopy(t);
  const picks = getBetPickIds(bet).map((id) => room.contestants.find((contestant) => contestant.id === id));
  const multiplier = getDraftMultiplier(room, { type: bet.type, contestantIds: getBetPickIds(bet) });
  const confirm = useConfirm();
  const { controller } = useOpenRoom();
  const cancel = async () => {
    const ok = await confirm({
      title: t("ベットを取り消しますか？", "Cancel this bet?"),
      message: t("締切までなら、もう一度ベットできます。", "You can bet again until betting closes."),
      confirmLabel: t("取り消す", "Cancel bet"),
      tone: "danger",
    });
    if (ok) await controller.actions.cancelOwnBet();
  };
  const waitingFor = room.players.length - new Set(room.currentRace.bets.map((item) => item.playerId)).size;

  return (
    <section className="card placed-ticket" aria-labelledby="placed-title">
      <header className="placed-ticket__head">
        <span className="placed-ticket__icon" aria-hidden="true">
          <Check size={20} strokeWidth={3} />
        </span>
        <div>
          <h2 id="placed-title">{t("ベットを受け付けました", "Bet placed")}</h2>
          <p>
            {room.currentRace.status === "betting"
              ? waitingFor > 0
                ? t(`あと${waitingFor}人のベットを待っています`, `Waiting for ${waitingFor} more`)
                : t(
                    "全員ベットしました。締切を待っています",
                    "Everyone has bet. Waiting for the host to close betting",
                  )
              : t("ベットは締め切られました。結果を待っています", "Betting closed. Waiting for the result")}
          </p>
        </div>
      </header>
      <dl className="placed-ticket__body">
        <div>
          <dt>{labels[bet.type].title}</dt>
          <dd>
            {picks.map((contestant, index) => (
              <span key={index}>
                {contestant ? `${contestant.icon} ${contestant.name}` : "?"}
                {index < picks.length - 1 && <i aria-hidden="true"> → </i>}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>{t("ベット額", "Stake")}</dt>
          <dd>
            <Points value={bet.amount} />
          </dd>
        </div>
        <div>
          <dt>{t("的中時（目安）", "If it hits (est.)")}</dt>
          <dd>
            <Points value={Math.floor(bet.amount * multiplier)} />
          </dd>
        </div>
      </dl>
      {room.currentRace.status === "betting" && (
        <button
          className="button button--secondary button--block"
          type="button"
          onClick={() => void cancel()}
        >
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

function TicketList(props: { room: Room }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { controller } = useOpenRoom();
  const { room } = props;
  const labels = betTypeCopy(t);
  const tickets = useMemo(
    () => [...room.currentRace.bets].sort((a, b) => b.createdAt - a.createdAt),
    [room.currentRace.bets],
  );

  const remove = async (bet: Bet) => {
    const player = getPlayer(room, bet.playerId);
    const ok = await confirm({
      title: t("このベットを取り消しますか？", "Void this ticket?"),
      message: t(
        `${player?.name ?? "?"}さんの${labels[bet.type].title}（${bet.amount}pt）を取り消します。`,
        `${player?.name ?? "?"}'s ${labels[bet.type].title} for ${bet.amount}pt will be removed.`,
      ),
      confirmLabel: t("取り消す", "Void"),
      tone: "danger",
    });
    if (ok) await controller.actions.removeBet(bet.id);
  };

  return (
    <section className="card" aria-labelledby="tickets-title">
      <header className="card__header">
        <h2 id="tickets-title">{t("このレースのベット", "Tickets this race")}</h2>
        <span className="badge">{tickets.length}</span>
      </header>
      <ul className="ticket-list">
        {tickets.map((bet) => {
          const player = getPlayer(room, bet.playerId);
          return (
            <li key={bet.id}>
              {player && <Avatar emoji={player.emoji} accent={player.accent} size="sm" />}
              <span className="ticket-list__who">
                <strong>{player?.name ?? "?"}</strong>
                <small>{bet.placedBy === "host" ? t("代行", "By host") : t("本人", "Self")}</small>
              </span>
              <span className="ticket-list__what">
                <small>{labels[bet.type].title}</small>
                <span className="lane-row">
                  {getBetPickIds(bet).map((id) => {
                    const index = room.contestants.findIndex((contestant) => contestant.id === id);
                    return index >= 0 ? (
                      <Lane key={id} number={index + 1} accent={room.contestants[index].accent} small />
                    ) : null;
                  })}
                </span>
              </span>
              <Points value={bet.amount} />
              {room.currentRace.status === "betting" && (
                <button
                  className="icon-button icon-button--quiet"
                  type="button"
                  onClick={() => void remove(bet)}
                  aria-label={t("取り消す", "Void ticket")}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
