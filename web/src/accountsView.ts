/** The Accounts page has three views, switched by "?view=commitments" in the address so links can point at either. */
export type AccountsView = "accounts" | "commitments" | "investments";

export function viewFromSearch(search: string): AccountsView {
  const view = new URLSearchParams(search).get("view");
  return view === "commitments" || view === "investments" ? view : "accounts";
}

/** The query string for a view; the default view needs none. */
export const searchForView = (view: AccountsView): string => (view === "accounts" ? "" : `?view=${view}`);

/** Where a link to a view goes. */
export const accountsPath = (view: AccountsView): string => `/accounts${searchForView(view)}`;
