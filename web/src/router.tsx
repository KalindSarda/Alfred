import { type AnchorHTMLAttributes, type MouseEvent, useCallback, useEffect, useSyncExternalStore } from "react";

const NAV_EVENT = "fin:navigate";

function subscribe(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener(NAV_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(NAV_EVENT, callback);
  };
}

const getPath = () => window.location.pathname;
const getSearch = () => window.location.search;
const getHash = () => window.location.hash;

export function usePath(): string {
  return useSyncExternalStore(subscribe, getPath, () => "/");
}

/** The query string including the leading "?" (or an empty string). */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, getSearch, () => "");
}

/** The "#section" part of the address (or an empty string), used to scroll to a card on a page. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, getHash, () => "");
}

export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search + window.location.hash) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
  if (!to.includes("#")) window.scrollTo(0, 0);
}

/**
 * Scrolls to the card named by the address's "#section" once it exists. A card may only appear after its data loads,
 * so this looks for a few seconds before giving up.
 */
export function useScrollToHash(path: string, search: string): void {
  const hash = useHash();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ block: "start" });
        window.clearInterval(timer);
      } else if (++tries > 40) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [hash, path, search]);
}

/** Moves to another address without adding a history entry, for an old address that now lives elsewhere. */
export function replacePath(to: string): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history.replaceState({}, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
}

/** Changes only the query string of the current page, without adding a history entry per keystroke. */
export function replaceSearch(search: string): void {
  if (search === window.location.search) return;
  window.history.replaceState({}, "", window.location.pathname + search);
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function useNavigate(): (to: string) => void {
  return useCallback(navigate, []);
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
