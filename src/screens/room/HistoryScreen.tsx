import { ChevronRight, History } from "lucide-react";
import { BalanceChart } from "../../components/BalanceChart";
import { Points, EmptyState, Lane, PageHeader } from "../../components/ui";
import { raceName } from "../../i18n/copy";
import { useI18n } from "../../i18n/i18n";
import { useOpenRoom } from "../../state/AppContext";

export function HistoryScreen() {
  const { t, formatTime } = useI18n();
  const { room, controller, nav } = useOpenRoom();
  const meId = controller.me?.id;
  const races = [...room.raceHistory].reverse();

  return (
    <div className="screen">
      {controller.role === "host" ? (
        <PageHeader title={t("レース履歴", "Race history")} onBack={nav.back} />
      ) : (
        <header className="section-heading">
          <h1>{t("レース履歴", "Race history")}</h1>
          <p>{t("タップすると払戻の明細を確認できます", "Tap a race for its payout details")}</p>
        </header>
      )}

      {races.length === 0 ? (
        <EmptyState
          icon={<History size={28} />}
          title={t("まだ確定したレースはありません", "No settled races yet")}
        >
          {t(
            "幹事が着順を確定すると、ここに結果が並びます。",
            "Results appear here once the host settles a race.",
          )}
        </EmptyState>
      ) : (
        <>
          <section className="card">
            <BalanceChart room={room} highlightId={meId} />
          </section>
          <ul className="race-history">
            {races.map((entry) => {
              const winner = entry.contestants.find((contestant) => contestant.id === entry.resultIds[0]);
              const mine = meId ? entry.payouts.find((row) => row.playerId === meId) : undefined;
              const best = [...entry.payouts].sort((a, b) => b.delta - a.delta)[0];
              const bestPlayer = room.players.find((player) => player.id === best?.playerId);
              return (
                <li key={entry.raceId}>
                  <button type="button" onClick={() => nav.push({ name: "race", raceId: entry.raceId })}>
                    <span className="race-history__number">
                      <small>{t("レース", "Race")}</small>
                      <strong>{entry.raceNumber}</strong>
                    </span>
                    <span className="race-history__body">
                      <strong>
                        {winner?.icon} {winner?.name ?? "?"} {t("が1着", "won")}
                      </strong>
                      <span className="lane-row">
                        {entry.resultIds.slice(0, 3).map((id) => {
                          const index = entry.contestants.findIndex((contestant) => contestant.id === id);
                          return index >= 0 ? (
                            <Lane
                              key={id}
                              number={index + 1}
                              accent={entry.contestants[index].accent}
                              small
                            />
                          ) : null;
                        })}
                        <small>{formatTime(entry.settledAt)}</small>
                      </span>
                    </span>
                    <span className="race-history__delta">
                      {mine ? (
                        <>
                          <small>{t("あなた", "You")}</small>
                          <Points value={mine.delta} signed />
                        </>
                      ) : best && best.delta > 0 ? (
                        <>
                          <small>{bestPlayer?.name}</small>
                          <Points value={best.delta} signed />
                        </>
                      ) : (
                        <small>{raceName(t, entry.raceNumber)}</small>
                      )}
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
