import { createContext, useContext } from "react";
import type { Room } from "../lib/types";
import type { Preferences } from "../lib/storage";
import type { Navigation } from "./navigation";
import type { RoomController } from "./useRoomController";

export type AppContextValue = {
  controller: RoomController;
  nav: Navigation;
  preferences: Preferences;
  setPreferences: (update: Partial<Preferences>) => void;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside <AppContext.Provider>");
  return context;
}

/** For screens that only render while a room is open. */
export function useOpenRoom(): AppContextValue & { room: Room } {
  const context = useApp();
  if (!context.controller.room) throw new Error("No room is open");
  return { ...context, room: context.controller.room };
}
