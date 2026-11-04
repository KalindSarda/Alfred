/** The Accounts page has two views, switched by "?view=commitments" in the address so links can point at either. */
export type AccountsView = "accounts" | "commitments";

export function viewFromSearch(search: string): AccountsView {
  return new URLSearchParams(search).get("view") === "commitments" ? "commitments" : "accounts";
}

/** The query string for a view; the default view needs none. */
export const searchForView = (view: AccountsView): string => (view === "commitments" ? "?view=commitments" : "");

/** Where a link to a view goes. */
export const accountsPath = (view: AccountsView): string => `/accounts${searchForView(view)}`;
