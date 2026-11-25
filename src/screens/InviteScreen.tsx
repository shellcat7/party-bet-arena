import QRCode from "react-qr-code";
import { Copy, Link2, Share2, WifiOff } from "lucide-react";
import { useNotify } from "../components/feedback";
import { Pass } from "../components/BetPass";
import { Tile } from "../components/Tile";
import { PageHeader, Points } from "../components/ui";
import { landscapeLabel } from "../i18n/copy";
import { useI18n } from "../i18n/i18n";
import { buildInviteUrl, groupCode } from "../lib/ids";
import { biomeForRace } from "../lib/pass";
import { useOpenRoom } from "../state/AppContext";

export default function InviteScreen(props: { isNew: boolean }) {
  const { t } = useI18n();
  const notify = useNotify();
  const { room, controller, nav } = useOpenRoom();
  const online = controller.isOnlineRoom;
  const url = buildInviteUrl(window.location.href, { roomId: room.id, joinCode: room.joinCode });

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success(t("{label}をコピーしました", "{label} copied", { label }));
    } catch {
      notify.error(
        t(
          "コピーできませんでした。長押しで選択してください。",
          "Couldn't copy. Long-press to select instead.",
        ),
      );
    }
  };

  const share = async () => {
    const text = t(
      "「{room}」への招待です。リンクを開いて参加してください。",
      "You're invited to “{room}”. Open the link to join.",
      { room: room.name },
    );
    if (navigator.share) {
      try {
        await navigator.share({ title: room.name, text, url });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          await copy(url, t("招待リンク", "Invite link"));
      }
    } else {
      await copy(url, t("招待リンク", "Invite link"));
    }
  };

  const done = () => (props.isNew ? nav.reset({ name: "home" }) : nav.back());

  return (
    <div className="screen screen--entry invite">
      <PageHeader
        title={props.isNew ? t("ルームを作成しました", "Room created") : t("参加者を招待", "Invite players")}
        subtitle={room.name}
        onBack={props.isNew ? undefined : nav.back}
      />

      {online ? (
        <>
          <Pass
            className="pass--brand"
            accent="#fdc603"
            title={t("ランクパーティ", "Rank Party")}
            label={t("「{room}」への招待状", "Invitation to “{room}”", { room: room.name })}
            headerFields={[
              { label: t("レース", "Races"), value: room.settings.maxRaces },
              { label: t("定員", "Capacity"), value: room.settings.maxPlayers },
            ]}
            primary={
              <div className="pass-title">
                <small>{t("招待状", "Invitation")}</small>
                <strong>{room.name}</strong>
              </div>
            }
            art={{
              biome: biomeForRace(room.id.charCodeAt(0)),
              label: landscapeLabel(t, biomeForRace(room.id.charCodeAt(0))),
              seed: room.id.charCodeAt(1),
            }}
            fields={[
              { label: t("幹事", "Host"), value: room.hostName || "—" },
              { label: t("初期ポイント", "Starting points"), value: <Points value={room.startingBalance} /> },
              {
                label: t("参加者", "Bettors"),
                value: `${room.players.length} / ${room.settings.maxPlayers}`,
                align: "end",
              },
            ]}
            stub={
              <div className="pass-qr">
                <figure className="pass-qr__code" data-testid="invite-qr">
                  <QRCode
                    value={url}
                    size={184}
                    bgColor="#ffffff"
                    fgColor="#0b0d10"
                    level="M"
                    title={t("参加用QRコード", "Join QR code")}
                  />
                </figure>
                <p>
                  {t(
                    "スマホのカメラで読み取ると参加画面が開きます",
                    "Scan with a phone camera to open the join screen",
                  )}
                </p>
                <dl className="pass-qr__codes">
                  <div>
                    <dt>{t("ルームID", "Room ID")}</dt>
                    <dd data-testid="invite-room-id">{groupCode(room.id)}</dd>
                  </div>
                  <div>
                    <dt>{t("参加コード", "Join code")}</dt>
                    <dd data-testid="invite-join-code">{groupCode(room.joinCode)}</dd>
                  </div>
                </dl>
              </div>
            }
          />

          <div className="tiles">
            <Tile
              icon={<Share2 size={16} />}
              tone="blue"
              title={t("リンクを共有", "Share link")}
              detail={t("メッセージやLINEで送る", "Send it in a chat")}
              onClick={() => void share()}
            />
            <Tile
              icon={<Link2 size={16} />}
              tone="purple"
              title={t("リンクをコピー", "Copy link")}
              detail={t("招待リンク", "Invite link")}
              onClick={() => void copy(url, t("招待リンク", "Invite link"))}
            />
            <Tile
              icon={<Copy size={16} />}
              tone="green"
              title={t("ルームIDをコピー", "Copy room ID")}
              detail={t("手入力で参加する人に", "For joining by hand")}
              onClick={() => void copy(room.id, t("ルームID", "Room ID"))}
            />
            <Tile
              icon={<Copy size={16} />}
              tone="orange"
              title={t("参加コードをコピー", "Copy join code")}
              detail={t("ルームIDと一緒に伝える", "Send it with the room ID")}
              onClick={() => void copy(room.joinCode, t("参加コード", "Join code"))}
            />
          </div>
          <p className="form-help">
            {t(
              "参加コードを知っている人だけがルームを見られます。SNSなど公開の場所には投稿しないでください。",
              "Only people with the join code can see the room. Don't post it publicly.",
            )}
          </p>
        </>
      ) : (
        <div className="notice notice--card">
          <WifiOff size={22} aria-hidden="true" />
          <div>
            <strong>{t("このルームはこの端末だけで動きます", "This room lives on this device")}</strong>
            <p>
              {room.isDemo
                ? t(
                    "デモでは招待は使えません。管理画面から参加者を追加してください。",
                    "Invitations are disabled in the demo. Add bettors from the manage tab.",
                  )
                : t(
                    "オンライン同期が無効のため、QR招待は使えません。参加者を追加して、幹事が代行でベットを入力できます。",
                    "Online sync is off, so QR invitations aren't available. Add bettors and enter their bets as the host.",
                  )}
            </p>
          </div>
        </div>
      )}

      <div className="sticky-actions">
        <button className="button button--primary button--block button--lg" type="button" onClick={done}>
          {props.isNew ? t("進行画面へ", "Continue") : t("閉じる", "Done")}
        </button>
      </div>
    </div>
  );
}
