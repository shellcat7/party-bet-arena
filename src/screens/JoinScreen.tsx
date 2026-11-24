import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { useNotify } from "../components/feedback";
import { Field, PageHeader } from "../components/ui";
import { useI18n } from "../i18n/i18n";
import { LIMITS } from "../lib/constants";
import { JOIN_CODE_LENGTH, normalizeCodeInput, parseInviteUrl, ROOM_ID_LENGTH } from "../lib/ids";
import { useApp } from "../state/AppContext";
import { homeScreenFor } from "../state/navigation";
import { LanguageSwitch } from "./LaunchScreen";

type BarcodeDetectorLike = new (options?: { formats?: string[] }) => {
  detect: (source: ImageBitmap) => Promise<Array<{ rawValue: string }>>;
};

/** Reads a QR code from a photo: native BarcodeDetector where available, jsQR otherwise. */
async function decodeQrImage(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorLike }).BarcodeDetector;
    if (Detector) {
      const [result] = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
      if (result?.rawValue) return result.rawValue;
    }
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    return jsQR(data, width, height)?.data ?? null;
  } finally {
    bitmap.close();
  }
}

export function JoinScreen() {
  const { t } = useI18n();
  const notify = useNotify();
  const { controller, nav } = useApp();
  // An invitation link carries the credentials in the URL fragment.
  const [invite] = useState(() => parseInviteUrl(window.location.href));
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState(invite?.roomId ?? "");
  const [joinCode, setJoinCode] = useState(invite?.joinCode ?? "");
  const [scanning, setScanning] = useState(false);
  const [prefilled, setPrefilled] = useState(Boolean(invite));
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  const applyCredentials = (credentials: { roomId: string; joinCode: string }) => {
    setRoomId(credentials.roomId);
    setJoinCode(credentials.joinCode);
    setPrefilled(true);
    nameInput.current?.focus();
  };

  // Strip invitation credentials from the address bar so they don't linger in history or screenshots.
  useEffect(() => {
    if (!invite) return;
    nameInput.current?.focus();
    const url = new URL(window.location.href);
    url.hash = "";
    for (const key of ["roomId", "room", "id", "joinCode", "code"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, [invite]);

  const scan = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) {
      notify.error(t("15MB以下の画像を選んでください", "Choose an image under 15 MB"));
      return;
    }
    setScanning(true);
    try {
      const raw = await decodeQrImage(file);
      const credentials = raw ? parseInviteUrl(raw, window.location.href) : null;
      if (!credentials) throw new Error("No invitation in QR code");
      applyCredentials(credentials);
      notify.success(t("招待QRを読み取りました", "Invitation scanned"));
    } catch {
      notify.error(
        t(
          "招待QRが見つかりませんでした。IDとコードを入力してください。",
          "No invitation QR found. Enter the ID and code instead.",
        ),
      );
    } finally {
      setScanning(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const canSubmit = roomId.length > 0 && joinCode.length > 0 && !controller.busy;

  const submit = async () => {
    if (!canSubmit) return;
    const role = await controller.actions.joinRoom({ roomId, joinCode, name });
    if (role) nav.reset(homeScreenFor(role));
  };

  return (
    <div className="screen screen--entry">
      <PageHeader
        title={t("ルームに参加", "Join a room")}
        subtitle={t("幹事から届いた招待を入力してください", "Enter the invitation from your host")}
        onBack={nav.canGoBack ? nav.back : () => nav.reset({ name: "launch" })}
        actions={<LanguageSwitch />}
      />

      <form
        className="card form-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {prefilled && (
          <p className="notice notice--success" role="status">
            {t(
              "招待リンクの情報を入力しました。表示名を入力して参加してください。",
              "Invitation details filled in. Enter a display name to join.",
            )}
          </p>
        )}
        <Field
          label={t("表示名", "Display name")}
          hint={t("ランキングに表示されます", "Shown on the leaderboard")}
        >
          {(id) => (
            <input
              id={id}
              ref={nameInput}
              className="input"
              value={name}
              maxLength={LIMITS.maxNameLength}
              autoComplete="nickname"
              enterKeyHint="next"
              onChange={(event) => setName(event.target.value)}
              placeholder={t("例：ゆうた", "e.g. Alex")}
            />
          )}
        </Field>
        <Field label={t("ルームID（12文字）", "Room ID (12 characters)")}>
          {(id) => (
            <input
              id={id}
              className="input input--code"
              value={roomId}
              maxLength={ROOM_ID_LENGTH + 4}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setRoomId(normalizeCodeInput(event.target.value))}
              placeholder="ABCD EFGH JKLM"
            />
          )}
        </Field>
        <Field label={t("参加コード（16文字）", "Join code (16 characters)")}>
          {(id) => (
            <input
              id={id}
              className="input input--code"
              value={joinCode}
              maxLength={JOIN_CODE_LENGTH + 6}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setJoinCode(normalizeCodeInput(event.target.value))}
              placeholder="ABCD EFGH JKLM NPQR"
            />
          )}
        </Field>

        <input
          ref={fileInput}
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => void scan(event.target.files?.[0])}
        />
        <button
          className="button button--secondary button--block"
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={scanning}
        >
          <ScanLine size={20} />
          {scanning ? t("読み取り中…", "Scanning…") : t("QRコードの写真から読み取る", "Scan a QR code photo")}
        </button>
        <p className="form-help">
          {t(
            "スマホのカメラで招待QRを読み取ると、この画面が自動で入力された状態で開きます。",
            "Scanning the invitation QR with your phone camera opens this screen pre-filled.",
          )}
        </p>
        <button
          className="button button--primary button--block button--lg"
          type="submit"
          disabled={!canSubmit}
        >
          {controller.busy ? t("参加しています…", "Joining…") : t("参加する", "Join")}
        </button>
      </form>
    </div>
  );
}
