import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRole } from "../lib/types";

export type ManageSection = "bettors" | "racers" | "rules";

export type Screen =
  | { name: "launch" }
  | { name: "join" }
  | { name: "create" }
  | { name: "invite"; isNew?: boolean }
  | { name: "home" }
  | { name: "bet" }
  | { name: "ranking" }
  | { name: "history" }
  | { name: "manage"; section?: ManageSection }
  | { name: "results" }
  | { name: "race"; raceId?: string }
  | { name: "final" };

export type ScreenName = Screen["name"];

export const ROOM_SCREENS = new Set<ScreenName>([
  "invite",
  "home",
  "bet",
  "ranking",
  "history",
  "manage",
  "results",
  "race",
  "final",
]);

/** Screens reachable from the bottom navigation; everything else is pushed on top of them. */
export const TAB_SCREENS = new Set<ScreenName>(["home", "bet", "ranking", "history", "manage"]);

export const homeScreenFor = (role: AppRole): Screen => ({ name: role === "host" ? "home" : "bet" });

type HistoryState = { partyBetDepth?: number };

/**
 * A small stack navigator kept in sync with the browser history, so the Android back button,
 * iOS edge swipe and desktop back button move between screens instead of leaving the app.
 */
export function useNavigation(initial: Screen) {
  const [stack, setStack] = useState<Screen[]>([initial]);
  // Mirrors stack.length; kept in a ref so callbacks stay stable and never read render state.
  const depth = useRef(1);
  const rewinding = useRef(false);

  useEffect(() => {
    window.history.replaceState(
      { ...(window.history.state ?? {}), partyBetDepth: 1 } satisfies HistoryState,
      "",
    );
    const onPopState = (event: PopStateEvent) => {
      if (rewinding.current) {
        // Finished rewinding after reset(): this entry is now the root of the new stack.
        rewinding.current = false;
        window.history.replaceState({ partyBetDepth: 1 } satisfies HistoryState, "");
        return;
      }
      const target = Math.max(1, (event.state as HistoryState | null)?.partyBetDepth ?? 1);
      if (target >= depth.current) return;
      depth.current = target;
      setStack((current) => current.slice(0, target));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const push = useCallback((screen: Screen) => {
    depth.current += 1;
    window.history.pushState({ partyBetDepth: depth.current } satisfies HistoryState, "");
    setStack((current) => [...current, screen]);
  }, []);

  /** Replaces the current screen (used for tab switches). */
  const replace = useCallback((screen: Screen) => {
    setStack((current) => [...current.slice(0, -1), screen]);
  }, []);

  /** Starts a fresh stack, rewinding the browser history so old entries don't pile up. */
  const reset = useCallback((screen: Screen) => {
    const extra = depth.current - 1;
    depth.current = 1;
    setStack([screen]);
    if (extra > 0) {
      rewinding.current = true;
      window.history.go(-extra);
    } else {
      window.history.replaceState({ partyBetDepth: 1 } satisfies HistoryState, "");
    }
  }, []);

  const back = useCallback(() => {
    if (depth.current > 1) window.history.back();
  }, []);

  return { screen: stack[stack.length - 1], canGoBack: stack.length > 1, push, replace, reset, back };
}

export type Navigation = ReturnType<typeof useNavigation>;
