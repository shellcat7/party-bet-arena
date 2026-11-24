import { useState } from "react";
import { Flag, RotateCcw } from "lucide-react";
import { useConfirm } from "../../components/feedback";
import { Avatar, Coins, Lane, PageHeader } from "../../components/ui";
import { raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { isCompleteResult, isFinalRace, previewSettlement } from "../../lib/settlement";
import { useOpenRoom } from "../../state/AppContext";

export function ResultsEntryScreen() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { room, controller, nav } = useOpenRoom();
  const [order, setOrder] = useState<string[]>(room.currentRace.resultIds);
  const complete = isCompleteResult(room, order);
  const preview = complete ? previewSettlement(room, order) : [];
  const settled = room.currentRace.status === "settled";

  const pick = (id: string) => {
    setOrder((current) => {
      if (current.includes(id)) return current.slice(0, current.indexOf(id));
      const next = [...current, id];
      // The last racer's position is implied once everyone else is placed.
      const remaining = room.contestants.filter((contestant) => !next.includes(contestant.id));
      return remaining.length === 1 ? [...next, remaining[0].id] : next;
    });
  };

  const submit = async () => {
    const winner = room.contestants.find((contestant) => contestant.id === order[0]);
    const ok = await confirm({
      title: t("この着順で確定しますか？", "Confirm this result?"),
      message: t(
        `1着は${winner?.icon ?? ""} ${winner?.name ?? ""}。確定すると全員の残高に払戻が反映され、取り消せません。`,
        `${winner?.icon ?? ""} ${winner?.name ?? ""} wins. Payouts will be applied to everyone's balance and can't be undone.`,
      ),
      confirmLabel: t("確定して精算", "Confirm & pay out"),
    });
    if (!ok) return;
    if (await controller.actions.settle(order)) {
      nav.replace(isFinalRace(room) ? { name: "final" } : { name: "race", raceId: room.currentRace.id });
    }
  };

  return (
    <div className="screen">
      <PageHeader
        title={t("着順を入力", "Enter results")}
        subtitle={raceName(t, room.currentRace.number)}
        onBack={nav.back}
      />

      {room.currentRace.status === "betting" && (
        <p className="notice">
          {t("確定するとベットは自動で締め切られます。", "Betting closes automatically when you confirm.")}
        </p>
      )}

      <section className="card" aria-labelledby="order-title">
        <header className="card__header">
          <h2 id="order-title">{t("1着から順にタップ", "Tap racers in finishing order")}</h2>
          <button
            className="link-button"
            type="button"
            onClick={() => setOrder([])}
            disabled={!order.length || settled}
          >
            <RotateCcw size={14} />
            {t("やり直す", "Reset")}
          </button>
        </header>
        <ul className="finish-picker">
          {room.contestants.map((contestant, index) => {
            const position = order.indexOf(contestant.id);
            return (
              <li key={contestant.id}>
                <button
                  type="button"
                  className={position >= 0 ? `finish-pick is-placed place-${position + 1}` : "finish-pick"}
                  onClick={() => pick(contestant.id)}
                  disabled={settled}
                  aria-label={
                    position >= 0
                      ? t(
                          `${contestant.name}：${position + 1}着（タップで取り消し）`,
                          `${contestant.name}: position ${position + 1} (tap to undo)`,
                        )
                      : t(
                          `${contestant.name}を${order.length + 1}着にする`,
                          `Place ${contestant.name} ${order.length + 1}`,
                        )
                  }
                >
                  <span className="finish-pick__position">{position >= 0 ? position + 1 : "–"}</span>
                  <Lane number={index + 1} accent={contestant.accent} small />
                  <span className="finish-pick__icon" aria-hidden="true">
                    {contestant.icon}
                  </span>
                  <strong>{contestant.name}</strong>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {complete && (
        <section className="card" aria-labelledby="preview-title">
          <header className="card__header">
            <h2 id="preview-title">{t("精算プレビュー", "Payout preview")}</h2>
            <small>{t("まだ反映されていません", "Not applied yet")}</small>
          </header>
          {preview.every((row) => row.stake === 0) ? (
            <p className="muted">{t("このレースにはベットがありません。", "No bets in this race.")}</p>
          ) : (
            <ul className="preview-list">
              {[...preview]
                .filter((row) => row.stake > 0)
                .sort((a, b) => b.delta - a.delta)
                .map((row) => {
                  const player = room.players.find((item) => item.id === row.playerId);
                  return (
                    <li key={row.playerId}>
                      {player && <Avatar emoji={player.emoji} accent={player.accent} size="sm" />}
                      <span>{player?.name}</span>
                      {row.hits > 0 && <span className="badge badge--success">{t("的中", "Hit")}</span>}
                      <Coins value={row.delta} signed />
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      )}

      <div className="sticky-actions">
        <button
          className="button button--primary button--block button--lg"
          type="button"
          onClick={() => void submit()}
          disabled={!complete || settled || controller.busy}
        >
          <Flag size={18} />
          {controller.busy ? t("精算しています…", "Settling…") : t("着順を確定して精算", "Confirm & pay out")}
        </button>
      </div>
    </div>
  );
}
