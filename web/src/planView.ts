/** The Plan page has views for what you set up ahead of time, switched by "?view=" in the address so links can point at any. */
export type PlanView = "budgets" | "recurring";

export function viewFromSearch(search: string): PlanView {
  return new URLSearchParams(search).get("view") === "recurring" ? "recurring" : "budgets";
}

/** The query string for a view; the default view needs none. */
export const searchForView = (view: PlanView): string => (view === "recurring" ? "?view=recurring" : "");

/** Where a link to a view goes. */
export const planPath = (view: PlanView): string => `/plan${searchForView(view)}`;
