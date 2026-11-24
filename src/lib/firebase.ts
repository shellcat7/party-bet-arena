import type { Auth } from "firebase/auth";
import type { RoomPatch } from "./patch";
import { stripUndefined, toRoomPayload } from "./patch";
import { normalizeRoom } from "./room";
import type { Bet, Player, Room } from "./types";

/**
 * Thin wrapper around the Firebase SDK. The SDK is imported lazily so the app shell loads
 * instantly and works fully offline when no Firebase project is configured.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);

export type FirebaseIssueKind = "anonymous-auth" | "permission" | "database-url" | "network" | "unknown";

export function getFirebaseIssueKind(error: unknown): FirebaseIssueKind {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const detail = `${code} ${message}`.toLowerCase();
  if (detail.includes("auth/operation-not-allowed") || detail.includes("admin-restricted-operation")) {
    return "anonymous-auth";
  }
  if (detail.includes("permission_denied") || detail.includes("permission-denied")) return "permission";
  if (detail.includes("database_url") || detail.includes("databaseurl") || detail.includes("invalid-url")) {
    return "database-url";
  }
  if (detail.includes("network") || detail.includes("failed to fetch") || detail.includes("offline"))
    return "network";
  return "unknown";
}

type Services = Awaited<ReturnType<typeof loadServices>>;
let servicesPromise: Promise<Services> | undefined;

async function loadServices() {
  const [appModule, databaseModule, authModule] = await Promise.all([
    import("firebase/app"),
    import("firebase/database"),
    import("firebase/auth"),
  ]);
  const app = appModule.getApps()[0] ?? appModule.initializeApp(firebaseConfig);
  // `getAuth()` would also install the popup/redirect resolver, which injects a script from
  // apis.google.com that our Content Security Policy (rightly) blocks. Anonymous sign-in
  // only needs persistence.
  let auth: Auth;
  try {
    auth = authModule.initializeAuth(app, {
      persistence: [authModule.indexedDBLocalPersistence, authModule.browserLocalPersistence],
    });
  } catch {
    auth = authModule.getAuth(app); // already initialised (e.g. hot reload)
  }
  const db = databaseModule.getDatabase(app);
  if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
    authModule.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    databaseModule.connectDatabaseEmulator(db, "127.0.0.1", 9000);
  }
  return { auth, db, authModule, database: databaseModule };
}

async function services() {
  if (!isFirebaseConfigured) throw new Error("Firebase is not configured");
  servicesPromise ??= loadServices().catch((error) => {
    servicesPromise = undefined;
    throw error;
  });
  return servicesPromise;
}

/** Signs in anonymously if needed and returns this device's stable uid. */
export async function ensureSignedIn(): Promise<string> {
  const { auth, authModule } = await services();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  const credential = await authModule.signInAnonymously(auth);
  return credential.user.uid;
}

async function roomRef(roomId: string, path = "") {
  const { db, database } = await services();
  return database.ref(db, `rooms/${roomId}${path ? `/${path}` : ""}`);
}

export async function createRemoteRoom(room: Room) {
  if (!room.hostUid) throw new Error("A host uid is required");
  const { db, database } = await services();
  await database.set(database.ref(db, `rooms/${room.id}`), toRoomPayload(room));
  await database.set(database.ref(db, `roomMembers/${room.id}/${room.hostUid}`), {
    role: "host",
    joinCode: room.joinCode,
    joinedAt: room.createdAt,
  });
}

/** Applies a multi-path patch produced by `buildRoomPatch`. */
export async function updateRemoteRoom(roomId: string, patch: RoomPatch) {
  if (!Object.keys(patch).length) return;
  const { database } = await services();
  await database.update(await roomRef(roomId), stripUndefined(patch));
}

export async function fetchRemoteRoom(roomId: string): Promise<Room | null> {
  const { database } = await services();
  const snapshot = await database.get(await roomRef(roomId));
  return snapshot.exists() ? normalizeRoom(snapshot.val()) : null;
}

export async function subscribeRemoteRoom(
  roomId: string,
  onRoom: (room: Room | null) => void,
  onError: (error: Error) => void,
) {
  const { database } = await services();
  return database.onValue(
    await roomRef(roomId),
    (snapshot) => {
      try {
        onRoom(snapshot.exists() ? normalizeRoom(snapshot.val()) : null);
      } catch (error) {
        onError(error as Error);
      }
    },
    onError,
  );
}

/** Reports whether the Realtime Database websocket is currently connected. */
export async function subscribeConnection(onChange: (connected: boolean) => void) {
  const { db, database } = await services();
  return database.onValue(database.ref(db, ".info/connected"), (snapshot) =>
    onChange(snapshot.val() === true),
  );
}

/**
 * Registers this device as a participant. The rules accept the write only when the join code
 * matches the room's, which is how an invitation is verified without exposing the room first.
 */
export async function joinRemoteRoom(roomId: string, joinCode: string, uid: string) {
  const { db, database } = await services();
  const membershipRef = database.ref(db, `roomMembers/${roomId}/${uid}`);
  const membership = await database.get(membershipRef).catch(() => null);
  if (membership?.exists()) return;
  await database.set(membershipRef, { role: "player", joinCode, joinedAt: Date.now() });
}

export async function addRemotePlayer(roomId: string, player: Player) {
  const { database } = await services();
  await database.set(await roomRef(roomId, `players/${player.id}`), stripUndefined(player));
}

export async function placeRemoteBet(roomId: string, bet: Bet) {
  const { database } = await services();
  await database.set(await roomRef(roomId, `currentRace/bets/${bet.id}`), stripUndefined(bet));
}

/**
 * Applies `update` to the room inside a Realtime Database transaction: it always runs against the
 * server's current value and is retried if anything changed meanwhile. `update` returns null to
 * abort when the room is no longer in the state the caller expected (e.g. another tab settled it).
 * Resolves to the committed room, or null if aborted.
 */
export async function transactRoom(
  roomId: string,
  update: (room: Room) => Room | null,
): Promise<Room | null> {
  const { database } = await services();
  let committed: Room | null = null;
  const result = await database.runTransaction(await roomRef(roomId), (raw: unknown) => {
    // An empty local cache shows up as null; the SDK retries with the server value.
    if (raw === null) return raw;
    let next: Room | null;
    try {
      next = update(normalizeRoom(raw));
    } catch {
      next = null;
    }
    committed = next;
    return next ? toRoomPayload(next) : undefined;
  });
  return result.committed ? committed : null;
}

/** Revokes a participant's access, e.g. after the host removes them. */
export async function removeRemoteMember(roomId: string, uid: string) {
  const { db, database } = await services();
  await database.remove(database.ref(db, `roomMembers/${roomId}/${uid}`));
}

/** Deletes the room and every membership in one atomic write, so listeners see a clean removal. */
export async function deleteRemoteRoom(roomId: string) {
  const { db, database } = await services();
  await database.update(database.ref(db), { [`rooms/${roomId}`]: null, [`roomMembers/${roomId}`]: null });
}
