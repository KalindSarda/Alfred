import { useSyncExternalStore } from "react";

/** True while the window is at least `px` wide. Lets a page mount one layout instead of two, so nothing is fetched or drawn twice. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return useSyncExternalStore(
    (callback) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tablet width and up. */
export const useWide = (): boolean => useMinWidth(768);

/** Wide enough for a list with its detail beside it. */
export const useSplit = (): boolean => useMinWidth(1100);
