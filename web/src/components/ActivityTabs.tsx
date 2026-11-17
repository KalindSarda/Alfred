import { Link } from "../router";

/** Entries or Trends: the two halves of Activity, kept as links so each has its own address. */
export function ActivityTabs({ current }: { current: "entries" | "trends" }) {
  const tab = (to: string, label: string, on: boolean) => (
    <Link to={to} aria-current={on ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-lg text-sm font-medium ${on ? "bg-card shadow-sm" : "text-soft"}`}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Activity" className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
      {tab("/activity", "Entries", current === "entries")}
      {tab("/trends", "Trends", current === "trends")}
    </nav>
  );
}
