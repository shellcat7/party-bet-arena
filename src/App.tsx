import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmProvider, ToastProvider, useNotify } from "./components/feedback";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BrandMark } from "./components/ui";
import { I18nProvider, useI18n } from "./i18n/i18n";
import { parseInviteUrl } from "./lib/ids";
import type { Preferences } from "./lib/storage";
import { loadPreferences, savePreferences } from "./lib/storage";
import type { LanguageName } from "./lib/types";
import { CreateRoomScreen } from "./screens/CreateRoomScreen";
import { JoinScreen } from "./screens/JoinScreen";
import { LaunchScreen } from "./screens/LaunchScreen";
import { RoomShell } from "./screens/room/RoomShell";
import { AppContext } from "./state/AppContext";
import { homeScreenFor, ROOM_SCREENS, useNavigation } from "./state/navigation";
import { useRoomController } from "./state/useRoomController";

const InviteScreen = lazy(() => import("./screens/InviteScreen"));

function useResolvedTheme(preference: Preferences["theme"]) {
  const query = "(prefers-color-scheme: dark)";
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0d0f12" : "#f4f5f7");
  }, [theme]);
}

export default function App() {
  const [preferences, setPreferencesState] = useState(loadPreferences);
  const setPreferences = useCallback((update: Partial<Preferences>) => {
    setPreferencesState((current) => {
      const next = { ...current, ...update };
      savePreferences(next);
      return next;
    });
  }, []);
  const setLanguage = useCallback((language: LanguageName) => setPreferences({ language }), [setPreferences]);

  useResolvedTheme(preferences.theme);
  useEffect(() => {
    document.documentElement.lang = preferences.language;
  }, [preferences.language]);

  return (
    <ErrorBoundary language={preferences.language}>
      <I18nProvider language={preferences.language} onLanguageChange={setLanguage}>
        <ToastProvider>
          <ConfirmProvider>
            <AppShell preferences={preferences} setPreferences={setPreferences} />
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}

function AppShell(props: {
  preferences: Preferences;
  setPreferences: (update: Partial<Preferences>) => void;
}) {
  const { t, language } = useI18n();
  const notify = useNotify();
  const controller = useRoomController({ t, notify, language });
  const { room, role, resuming } = controller;
  const [initialScreen] = useState(() =>
    parseInviteUrl(window.location.href)
      ? ({ name: "join" } as const)
      : room
        ? homeScreenFor(role)
        : ({ name: "launch" } as const),
  );
  const nav = useNavigation(initialScreen);
  const { screen, reset } = nav;

  // Each new screen starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen]);

  // Leave room screens when the room goes away (left, deleted, or access revoked).
  useEffect(() => {
    if (!room && ROOM_SCREENS.has(screen.name)) reset({ name: "launch" });
  }, [room, screen.name, reset]);

  // After reconnecting to an online room on startup, jump straight back into it.
  const wasResuming = useRef(resuming);
  useEffect(() => {
    if (!wasResuming.current || resuming) return;
    wasResuming.current = false;
    if (room) reset(homeScreenFor(role));
  }, [resuming, room, role, reset]);

  const value = useMemo(
    () => ({ controller, nav, preferences: props.preferences, setPreferences: props.setPreferences }),
    [controller, nav, props.preferences, props.setPreferences],
  );

  let content;
  if (resuming) {
    content = (
      <div className="splash" role="status">
        <BrandMark size={64} />
        <p>{t("ルームに再接続しています…", "Reconnecting to your room…")}</p>
      </div>
    );
  } else if (room && ROOM_SCREENS.has(screen.name)) {
    content =
      screen.name === "invite" ? (
        <Suspense fallback={<div className="splash" />}>
          <InviteScreen isNew={Boolean(screen.isNew)} />
        </Suspense>
      ) : (
        <RoomShell />
      );
  } else if (screen.name === "join") {
    content = <JoinScreen />;
  } else if (screen.name === "create") {
    content = <CreateRoomScreen />;
  } else {
    content = <LaunchScreen />;
  }

  return (
    <AppContext.Provider value={value}>
      <main className={room && ROOM_SCREENS.has(screen.name) ? "app app--room" : "app app--entry"}>
        <section className="app-frame" aria-label={t("ランクパーティ", "Rank Party")}>
          {content}
        </section>
      </main>
    </AppContext.Provider>
  );
}
