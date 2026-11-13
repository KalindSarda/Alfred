/** The Plan page has an overview and views for what you set up ahead of time and how you are doing, switched by "?view=" in the address so links can point at any. */
export type PlanView = "overview" | "budgets" | "recurring" | "goals" | "foundations" | "protection";

const VIEWS: readonly PlanView[] = ["budgets", "recurring", "goals", "foundations", "protection"];

export function viewFromSearch(search: string): PlanView {
  const view = new URLSearchParams(search).get("view");
  return VIEWS.find((v) => v === view) ?? "overview";
}

/** The query string for a view; the overview needs none. */
export const searchForView = (view: PlanView): string => (view === "overview" ? "" : `?view=${view}`);

/** Where a link to a view goes. */
export const planPath = (view: PlanView): string => `/plan${searchForView(view)}`;
