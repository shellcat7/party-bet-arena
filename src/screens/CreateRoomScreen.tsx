import { useState } from "react";
import { Field, PageHeader, SegmentedControl, Stepper, Toggle } from "../components/ui";
import { useI18n } from "../i18n/i18n";
import { LIMITS } from "../lib/constants";
import { isFirebaseConfigured } from "../lib/firebase";
import type { RoomCreateInput } from "../lib/room";
import { clampBalance, defaultCreateInput } from "../lib/room";
import { useApp } from "../state/AppContext";

const balancePresets = [100, 500, 1000, 5000];

export function CreateRoomScreen() {
  const { t, formatNumber } = useI18n();
  const { controller, nav } = useApp();
  const [draft, setDraft] = useState<RoomCreateInput>(defaultCreateInput);
  const [customBalance, setCustomBalance] = useState(false);
  const update = (patch: Partial<RoomCreateInput>) => setDraft((current) => ({ ...current, ...patch }));
  const canSubmit = draft.name.trim().length > 0 && !controller.busy;

  const submit = async () => {
    if (!canSubmit) return;
    if (await controller.actions.createRoom(draft)) nav.reset({ name: "invite", isNew: true });
  };

  return (
    <div className="screen screen--entry">
      <PageHeader
        title={t("ルームを作成", "Create a room")}
        subtitle={t("あとから管理画面で変更できます", "Everything can be changed later")}
        onBack={nav.canGoBack ? nav.back : () => nav.reset({ name: "launch" })}
      />

      <form
        className="create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <section className="card form-card">
          <Field label={t("ルーム名", "Room name")}>
            {(id) => (
              <input
                id={id}
                className="input"
                value={draft.name}
                maxLength={LIMITS.maxRoomNameLength}
                required
                autoFocus
                onChange={(event) => update({ name: event.target.value })}
                placeholder={t("例：週末カート大会", "e.g. Friday kart night")}
              />
            )}
          </Field>

          <div className="setting-row">
            <span>
              <strong>{t("レース数", "Races")}</strong>
              <small>{t(`最大${LIMITS.maxRaces}レース`, `Up to ${LIMITS.maxRaces}`)}</small>
            </span>
            <Stepper
              label={t("レース数", "races")}
              value={draft.maxRaces}
              min={1}
              max={LIMITS.maxRaces}
              onChange={(maxRaces) => update({ maxRaces })}
            />
          </div>
          <div className="setting-row">
            <span>
              <strong>{t("対戦者の数", "Racers")}</strong>
              <small>{t("ゲームに出る人・CPU", "People or CPUs who compete")}</small>
            </span>
            <Stepper
              label={t("対戦者の数", "racers")}
              value={draft.contestantCount}
              min={LIMITS.minContestants}
              max={LIMITS.maxContestants}
              onChange={(contestantCount) => update({ contestantCount })}
            />
          </div>
          <div className="setting-row">
            <span>
              <strong>{t("参加者の上限", "Bettor limit")}</strong>
              <small>{t("ベットする人の最大数", "People who place bets")}</small>
            </span>
            <Stepper
              label={t("参加者の上限", "bettor limit")}
              value={draft.maxPlayers}
              min={1}
              max={LIMITS.maxBettors}
              onChange={(maxPlayers) => update({ maxPlayers })}
            />
          </div>

          <div className="setting-block">
            <strong>{t("初期ポイント", "Starting points")}</strong>
            <SegmentedControl
              label={t("初期ポイント", "Starting points")}
              value={customBalance ? "custom" : String(draft.startingBalance)}
              options={[
                ...balancePresets.map((value) => ({ value: String(value), label: formatNumber(value) })),
                { value: "custom", label: t("その他", "Other") },
              ]}
              onChange={(value) => {
                setCustomBalance(value === "custom");
                if (value !== "custom") update({ startingBalance: Number(value) });
              }}
            />
            {customBalance && (
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                max={LIMITS.maxStartingBalance}
                value={draft.startingBalance}
                aria-label={t("初期ポイント", "Starting points")}
                onChange={(event) => update({ startingBalance: clampBalance(Number(event.target.value)) })}
              />
            )}
          </div>
        </section>

        <section className="card form-card">
          <h2 className="card__title">{t("ルール", "Rules")}</h2>
          <Toggle
            checked={draft.autoOdds}
            label={t("オッズを自動計算", "Automatic odds")}
            description={t(
              "対戦者の強さ（CPUレベル）から倍率を決めます",
              "Odds follow each racer's strength or CPU level",
            )}
            onChange={(autoOdds) => update({ autoOdds })}
          />
          <Toggle
            checked={draft.marketOdds}
            label={t("人気でオッズが動く", "Pool-based odds")}
            description={t(
              "ベットが集まった対戦者ほど倍率が下がります",
              "Popular picks pay less, like a real betting pool",
            )}
            onChange={(marketOdds) => update({ marketOdds })}
          />
          <Toggle
            checked={draft.allowDebt}
            label={t("借金ベットを許可", "Allow betting into debt")}
            description={t("残高がマイナスになってもベットできます", "Bettors can go below zero")}
            onChange={(allowDebt) => update({ allowDebt })}
          />
        </section>

        {!isFirebaseConfigured && (
          <p className="notice">
            {t(
              "オンライン同期が無効のビルドです。ルームはこの端末だけに保存され、参加者のベットは幹事が代行入力します。",
              "Online sync is off in this build. The room stays on this device and the host enters bets for everyone.",
            )}
          </p>
        )}

        <div className="sticky-actions">
          <button
            className="button button--primary button--block button--lg"
            type="submit"
            disabled={!canSubmit}
          >
            {controller.busy ? t("作成しています…", "Creating…") : t("ルームを作成", "Create room")}
          </button>
        </div>
      </form>
    </div>
  );
}
