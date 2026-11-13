/**
 * The five places Alfred is organised into, and where the old addresses went. Kept free of React so a test can check it.
 *
 * Today `/`, Activity `/activity`, Money `/money`, Plan `/plan`, and You `/you` (with Settings and Categories under it).
 */

export type Hub = "today" | "activity" | "money" | "plan" | "you";

export const HUB_PATHS: Record<Hub, string> = { today: "/", activity: "/activity", money: "/money", plan: "/plan", you: "/you" };

/** Which of the five a page belongs to, so its tab or rail item shows as current. */
export function hubOf(path: string): Hub {
  if (path === "/activity") return "activity";
  if (path === "/money") return "money";
  if (path === "/plan") return "plan";
  if (path === "/you" || path === "/settings" || path === "/categories") return "you";
  return "today";
}

/** Old address → where it lives now. The query string and "#section" carry over unless the new place sets its own view. */
const MOVED: Record<string, string> = {
  "/transactions": "/activity",
  "/accounts": "/money",
  "/more": "/you",
};

/** Budgets, Freedom and Protection used to be pages of their own; they are views of Plan now. */
const PLAN_VIEWS: Record<string, string> = { "/budgets": "budgets", "/freedom": "foundations", "/protection": "protection" };

/**
 * The new address for an old one, or null when the address is current. Pass the pieces of `window.location`.
 */
export function redirectFor(path: string, search: string, hash: string): string | null {
  const moved = MOVED[path];
  if (moved) return `${moved}${search}${hash}`;
  const view = PLAN_VIEWS[path];
  if (view) {
    const params = new URLSearchParams(search);
    // An old Budgets address that already names a view (Budgets once shared its page with Recurring and Goals) keeps it.
    if (!(path === "/budgets" && params.has("view"))) params.set("view", view);
    return `/plan?${params.toString()}${hash}`;
  }
  return null;
}
