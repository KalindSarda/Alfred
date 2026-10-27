import { type AnchorHTMLAttributes, type MouseEvent, useCallback, useSyncExternalStore } from "react";

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

export function usePath(): string {
  return useSyncExternalStore(subscribe, getPath, () => "/");
}

/** The query string including the leading "?" (or an empty string). */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, getSearch, () => "");
}

export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
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
