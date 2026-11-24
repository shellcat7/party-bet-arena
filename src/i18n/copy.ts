import type { BetError } from "../lib/betting";
import type { FirebaseIssueKind } from "../lib/firebase";
import type { BetType, RaceStatus } from "../lib/types";
import type { Translate } from "./i18n";

/** Copy shared by several screens. */

export function betTypeCopy(t: Translate): Record<BetType, { title: string; note: string; prompt: string }> {
  return {
    win: {
      title: t("単勝", "Win"),
      note: t("1着を当てる", "Pick the winner"),
      prompt: t("1着になる対戦者を選んでください", "Choose the winner"),
    },
    place: {
      title: t("複勝", "Place"),
      note: t("3着以内を当てる", "Pick a top-3 finisher"),
      prompt: t("3着以内に入る対戦者を選んでください", "Choose a top-three finisher"),
    },
    exacta: {
      title: t("2連単", "Exacta"),
      note: t("1着・2着を順番通り", "1st and 2nd in order"),
      prompt: t("1着 → 2着の順にタップしてください", "Tap 1st, then 2nd"),
    },
    trifecta: {
      title: t("3連単", "Trifecta"),
      note: t("1〜3着を順番通り", "1st to 3rd in order"),
      prompt: t("1着 → 2着 → 3着の順にタップしてください", "Tap 1st, 2nd, then 3rd"),
    },
  };
}

export function raceStatusCopy(t: Translate): Record<RaceStatus, string> {
  return {
    betting: t("受付中", "Open"),
    closed: t("締切", "Closed"),
    settled: t("確定", "Settled"),
  };
}

export function raceName(t: Translate, number: number) {
  return t(`第${number}レース`, `Race ${number}`);
}

export function betErrorMessage(t: Translate, error: BetError) {
  const messages: Record<BetError, string> = {
    "betting-closed": t("このレースのベットは締め切られました", "Betting is closed for this race"),
    "no-player": t("ベットする参加者を選んでください", "Choose who is betting"),
    "already-placed": t("このレースはベット済みです", "You've already bet on this race"),
    "no-pick": t("対戦者を選んでください", "Choose a racer"),
    "incomplete-pick": t("必要な着順をすべて選んでください", "Pick every required position"),
    "duplicate-pick": t("同じ対戦者を複数の着順に選べません", "A racer can only fill one position"),
    "unknown-pick": t("選んだ対戦者が見つかりません", "That racer no longer exists"),
    "invalid-amount": t("ベット額を入力してください", "Enter a bet amount"),
    "insufficient-balance": t("残高が足りません", "Not enough points"),
    "unavailable-type": t(
      "対戦者の人数が少ないため、この券種は使えません",
      "Not enough racers for this ticket type",
    ),
  };
  return messages[error];
}

export function firebaseIssueMessage(t: Translate, kind: FirebaseIssueKind) {
  switch (kind) {
    case "anonymous-auth":
      return t(
        "Firebaseの匿名ログインが無効です。管理者に連絡してください。",
        "Anonymous sign-in is disabled for this Firebase project.",
      );
    case "permission":
      return t("この操作は許可されていません。", "You don't have permission to do that.");
    case "database-url":
      return t("データベースの接続設定に問題があります。", "The database URL appears to be misconfigured.");
    case "network":
      return t(
        "通信できませんでした。電波状況を確認してください。変更は端末に保存されています。",
        "Couldn't reach the server. Your change is kept on this device.",
      );
    default:
      return t("同期に失敗しました。もう一度お試しください。", "Sync failed. Please try again.");
  }
}
