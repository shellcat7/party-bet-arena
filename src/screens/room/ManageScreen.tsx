import { useState } from "react";
import { Plus, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { useConfirm, useNotify } from "../../components/feedback";
import { EmojiPicker, Field, SegmentedControl, Stepper, Toggle } from "../../components/ui";
import { useI18n } from "../../i18n/i18n";
import { LIMITS, pickEmoji } from "../../lib/constants";
import { canAddContestant, canAddPlayer, canRemoveContestant } from "../../lib/room";
import { useOpenRoom } from "../../state/AppContext";
import type { ManageSection } from "../../state/navigation";
import { LanguageSwitch, ThemeSwitch } from "../LaunchScreen";

/** Text input that writes on blur / Enter instead of on every keystroke. */
function CommitInput(props: {
  value: string;
  label: string;
  maxLength: number;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  const [source, setSource] = useState(props.value);
  if (source !== props.value) {
    // The value changed on another device; adopt it.
    setSource(props.value);
    setDraft(props.value);
  }
  const commit = () => {
    const value = draft.trim();
    if (value && value !== props.value) props.onCommit(value);
    else setDraft(props.value);
  };
  return (
    <input
      className={props.className ?? "input input--inline"}
      value={draft}
      maxLength={props.maxLength}
      aria-label={props.label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(props.value);
      }}
    />
  );
}

export function ManageScreen(props: { initialSection?: ManageSection }) {
  const { t } = useI18n();
  const [section, setSection] = useState<ManageSection>(props.initialSection ?? "bettors");
  const { room } = useOpenRoom();

  return (
    <div className="screen">
      <header className="section-heading">
        <h1>{t("管理", "Manage")}</h1>
        <p>{room.name}</p>
      </header>
      <SegmentedControl
        label={t("管理メニュー", "Manage menu")}
        value={section}
        onChange={setSection}
        options={[
          { value: "bettors", label: t(`参加者 ${room.players.length}`, `Bettors ${room.players.length}`) },
          {
            value: "racers",
            label: t(`対戦者 ${room.contestants.length}`, `Racers ${room.contestants.length}`),
          },
          { value: "rules", label: t("ルール", "Rules") },
        ]}
      />
      {section === "bettors" && <BettorsSection />}
      {section === "racers" && <RacersSection />}
      {section === "rules" && <RulesSection />}
    </div>
  );
}

function BettorsSection() {
  const { t, formatNumber } = useI18n();
  const confirm = useConfirm();
  const { room, controller, nav } = useOpenRoom();
  const { actions } = controller;
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(() => pickEmoji(room.players.length));
  const full = !canAddPlayer(room);

  const add = async () => {
    if (!name.trim() || full) return;
    if (await actions.addPlayer({ name, emoji, isOffline: true })) {
      setName("");
      setEmoji(pickEmoji(room.players.length + 1));
    }
  };

  const remove = async (playerId: string) => {
    const player = room.players.find((item) => item.id === playerId);
    if (!player) return;
    const ok = await confirm({
      title: t(`${player.name}さんを外しますか？`, `Remove ${player.name}?`),
      message: t(
        "このレースのベットも取り消されます。過去のレース記録は残ります。",
        "Their open tickets are voided. Past results are kept.",
      ),
      confirmLabel: t("外す", "Remove"),
      tone: "danger",
    });
    if (ok) await actions.removePlayer(playerId);
  };

  return (
    <>
      <section className="card">
        <header className="card__header">
          <h2>{t("参加者（ベットする人）", "Bettors")}</h2>
          <span className="badge">
            {room.players.length}/{room.settings.maxPlayers}
          </span>
        </header>
        {room.players.length === 0 && <p className="muted">{t("まだ誰もいません。", "Nobody yet.")}</p>}
        <ul className="edit-list">
          {room.players.map((player) => (
            <li key={player.id}>
              <EmojiPicker
                value={player.emoji}
                accent={player.accent}
                label={t(`${player.name}のアイコン`, `${player.name}'s icon`)}
                onChange={(value) => void actions.updatePlayer(player.id, { emoji: value })}
              />
              <div className="edit-list__main">
                <CommitInput
                  value={player.name}
                  label={t("名前", "Name")}
                  maxLength={LIMITS.maxNameLength}
                  onCommit={(value) => void actions.updatePlayer(player.id, { name: value })}
                />
                <small>
                  {formatNumber(player.balance)}pt ·{" "}
                  {player.uid ? t("本人のスマホ", "Own phone") : t("代行", "Via host")}
                </small>
              </div>
              <button
                className="icon-button icon-button--quiet"
                type="button"
                onClick={() => void remove(player.id)}
                aria-label={t(`${player.name}を外す`, `Remove ${player.name}`)}
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="add-row"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <EmojiPicker
            value={emoji}
            label={t("新しい参加者のアイコン", "New bettor's icon")}
            onChange={setEmoji}
          />
          <input
            className="input"
            value={name}
            maxLength={LIMITS.maxNameLength}
            onChange={(event) => setName(event.target.value)}
            placeholder={full ? t("満員です", "Room is full") : t("名前を入力", "Name")}
            disabled={full}
            aria-label={t("新しい参加者の名前", "New bettor's name")}
          />
          <button className="button button--primary" type="submit" disabled={!name.trim() || full}>
            <UserPlus size={18} />
            <span className="sr-only">{t("追加", "Add")}</span>
          </button>
        </form>
        <p className="form-help">
          {t(
            "スマホを持っていない人を追加すると、幹事が代わりにベットを入力できます。",
            "Add people without a phone here; the host enters their bets.",
          )}
        </p>
      </section>
      {controller.isOnlineRoom && (
        <button
          className="button button--secondary button--block"
          type="button"
          onClick={() => nav.push({ name: "invite" })}
        >
          {t("参加者を招待", "Invite players")}
        </button>
      )}
    </>
  );
}

function RacersSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const notify = useNotify();
  const { room, controller } = useOpenRoom();
  const { actions } = controller;
  const editable = room.currentRace.status === "betting";
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🚀");

  const remove = async (contestantId: string) => {
    const contestant = room.contestants.find((item) => item.id === contestantId);
    if (!contestant) return;
    const affected = room.currentRace.bets.filter((bet) =>
      (bet.contestantIds ?? [bet.contestantId]).includes(contestantId),
    ).length;
    const ok = await confirm({
      title: t(`${contestant.name}を外しますか？`, `Remove ${contestant.name}?`),
      message: affected
        ? t(
            `この対戦者を含むベット${affected}枚が取り消されます。`,
            `${affected} open tickets that include this racer will be voided.`,
          )
        : undefined,
      confirmLabel: t("外す", "Remove"),
      tone: "danger",
    });
    if (ok) await actions.removeContestant(contestantId);
  };

  const add = async () => {
    if (!canAddContestant(room)) return;
    if (await actions.addContestant({ name, icon, isCpu: true, cpuLevel: 5, odds: 3 })) {
      setName("");
      notify.success(t("対戦者を追加しました", "Racer added"));
    }
  };

  return (
    <section className="card">
      <header className="card__header">
        <h2>{t("対戦者（レースに出る人・CPU）", "Racers")}</h2>
        <button
          className="link-button"
          type="button"
          onClick={() => void actions.recalculateOdds()}
          disabled={!editable}
        >
          <RefreshCw size={14} />
          {t("オッズ自動計算", "Auto odds")}
        </button>
      </header>
      {!editable && (
        <p className="notice">
          {t("ベット受付中のみ対戦者を変更できます。", "Racers can only be changed while betting is open.")}
        </p>
      )}
      <p className="form-help">
        {room.settings.autoOdds
          ? t(
              "強さ（CPUレベル）からオッズを自動で計算中。オッズを直接編集すると手動モードになります。",
              "Odds follow each racer's strength. Editing odds directly switches to manual mode.",
            )
          : t(
              "手動オッズ中。「オッズ自動計算」で強さから再計算できます。",
              "Manual odds. Use “Auto odds” to recalculate from strength.",
            )}
      </p>
      <ul className="edit-list edit-list--racers">
        {room.contestants.map((contestant, index) => (
          <li key={contestant.id}>
            <EmojiPicker
              value={contestant.icon}
              accent={contestant.accent}
              label={t(`${contestant.name}のアイコン`, `${contestant.name}'s icon`)}
              onChange={(value) => void actions.updateContestant(contestant.id, { icon: value })}
            />
            <div className="edit-list__main">
              <CommitInput
                value={contestant.name}
                label={t(`${index + 1}番の名前`, `Racer ${index + 1} name`)}
                maxLength={LIMITS.maxNameLength}
                onCommit={(value) => void actions.updateContestant(contestant.id, { name: value })}
              />
              <div className="racer-controls">
                <Toggle
                  checked={contestant.isCpu}
                  label="CPU"
                  onChange={(isCpu) => void actions.updateContestant(contestant.id, { isCpu })}
                  disabled={!editable}
                />
                <Stepper
                  label={t("強さ", "strength")}
                  value={contestant.cpuLevel}
                  min={LIMITS.minRating}
                  max={LIMITS.maxRating}
                  format={(value) => `Lv${value}`}
                  onChange={(cpuLevel) =>
                    editable && void actions.updateContestant(contestant.id, { cpuLevel })
                  }
                />
                <label className="odds-input">
                  <span className="sr-only">{t("オッズ", "Odds")}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={LIMITS.minOdds}
                    max={LIMITS.maxOdds}
                    step={0.1}
                    disabled={!editable}
                    key={contestant.odds}
                    defaultValue={contestant.odds}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value !== contestant.odds)
                        void actions.setContestantOdds(contestant.id, value);
                    }}
                  />
                  <small>{t("倍", "x")}</small>
                </label>
              </div>
            </div>
            <button
              className="icon-button icon-button--quiet"
              type="button"
              onClick={() => void remove(contestant.id)}
              disabled={!canRemoveContestant(room)}
              aria-label={t(`${contestant.name}を外す`, `Remove ${contestant.name}`)}
            >
              <Trash2 size={18} />
            </button>
          </li>
        ))}
      </ul>
      {canAddContestant(room) && (
        <form
          className="add-row"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <EmojiPicker
            value={icon}
            label={t("新しい対戦者のアイコン", "New racer's icon")}
            onChange={setIcon}
          />
          <input
            className="input"
            value={name}
            maxLength={LIMITS.maxNameLength}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("名前（空欄ならCPU）", "Name (blank = CPU)")}
            aria-label={t("新しい対戦者の名前", "New racer's name")}
          />
          <button className="button button--primary" type="submit">
            <Plus size={18} />
            <span className="sr-only">{t("追加", "Add")}</span>
          </button>
        </form>
      )}
    </section>
  );
}

function RulesSection() {
  const { t, formatNumber } = useI18n();
  const confirm = useConfirm();
  const notify = useNotify();
  const { room, controller, nav } = useOpenRoom();
  const { actions } = controller;
  const [bonusPlayer, setBonusPlayer] = useState(room.players[0]?.id ?? "");
  const [bonusAmount, setBonusAmount] = useState(room.settings.specialBonus || 100);

  const grant = async () => {
    const player = room.players.find((item) => item.id === bonusPlayer);
    if (!player || bonusAmount <= 0) return;
    if (await actions.grantBonus(player.id, bonusAmount)) {
      notify.success(
        t(
          `${player.name}さんに${formatNumber(bonusAmount)}pt付与しました`,
          `Gave ${player.name} ${formatNumber(bonusAmount)}pt`,
        ),
      );
    }
  };

  const deleteRoom = async () => {
    const ok = await confirm({
      title: room.isDemo
        ? t("デモをリセットしますか？", "Reset the demo?")
        : t("ルームを削除しますか？", "Delete this room?"),
      message: room.isDemo
        ? t("デモの進行状況を最初の状態に戻します。", "The demo returns to its starting state.")
        : t(
            "全員の残高と履歴が削除され、参加者もアクセスできなくなります。元に戻せません。",
            "Everyone's balances and history are deleted and participants lose access. This can't be undone.",
          ),
      confirmLabel: room.isDemo ? t("リセット", "Reset") : t("削除する", "Delete"),
      tone: "danger",
    });
    if (!ok) return;
    if (room.isDemo) {
      actions.startDemo({ reset: true });
      nav.reset({ name: "home" });
    } else {
      await actions.deleteRoom(room.id);
    }
  };

  return (
    <>
      <section className="card form-card">
        <Field label={t("ルーム名", "Room name")}>
          {(id) => (
            <CommitInput
              value={room.name}
              label={t("ルーム名", "Room name")}
              maxLength={LIMITS.maxRoomNameLength}
              onCommit={(value) => void actions.renameRoom(value)}
              className="input"
              key={id}
            />
          )}
        </Field>
        <div className="setting-row">
          <span>
            <strong>{t("レース数", "Races")}</strong>
            <small>
              {t(`現在 第${room.currentRace.number}レース`, `Now on race ${room.currentRace.number}`)}
            </small>
          </span>
          <Stepper
            label={t("レース数", "races")}
            value={room.settings.maxRaces}
            min={room.currentRace.number}
            max={LIMITS.maxRaces}
            onChange={(maxRaces) => void actions.updateSettings({ maxRaces })}
          />
        </div>
        <div className="setting-row">
          <span>
            <strong>{t("参加者の上限", "Bettor limit")}</strong>
          </span>
          <Stepper
            label={t("参加者の上限", "bettor limit")}
            value={room.settings.maxPlayers}
            min={Math.max(1, room.players.length)}
            max={LIMITS.maxBettors}
            onChange={(maxPlayers) => void actions.updateSettings({ maxPlayers })}
          />
        </div>
        <div className="setting-row">
          <span>
            <strong>{t("初期ポイント", "Starting points")}</strong>
            <small>{t("これから参加する人に適用", "Applies to people who join later")}</small>
          </span>
          <Stepper
            label={t("初期ポイント", "starting points")}
            value={room.startingBalance}
            min={0}
            max={100_000}
            step={100}
            format={formatNumber}
            onChange={(startingBalance) => void actions.updateSettings({ startingBalance })}
          />
        </div>
      </section>

      <section className="card form-card">
        <Toggle
          checked={room.settings.autoOdds}
          label={t("オッズを自動計算", "Automatic odds")}
          description={t("強さ（CPUレベル）から倍率を決めます", "Odds follow each racer's strength")}
          onChange={(autoOdds) => void actions.updateSettings({ autoOdds })}
          disabled={room.currentRace.status !== "betting"}
        />
        <Toggle
          checked={room.settings.marketOdds}
          label={t("人気でオッズが動く", "Pool-based odds")}
          description={t("ベットが集まるほど倍率が下がります", "Popular picks pay less")}
          onChange={(marketOdds) => void actions.updateSettings({ marketOdds })}
          disabled={room.currentRace.status !== "betting"}
        />
        <Toggle
          checked={room.settings.allowDebt}
          label={t("借金ベットを許可", "Allow betting into debt")}
          description={t("残高がマイナスでもベットできます", "Bettors can go below zero")}
          onChange={(allowDebt) => void actions.updateSettings({ allowDebt })}
          disabled={room.currentRace.status !== "betting"}
        />
      </section>

      {room.players.length > 0 && (
        <section className="card form-card">
          <h2 className="card__title">{t("ポイントを付与", "Give points")}</h2>
          <p className="form-help">
            {t(
              "特別ルールなどで、参加者にポイントを追加します。",
              "Add points to a bettor, e.g. for a house rule.",
            )}
          </p>
          <div className="add-row">
            <select
              className="input"
              value={bonusPlayer}
              onChange={(event) => setBonusPlayer(event.target.value)}
              aria-label={t("ボーナスを受け取る人", "Bonus recipient")}
            >
              {room.players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.emoji} {player.name}
                </option>
              ))}
            </select>
            <input
              className="input input--short"
              type="number"
              inputMode="numeric"
              min={1}
              value={bonusAmount}
              onChange={(event) => setBonusAmount(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
              aria-label={t("ボーナス額", "Bonus amount")}
            />
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void grant()}
              disabled={!bonusPlayer || bonusAmount <= 0}
            >
              {t("付与", "Give")}
            </button>
          </div>
        </section>
      )}

      <section className="card form-card">
        <h2 className="card__title">{t("この端末の表示", "This device")}</h2>
        <div className="setting-row">
          <strong>{t("言語", "Language")}</strong>
          <LanguageSwitch />
        </div>
        <div className="setting-row">
          <strong>{t("テーマ", "Theme")}</strong>
          <ThemeSwitch />
        </div>
      </section>

      <section className="card form-card danger-zone">
        <h2 className="card__title">{room.isDemo ? t("デモ", "Demo") : t("危険な操作", "Danger zone")}</h2>
        <button
          className="button button--danger button--block"
          type="button"
          onClick={() => void deleteRoom()}
        >
          {room.isDemo ? t("デモを最初からやり直す", "Restart the demo") : t("ルームを削除", "Delete room")}
        </button>
      </section>
    </>
  );
}
