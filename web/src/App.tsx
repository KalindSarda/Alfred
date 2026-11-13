import { useEffect, useState } from "react";
import { InviteSwitch } from "./components/InviteSwitch";
import { JumpSearch } from "./components/JumpSearch";
import { QuickAddSheet } from "./components/QuickAddSheet";
import { Icon, Spinner } from "./components/ui";
import { Accounts } from "./pages/Accounts";
import { Categories } from "./pages/Categories";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Setup } from "./pages/Setup";
import { You } from "./pages/You";
import { Settings } from "./pages/Settings";
import { Plan } from "./pages/Plan";
import { Transactions } from "./pages/Transactions";
import { inviteEmailFromHash } from "./invite";
import { clearInviteHash } from "./inviteUrl";
import { useMe, useReviewCounts } from "./queries";
import { Link, replacePath, usePath, useScrollToHash, useSearch } from "./router";
import { HUB_PATHS, type Hub, hubOf, redirectFor } from "./routes";

/** The five places, in order. The rail shows all five; the phone's bottom bar shows the first four and keeps You in the header. */
const HUBS: { hub: Hub; label: string; icon: "cashflow" | "transactions" | "accounts" | "budgets" | "grid" }[] = [
  { hub: "today", label: "Today", icon: "cashflow" },
  { hub: "activity", label: "Activity", icon: "transactions" },
  { hub: "money", label: "Money", icon: "accounts" },
  { hub: "plan", label: "Plan", icon: "budgets" },
  { hub: "you", label: "You", icon: "grid" },
];

function Page({ path }: { path: string }) {
  switch (path) {
    case "/activity":
      return <Transactions />;
    case "/plan":
      return <Plan />;
    case "/money":
      return <Accounts />;
    case "/you":
      return <You onSearch={() => window.dispatchEvent(new Event("alfred:find"))} />;
    case "/settings":
      return <Settings />;
    case "/categories":
      return <Categories />;
    default:
      return <Home />;
  }
}

export function App() {
  const me = useMe();
  const path = usePath();
  const search = useSearch();
  useScrollToHash(path, search);
  const [adding, setAdding] = useState(false);
  const [finding, setFinding] = useState(false);
  // Ctrl or Cmd + K, or a bare "/" outside a text box, opens the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setFinding(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const current = hubOf(path);
  // Old addresses (Transactions, Accounts, Freedom, Protection, Everything, Budgets) move over quietly.
  useEffect(() => {
    const to = redirectFor(path, window.location.search, window.location.hash);
    if (to) replacePath(to);
  }, [path]);
  // The You page's search box opens the same search.
  useEffect(() => {
    const open = () => setFinding(true);
    window.addEventListener("alfred:find", open);
    return () => window.removeEventListener("alfred:find", open);
  }, []);
  const review = useReviewCounts(Boolean(me.data));
  // An invitation link carries the invited address in its fragment; it matters only when someone else is signed in.
  const [invite, setInvite] = useState(() => inviteEmailFromHash(window.location.hash));
  const signedInAs = me.data?.email.toLowerCase();
  useEffect(() => {
    if (me.isSuccess && !me.data) setInvite(null);
    if (invite && signedInAs === invite) {
      clearInviteHash();
      setInvite(null);
    }
  }, [me.isSuccess, me.data, signedInAs, invite]);
  const reviewTotal = (review.data?.uncategorizedCount ?? 0) + (review.data?.draftCount ?? 0);

  if (me.isPending) return <Spinner label="Starting" />;
  if (me.isError) {
    return (
      <p role="alert" className="p-6 text-center text-soft">
        Could not reach the server. Check your connection and reload.
      </p>
    );
  }
  if (!me.data) return <Login />;
  if (invite && signedInAs !== invite) {
    return (
      <InviteSwitch
        current={me.data.email}
        invited={invite}
        onStay={() => {
          clearInviteHash();
          setInvite(null);
        }}
      />
    );
  }
  // New people are guided through setup first; "Run setup again" under Settings opens it on request.
  if (me.data.needsSetup || path === "/setup") return <Setup />;

  const badge = (hub: Hub) => (hub === "activity" && reviewTotal > 0 ? reviewTotal : 0);

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-16 shrink-0 flex-col gap-1 border-r border-line p-2 md:flex min-[1100px]:w-64 min-[1100px]:p-4">
        <p className="mb-4 px-3 font-display text-3xl tracking-tight max-[1099px]:text-center max-[1099px]:px-0 max-[1099px]:text-2xl">
          <span className="min-[1100px]:hidden">A</span>
          <span className="hidden min-[1100px]:inline">Alfred</span>
        </p>
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="New transaction"
          title="New"
          className="mb-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand font-medium text-white hover:bg-brand-strong"
        >
          <Icon name="plus" className="size-5" /> <span className="hidden min-[1100px]:inline">New</span>
        </button>
        <button
          type="button"
          onClick={() => setFinding(true)}
          aria-label="Find anything"
          title="Find anything"
          className="mb-1 flex min-h-11 items-center justify-center gap-3 rounded-xl border border-line px-3 text-sm text-soft hover:bg-hover min-[1100px]:justify-start"
        >
          <Icon name="search" className="size-5" />
          <span className="hidden min-[1100px]:inline">Find anything</span>
          <kbd className="ml-auto hidden rounded bg-sunk px-1.5 py-0.5 text-xs min-[1100px]:inline">/</kbd>
        </button>
        {HUBS.map((item) => (
          <Link
            key={item.hub}
            to={HUB_PATHS[item.hub]}
            aria-current={current === item.hub ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
            className={`relative flex min-h-11 items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium min-[1100px]:justify-start ${
              current === item.hub ? "bg-sunk text-brand" : "text-soft hover:bg-hover"
            }`}
          >
            <Icon name={item.icon} className="size-5" />
            <span className="hidden min-[1100px]:inline">{item.label}</span>
            {badge(item.hub) > 0 && (
              <span
                className="absolute top-1 right-1 min-w-4 rounded-full bg-warn-bg px-1 text-center text-[10px] leading-4 font-semibold text-warn-ink min-[1100px]:static min-[1100px]:ml-auto min-[1100px]:px-2 min-[1100px]:text-xs"
                aria-label={`${badge(item.hub)} entries need attention`}
              >
                {badge(item.hub)}
              </span>
            )}
          </Link>
        ))}
      </aside>

      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 pb-28 md:p-8 md:pb-8">
        <header className="sticky top-0 z-30 -mx-4 mb-2 flex items-center justify-between bg-paper px-4 pt-[env(safe-area-inset-top)] md:hidden">
          <p className="font-display text-2xl tracking-tight">Alfred</p>
          <div className="flex items-center">
            <button type="button" onClick={() => setFinding(true)} aria-label="Find anything" className="flex size-11 items-center justify-center rounded-xl text-soft hover:bg-hover">
              <Icon name="search" className="size-5" />
            </button>
            <Link
              to={HUB_PATHS.you}
              aria-label="You"
              aria-current={current === "you" ? "page" : undefined}
              className={`flex size-11 items-center justify-center rounded-xl hover:bg-hover ${current === "you" ? "text-brand" : "text-soft"}`}
            >
              <Icon name="grid" className="size-5" />
            </Link>
          </div>
        </header>
        <div className={current === "today" || current === "activity" || current === "money" ? "" : "max-w-3xl"}>
          <Page path={path} />
        </div>
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {HUBS.slice(0, 2).map((item) => (
          <TabLink key={item.hub} item={item} active={current === item.hub} badge={badge(item.hub)} />
        ))}
        <button type="button" onClick={() => setAdding(true)} aria-label="New transaction" className="flex min-h-14 items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-brand text-white shadow-md">
            <Icon name="plus" className="size-7" />
          </span>
        </button>
        {HUBS.slice(2, 4).map((item) => (
          <TabLink key={item.hub} item={item} active={current === item.hub} badge={badge(item.hub)} />
        ))}
      </nav>

      {adding && <QuickAddSheet onClose={() => setAdding(false)} />}
      {finding && <JumpSearch onClose={() => setFinding(false)} />}
    </div>
  );
}

function TabLink({ item, active, badge }: { item: (typeof HUBS)[number]; active: boolean; badge: number }) {
  return (
    <Link
      to={HUB_PATHS[item.hub]}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-brand" : "text-soft"}`}
    >
      <span className="relative">
        <Icon name={item.icon} className="size-6" />
        {badge > 0 && (
          <span className="absolute -top-1 -right-3 min-w-4 rounded-full bg-brass px-1 text-center text-[10px] leading-4 font-semibold text-navy" aria-label={`${badge} entries need attention`}>
            {badge}
          </span>
        )}
      </span>
      {item.label}
    </Link>
  );
}
