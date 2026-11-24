import { useSyncExternalStore } from "react";

/**
 * Where the person is in the tour: a step number, or null when no tour is on. Kept for the browser tab (so a reload does not
 * lose the place) and shared by every screen, so the guide follows them as they open the screens it points at.
 */
const KEY = "alfred.tour";

function read(): number | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

let step: number | null = typeof window === "undefined" ? null : read();
const listeners = new Set<() => void>();

function set(next: number | null): void {
  step = next;
  try {
    if (next === null) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, String(next));
  } catch {
    // Storage can be blocked; the tour still works until the page is reloaded.
  }
  for (const listener of listeners) listener();
}

export const startTour = (at = 0): void => set(at);
export const setTourStep = (at: number): void => set(at);
export const endTour = (): void => set(null);

export function useTourStep(): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => step,
    () => null,
  );
}
