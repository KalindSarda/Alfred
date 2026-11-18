import { viewFromSearch as moneyView } from "./accountsView";
import { viewFromSearch as planView } from "./planView";
import { type Hub, hubOf } from "./routes";

/**
 * Every screen in one tree: the sidebar, the phone's menu and the tests all read it, so a screen added here shows up in all of
 * them. Each item is its own address; where a page has several views, `view` says which one the item opens.
 */
export interface NavItem {
  id: string;
  label: string;
  /** The address it opens, including any "?view=". */
  to: string;
  path: string;
  view?: { of: "plan" | "money"; is: string };
}

export type NavIcon = "cashflow" | "transactions" | "accounts" | "budgets" | "grid";

export interface NavSection {
  hub: Hub;
  label: string;
  icon: NavIcon;
  items: NavItem[];
}

const plan = (id: string, label: string, view: string): NavItem => ({ id, label, to: view === "overview" ? "/plan" : `/plan?view=${view}`, path: "/plan", view: { of: "plan", is: view } });
const money = (id: string, label: string, view: string): NavItem => ({ id, label, to: view === "accounts" ? "/money" : `/money?view=${view}`, path: "/money", view: { of: "money", is: view } });

export const NAV: NavSection[] = [
  { hub: "today", label: "Today", icon: "cashflow", items: [{ id: "today", label: "Today", to: "/", path: "/" }] },
  {
    hub: "activity",
    label: "Activity",
    icon: "transactions",
    items: [
      { id: "entries", label: "Entries", to: "/activity", path: "/activity" },
      { id: "trends", label: "Trends", to: "/trends", path: "/trends" },
    ],
  },
  {
    hub: "money",
    label: "Money",
    icon: "accounts",
    items: [money("accounts", "Accounts", "accounts"), money("commitments", "Commitments", "commitments"), money("investments", "Investments", "investments")],
  },
  {
    hub: "plan",
    label: "Plan",
    icon: "budgets",
    items: [
      plan("overview", "Overview", "overview"),
      plan("budgets", "Budgets", "budgets"),
      plan("recurring", "Recurring", "recurring"),
      plan("goals", "Goals", "goals"),
      plan("foundations", "Foundations", "foundations"),
      plan("protection", "Protection", "protection"),
    ],
  },
  {
    hub: "you",
    label: "You",
    icon: "grid",
    items: [
      { id: "features", label: "All features", to: "/you", path: "/you" },
      { id: "settings", label: "Settings", to: "/settings", path: "/settings" },
      { id: "categories", label: "Categories", to: "/categories", path: "/categories" },
    ],
  },
];

/** Whether an item is the screen showing: the same page and, when the page has views, the same view. */
export function isActiveItem(item: NavItem, path: string, search: string): boolean {
  if (item.path !== path) return false;
  if (!item.view) return true;
  return (item.view.of === "plan" ? planView(search) : moneyView(search)) === item.view.is;
}

/** The name of the screen showing (its sidebar label), or `fallback` when the address is not in the tree. */
export function screenTitle(path: string, search: string, fallback: string): string {
  return NAV.flatMap((s) => s.items).find((i) => isActiveItem(i, path, search))?.label ?? fallback;
}

/** The section a page belongs to. */
export const sectionOf = (path: string): NavSection => NAV.find((s) => s.hub === hubOf(path)) ?? (NAV[0] as NavSection);
