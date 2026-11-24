import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Notify } from "../components/feedback";
import { betErrorMessage, firebaseIssueMessage } from "../i18n/copy";
import type { Translate } from "../i18n/i18n";
import { addBet, createBet, getPlayer, validateBet } from "../lib/betting";
import { DEMO_JOIN_CODE, DEMO_ROOM_ID, pickEmoji } from "../lib/constants";
import {
  addRemotePlayer,
  createRemoteRoom,
  deleteRemoteRoom,
  ensureSignedIn,
  fetchRemoteRoom,
  getFirebaseIssueKind,
  isFirebaseConfigured,
  joinRemoteRoom,
  placeRemoteBet,
  removeRemoteBet,
  removeRemoteMember,
  subscribeConnection,
  subscribeRemoteRoom,
  transactRoom,
  updateRemoteRoom,
} from "../lib/firebase";
import { JOIN_CODE_PATTERN, normalizeCodeInput, parseInviteUrl, ROOM_ID_PATTERN } from "../lib/ids";
import { buildRoomPatch } from "../lib/patch";
import * as rooms from "../lib/room";
import {
  advanceRace,
  closeBetting,
  isCompleteResult,
  reopenBetting,
  settleRace,
  unsettleRace,
} from "../lib/settlement";
import type { RoomSummary, Session } from "../lib/storage";
import {
  forgetRoom,
  loadRoomSnapshot,
  loadRoomSummaries,
  loadSession,
  rememberRoom,
  saveRoomSnapshot,
  saveSession,
} from "../lib/storage";
import type { AppRole, DraftBet, LanguageName, Player, Room } from "../lib/types";

export type Connection = "local" | "connecting" | "online" | "offline";

export type RoomController = ReturnType<typeof useRoomController>;

type Options = { t: Translate; notify: Notify; language: LanguageName };

/** A room is synced through Firebase unless it is the demo or Firebase isn't configured. */
const isRemoteRoom = (room: Room) => isFirebaseConfigured && !room.isDemo;

class TimeoutError extends Error {
  constructor() {
    super("network timeout: the server did not respond");
    this.name = "TimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function initialState(): { room: Room | null; session?: Session; resumeRemote?: Session } {
  const session = loadSession();
  if (!session || parseInviteUrl(window.location.href)) return { room: null };
  const snapshot = loadRoomSnapshot(session.roomId);
  if (snapshot && !isRemoteRoom(snapshot)) return { room: snapshot, session };
  if (isFirebaseConfigured && session.roomId !== DEMO_ROOM_ID) return { room: null, resumeRemote: session };
  return { room: null };
}

type Membership =
  | { status: "ok"; room: Room; role: AppRole; playerId?: string }
  | { status: "not-found" }
  | { status: "not-member" };

/** Fetches an online room and works out this device's role in it. */
async function loadMembership(roomId: string): Promise<Membership> {
  const uid = await withTimeout(ensureSignedIn());
  const remote = await withTimeout(fetchRemoteRoom(roomId));
  if (!remote) return { status: "not-found" };
  if (remote.hostUid === uid) return { status: "ok", room: remote, role: "host" };
  const me = remote.players.find((player) => player.uid === uid);
  return me ? { status: "ok", room: remote, role: "player", playerId: me.id } : { status: "not-member" };
}

/**
 * Owns the open room, the device's role in it, and every action the UI can take.
 *
 * Mutations are written optimistically to local state, then persisted:
 * - demo / offline rooms → a full snapshot in localStorage;
 * - online rooms → a minimal multi-path patch (see `buildRoomPatch`) so concurrent writes from
 *   other devices are never clobbered. Participants write only their own player record and bet.
 */
export function useRoomController({ t, notify, language }: Options) {
  const [initial] = useState(initialState);
  const [room, setRoomState] = useState<Room | null>(initial.room);
  const [session, setSessionState] = useState<Session | undefined>(initial.session);
  const [summaries, setSummaries] = useState<RoomSummary[]>(loadRoomSummaries);
  const [connection, setConnection] = useState<Connection>(isFirebaseConfigured ? "connecting" : "local");
  const [resuming, setResuming] = useState(Boolean(initial.resumeRemote));
  const [busy, setBusy] = useState(false);
  const roomRef = useRef(room);
  const deletingRoomId = useRef<string | null>(null);

  const setRoom = useCallback((next: Room | null) => {
    roomRef.current = next;
    setRoomState(next);
  }, []);

  const setSession = useCallback((next: Session | undefined) => {
    setSessionState(next);
    saveSession(next);
  }, []);

  const reportError = useCallback(
    (error: unknown) => {
      console.error(error);
      notify.error(firebaseIssueMessage(t, getFirebaseIssueKind(error)));
    },
    [notify, t],
  );

  /** Opens a room in this device's UI and records it for the launcher. */
  const enterRoom = useCallback(
    (next: Room, role: AppRole, playerId?: string) => {
      setRoom(next);
      setSession({ roomId: next.id, role, ...(playerId ? { playerId } : {}) });
      if (!isRemoteRoom(next)) saveRoomSnapshot(next);
      setSummaries(rememberRoom(next, role, !isRemoteRoom(next)));
    },
    [setRoom, setSession],
  );

  const closeRoom = useCallback(() => {
    setRoom(null);
    setSession(undefined);
  }, [setRoom, setSession]);

  /* ------------------------------------------------------------------ persistence of mutations */

  const persist = useCallback(
    async (previous: Room, next: Room) => {
      if (!isRemoteRoom(next)) {
        saveRoomSnapshot(next);
        setSummaries(rememberRoom(next, "host", true));
        return true;
      }
      try {
        // While offline the SDK queues the write and the promise stays pending; stop waiting after
        // a while and tell the host. The queued write is sent when the connection returns, as long
        // as the app stays open.
        await withTimeout(updateRemoteRoom(next.id, buildRoomPatch(previous, next)));
        return true;
      } catch (error) {
        reportError(error);
        return false;
      }
    },
    [reportError],
  );

  /** Applies a host-side change to the latest known room. */
  const mutate = useCallback(
    async (update: (current: Room) => Room) => {
      const previous = roomRef.current;
      if (!previous) return false;
      const next = update(previous);
      if (next === previous) return true;
      setRoom(next);
      return persist(previous, next);
    },
    [persist, setRoom],
  );

  /* ------------------------------------------------------------------------- remote listeners */

  const remoteRoomId = room && isRemoteRoom(room) ? room.id : null;

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    subscribeConnection((connected) => setConnection(connected ? "online" : "offline"))
      .then((cleanup) => (cancelled ? cleanup() : (unsubscribe = cleanup)))
      .catch(() => setConnection("offline"));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!remoteRoomId) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    subscribeRemoteRoom(
      remoteRoomId,
      (remote) => {
        if (cancelled) return;
        if (!remote) {
          // Deleting a room also revokes read access; that follow-up error is expected.
          cancelled = true;
          if (deletingRoomId.current === remoteRoomId) return;
          notify.info(t("このルームは幹事によって削除されました。", "The host deleted this room."));
          setSummaries(forgetRoom(remoteRoomId));
          closeRoom();
          return;
        }
        setRoom(remote);
      },
      (error) => {
        if (cancelled || deletingRoomId.current === remoteRoomId) return;
        if (getFirebaseIssueKind(error) === "permission") {
          // Membership was revoked (removed by the host) or the room no longer exists.
          notify.info(
            t("このルームにはアクセスできなくなりました。", "You no longer have access to this room."),
          );
          setSummaries(forgetRoom(remoteRoomId));
          closeRoom();
        } else {
          reportError(error);
        }
      },
    )
      .then((cleanup) => (cancelled ? cleanup() : (unsubscribe = cleanup)))
      .catch(reportError);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [remoteRoomId, closeRoom, notify, reportError, setRoom, t]);

  /* -------------------------------------------------------------------------- entering rooms */

  const openRoom = useCallback(
    async (roomId: string, options: { silent?: boolean } = {}): Promise<AppRole | null> => {
      const local = loadRoomSnapshot(roomId);
      if (local && !isRemoteRoom(local)) {
        const role = summaries.find((item) => item.id === roomId)?.role ?? "host";
        enterRoom(local, role, role === "player" ? loadSession()?.playerId : undefined);
        return role;
      }
      if (!isFirebaseConfigured) {
        notify.error(t("このルームは見つかりませんでした。", "This room is no longer available."));
        return null;
      }
      setBusy(true);
      try {
        const membership = await loadMembership(roomId);
        if (membership.status === "not-found") {
          notify.error(
            t(
              "ルームが見つかりません。削除された可能性があります。",
              "Room not found. It may have been deleted.",
            ),
          );
          setSummaries(forgetRoom(roomId));
          return null;
        }
        if (membership.status === "not-member") {
          notify.error(t("この端末の参加情報が見つかりません。", "This device isn't a member of that room."));
          return null;
        }
        enterRoom(membership.room, membership.role, membership.playerId);
        if (!options.silent) notify.success(t("ルームを開きました", "Room opened"));
        return membership.role;
      } catch (error) {
        if (getFirebaseIssueKind(error) === "permission") {
          notify.error(t("このルームを開く権限がありません。", "You can't open this room from this device."));
          setSummaries(forgetRoom(roomId));
        } else {
          reportError(error);
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [enterRoom, notify, reportError, summaries, t],
  );

  // Reconnect to the online room this device had open before a reload. Failures fall back
  // quietly to the launcher, where the room is still listed.
  const resumeRoomId = initial.resumeRemote?.roomId;
  useEffect(() => {
    if (!resumeRoomId) return;
    let cancelled = false;
    loadMembership(resumeRoomId)
      .then((membership) => {
        if (!cancelled && membership.status === "ok")
          enterRoom(membership.room, membership.role, membership.playerId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeRoomId, enterRoom]);

  const createRoom = useCallback(
    async (input: rooms.RoomCreateInput) => {
      if (!isFirebaseConfigured) {
        enterRoom(rooms.createRoom(input), "host");
        return true;
      }
      setBusy(true);
      try {
        const uid = await withTimeout(ensureSignedIn());
        const next = rooms.createRoom(input, uid);
        // Realtime Database writes wait for the server while offline; don't leave the host
        // staring at a spinner — creation needs a connection.
        await withTimeout(createRemoteRoom(next));
        enterRoom(next, "host");
        return true;
      } catch (error) {
        reportError(error);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [enterRoom, reportError],
  );

  const startDemo = useCallback(
    (options: { reset?: boolean } = {}) => {
      const existing = options.reset ? undefined : loadRoomSnapshot(DEMO_ROOM_ID);
      enterRoom(existing ?? rooms.createDemoRoom(language), "host");
    },
    [enterRoom, language],
  );

  /** Demo only: look at the room through a participant's eyes. */
  const switchPerspective = useCallback(
    (playerId: string | null) => {
      const current = roomRef.current;
      if (!current?.isDemo) return;
      setSession(
        playerId ? { roomId: current.id, role: "player", playerId } : { roomId: current.id, role: "host" },
      );
    },
    [setSession],
  );

  const joinRoom = useCallback(
    async (input: { roomId: string; joinCode: string; name: string }): Promise<AppRole | null> => {
      const roomId = normalizeCodeInput(input.roomId);
      const joinCode = normalizeCodeInput(input.joinCode);
      if (roomId === DEMO_ROOM_ID && joinCode === DEMO_JOIN_CODE) {
        startDemo();
        return "host" as const;
      }
      if (!ROOM_ID_PATTERN.test(roomId) || !JOIN_CODE_PATTERN.test(joinCode)) {
        notify.error(
          t(
            "ルームIDは12文字、参加コードは16文字です。招待リンクを確認してください。",
            "Room IDs have 12 characters and join codes 16. Check your invitation.",
          ),
        );
        return null;
      }
      if (!isFirebaseConfigured) {
        notify.error(
          t(
            "このビルドはオンライン同期が無効のため、他の端末のルームに参加できません。",
            "Online sync is disabled in this build, so rooms on other devices can't be joined.",
          ),
        );
        return null;
      }

      setBusy(true);
      try {
        const uid = await withTimeout(ensureSignedIn());
        try {
          await withTimeout(joinRemoteRoom(roomId, joinCode, uid));
        } catch (error) {
          if (getFirebaseIssueKind(error) === "permission") {
            notify.error(t("ルームIDまたは参加コードが違います。", "The room ID or join code is incorrect."));
            return null;
          }
          throw error;
        }
        const remote = await withTimeout(fetchRemoteRoom(roomId));
        if (!remote) {
          notify.error(t("ルームが見つかりません。", "Room not found."));
          return null;
        }
        if (remote.hostUid === uid) {
          enterRoom(remote, "host");
          return "host" as const;
        }
        const existing = remote.players.find((player) => player.uid === uid);
        if (existing) {
          enterRoom(remote, "player", existing.id);
          notify.success(t("{name}として再参加しました", "Welcome back, {name}", { name: existing.name }));
          return "player" as const;
        }
        if (!rooms.canAddPlayer(remote)) {
          notify.error(
            t("このルームは満員です（最大{max}人）。", "This room is full (max {max}).", {
              max: remote.settings.maxPlayers,
            }),
          );
          return null;
        }
        const name = input.name.trim() || t("参加者{n}", "Player {n}", { n: remote.players.length + 1 });
        const player = rooms.buildPlayer(remote, {
          id: uid,
          uid,
          name,
          emoji: pickEmoji(remote.players.length + 3),
          isOffline: false,
        });
        await withTimeout(addRemotePlayer(remote.id, player));
        enterRoom(rooms.addPlayer(remote, player), "player", player.id);
        notify.success(t("{name}として参加しました", "Joined as {name}", { name }));
        return "player" as const;
      } catch (error) {
        reportError(error);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [enterRoom, notify, reportError, startDemo, t],
  );

  const deleteRoom = useCallback(
    async (roomId: string) => {
      const summary = summaries.find((item) => item.id === roomId);
      const isOpen = roomRef.current?.id === roomId;
      const role = isOpen ? session?.role : summary?.role;
      if (isFirebaseConfigured && role === "host" && !summary?.isLocal && roomId !== DEMO_ROOM_ID) {
        deletingRoomId.current = roomId;
        try {
          await deleteRemoteRoom(roomId);
        } catch (error) {
          if (getFirebaseIssueKind(error) !== "permission") {
            reportError(error);
            deletingRoomId.current = null;
            return false;
          }
        }
      }
      setSummaries(forgetRoom(roomId));
      if (isOpen) closeRoom();
      return true;
    },
    [closeRoom, reportError, session?.role, summaries],
  );

  /* ------------------------------------------------------------------------------- betting */

  const placeBet = useCallback(
    async (draft: Omit<DraftBet, "placedBy" | "uid">) => {
      const current = roomRef.current;
      if (!current || !session) return false;
      const placedBy = session.role === "host" ? "host" : "self";
      const ticket: DraftBet = { ...draft, placedBy };
      const error = validateBet(current, ticket);
      if (error) {
        notify.error(betErrorMessage(t, error));
        return false;
      }

      if (placedBy === "self" && isRemoteRoom(current)) {
        try {
          const bet = createBet({ ...ticket, uid: await ensureSignedIn() });
          setRoom(addBet(current, bet));
          await withTimeout(placeRemoteBet(current.id, bet));
        } catch (failure) {
          reportError(failure);
          return false;
        }
      } else {
        const ok = await mutate((room) => addBet(room, createBet(ticket)));
        if (!ok) return false;
      }
      notify.success(t("ベットを受け付けました", "Bet placed"));
      return true;
    },
    [mutate, notify, reportError, session, setRoom, t],
  );

  /* ---------------------------------------------------------------------------- race control */

  /**
   * Race transitions and payouts. Demo/offline rooms apply them locally; online rooms run them as
   * database transactions against the server's current state, so a stale tab or a cached copy can
   * never reopen a settled race, pay out twice, or settle without bets the server accepted.
   */
  const transition = useCallback(
    async (apply: (room: Room) => Room | null) => {
      const current = roomRef.current;
      if (!current) return false;
      if (!isRemoteRoom(current)) {
        const next = apply(current);
        if (!next) return false;
        return mutate(() => next);
      }
      if (connection !== "online") {
        notify.error(
          t(
            "オフラインのため実行できません。接続を確認してください。",
            "You're offline. Reconnect and try again.",
          ),
        );
        return false;
      }
      setBusy(true);
      try {
        const next = await withTimeout(transactRoom(current.id, apply));
        if (!next) {
          notify.info(
            t("ほかの端末ですでに更新されています。", "This was already updated on another device."),
          );
          return false;
        }
        setRoom(next);
        return true;
      } catch (error) {
        reportError(error);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [connection, mutate, notify, reportError, setRoom, t],
  );

  const raceId = () => roomRef.current?.currentRace.id ?? "";

  const closeBettingAction = useCallback(() => {
    const id = raceId();
    return transition((room) => closeBetting(room, id));
  }, [transition]);

  const reopenBettingAction = useCallback(() => {
    const id = raceId();
    return transition((room) => reopenBetting(room, id));
  }, [transition]);

  const settle = useCallback(
    (resultIds: string[]) => {
      const current = roomRef.current;
      if (!current) return Promise.resolve(false);
      if (!isCompleteResult(current, resultIds)) {
        notify.error(
          t("1着から最下位まで、すべての着順を選んでください。", "Rank every racer from first to last."),
        );
        return Promise.resolve(false);
      }
      const id = current.currentRace.id;
      return transition((room) => settleRace(room, id, resultIds));
    },
    [notify, t, transition],
  );

  const undoSettlement = useCallback(() => {
    const id = raceId();
    return transition((room) => unsettleRace(room, id));
  }, [transition]);

  /** A participant withdraws their own ticket (to change it) while betting is open. */
  const cancelOwnBet = useCallback(async () => {
    const current = roomRef.current;
    const playerId = session?.playerId;
    if (!current || !playerId) return false;
    const bet = current.currentRace.bets.find(
      (item) => item.playerId === playerId && item.placedBy === "self",
    );
    if (!bet || current.currentRace.status !== "betting") return false;
    if (!isRemoteRoom(current)) return mutate((room) => rooms.removeBet(room, bet.id));
    try {
      setRoom(rooms.removeBet(current, bet.id));
      await withTimeout(removeRemoteBet(current.id, bet.id));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }, [mutate, reportError, session?.playerId, setRoom]);

  const nextRace = useCallback(() => {
    const id = raceId();
    return transition((room) => advanceRace(room, id));
  }, [transition]);

  const grantBonus = useCallback(
    (playerId: string, amount: number) =>
      transition((room) =>
        room.players.some((player) => player.id === playerId)
          ? rooms.grantBonus(room, playerId, amount)
          : null,
      ),
    [transition],
  );

  const removePlayer = useCallback(
    async (playerId: string) => {
      const current = roomRef.current;
      const uid = current?.players.find((player) => player.id === playerId)?.uid;
      const ok = await mutate((room) => rooms.removePlayer(room, playerId));
      if (ok && current && uid && isRemoteRoom(current)) {
        await removeRemoteMember(current.id, uid).catch(reportError);
      }
      return ok;
    },
    [mutate, reportError],
  );

  /* ------------------------------------------------------------------------- derived values */

  const role: AppRole = session?.role ?? "host";
  const me: Player | undefined = room && role === "player" ? getPlayer(room, session?.playerId) : undefined;

  const actions = useMemo(
    () => ({
      createRoom,
      startDemo,
      switchPerspective,
      joinRoom,
      openRoom,
      closeRoom,
      deleteRoom,
      placeBet,
      closeBetting: closeBettingAction,
      reopenBetting: reopenBettingAction,
      settle,
      undoSettlement,
      cancelOwnBet,
      nextRace,
      renameRoom: (name: string) => mutate((current) => rooms.renameRoom(current, name)),
      updateSettings: (patch: rooms.SettingsPatch) =>
        mutate((current) => rooms.updateSettings(current, patch)),
      addPlayer: (input: rooms.NewPlayerInput) =>
        mutate((current) =>
          rooms.canAddPlayer(current) ? rooms.addPlayer(current, rooms.buildPlayer(current, input)) : current,
        ),
      updatePlayer: (playerId: string, patch: Parameters<typeof rooms.updatePlayer>[2]) =>
        mutate((current) => rooms.updatePlayer(current, playerId, patch)),
      removePlayer,
      removeBet: (betId: string) => mutate((current) => rooms.removeBet(current, betId)),
      grantBonus,
      addContestant: (input: rooms.NewContestantInput) =>
        mutate((current) =>
          rooms.canAddContestant(current) ? rooms.addContestant(current, input) : current,
        ),
      updateContestant: (contestantId: string, patch: rooms.ContestantPatch) =>
        mutate((current) => rooms.updateContestant(current, contestantId, patch)),
      setContestantOdds: (contestantId: string, odds: number) =>
        mutate((current) => rooms.setContestantOdds(current, contestantId, odds)),
      removeContestant: (contestantId: string) =>
        mutate((current) =>
          rooms.canRemoveContestant(current) ? rooms.removeContestant(current, contestantId) : current,
        ),
      recalculateOdds: () => mutate((current) => rooms.recalculateOdds(current)),
    }),
    [
      closeBettingAction,
      closeRoom,
      createRoom,
      deleteRoom,
      joinRoom,
      mutate,
      nextRace,
      openRoom,
      placeBet,
      removePlayer,
      reopenBettingAction,
      grantBonus,
      settle,
      undoSettlement,
      cancelOwnBet,
      startDemo,
      switchPerspective,
    ],
  );

  return {
    room,
    role,
    me,
    session,
    summaries,
    connection: room && !isRemoteRoom(room) ? ("local" as const) : connection,
    resuming,
    busy,
    isOnlineRoom: Boolean(room && isRemoteRoom(room)),
    actions,
  };
}
