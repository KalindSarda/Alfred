import { useSyncExternalStore } from "react";

import { type NavStyle, parseNavStyle } from "./navChoice";

export type { NavStyle };

const KEY = "alfred.nav";
const EVENT = "alfred:nav";

export function getNavStyle(): NavStyle {
  try {
    return parseNavStyle(window.localStorage.getItem(KEY));
  } catch {
    return "side";
  }
}

export function setNavStyle(style: NavStyle): void {
  try {
    window.localStorage.setItem(KEY, style);
  } catch {
    // Private windows and blocked storage still switch for this visit.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export const useNavStyle = (): NavStyle => useSyncExternalStore(subscribe, getNavStyle, () => "side");
