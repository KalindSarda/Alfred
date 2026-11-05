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
import { Everything } from "./pages/Everything";
import { Settings } from "./pages/Settings";
import { Plan } from "./pages/Plan";
import { Transactions } from "./pages/Transactions";
import { inviteEmailFromHash } from "./invite";
import { clearInviteHash } from "./inviteUrl";
import { useMe, useReviewCounts } from "./queries";
import { Link, replacePath, usePath, useScrollToHash, useSearch } from "./router";

const NAV = [
  { to: "/", label: "Home", icon: "cashflow" },
  { to: "/transactions", label: "Transactions", icon: "transactions" },
  { to: "/plan", label: "Plan", icon: "budgets" },
  { to: "/accounts", label: "Accounts and commitments", short: "Accounts", icon: "accounts" },
  { to: "/more", label: "Everything", icon: "grid" },
] as const;

function Page({ path, onSearch }: { path: string; onSearch: () => void }) {
  switch (path) {
    case "/transactions":
      return <Transactions />;
    case "/plan":
    case "/budgets":
      return <Plan />;
    case "/accounts":
      return <Accounts />;
    case "/more":
      return <Everything onSearch={onSearch} />;
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
  const isActive = (to: string) => path === to || (to === "/more" && (path === "/categories" || path === "/settings")) || (to === "/plan" && path === "/budgets");
  // The Budgets tab is now the Plan tab; an old link or bookmark moves over quietly.
  useEffect(() => {
    if (path === "/budgets") replacePath(`/plan${window.location.search}`);
  }, [path]);
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

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-64 shrink-0 flex-col gap-1 border-r border-line p-4 md:flex">
        <p className="mb-5 px-3 font-display text-3xl tracking-tight">Alfred</p>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mb-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand font-medium text-white hover:bg-brand-strong"
        >
          <Icon name="plus" className="size-5" /> New
        </button>
        <button
          type="button"
          onClick={() => setFinding(true)}
          className="mb-1 flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm text-soft hover:bg-hover"
        >
          <Icon name="search" className="size-5" />
          Find anything
          <kbd className="ml-auto rounded bg-sunk px-1.5 py-0.5 text-xs">/</kbd>
        </button>
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive(item.to) ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${
              isActive(item.to)
                ? "bg-sunk text-brand"
                : "text-soft hover:bg-hover"
            }`}
          >
            <Icon name={item.icon} className="size-5" />
            {item.label}
            {item.to === "/transactions" && reviewTotal > 0 && (
              <span className="ml-auto rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn-ink" aria-label={`${reviewTotal} entries need attention`}>
                {reviewTotal}
              </span>
            )}
          </Link>
        ))}
      </aside>

      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 p-4 pb-28 md:p-8 md:pb-8">
        <div className="mb-1 flex justify-end md:hidden">
          <button type="button" onClick={() => setFinding(true)} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-soft hover:bg-hover">
            <Icon name="search" className="size-5" />
            Find
          </button>
        </div>
        <div className={path === "/" ? "" : "max-w-3xl"}>
          <Page path={path} onSearch={() => setFinding(true)} />
        </div>
      </main>

      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label="New transaction"
        className="fixed right-4 bottom-20 z-40 flex size-14 items-center justify-center rounded-full bg-brand text-white shadow-lg hover:bg-brand-strong md:hidden"
      >
        <Icon name="plus" className="size-7" />
      </button>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive(item.to) ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              isActive(item.to) ? "text-brand" : "text-soft"
            }`}
          >
            <span className="relative">
              <Icon name={item.icon} className="size-6" />
              {item.to === "/transactions" && reviewTotal > 0 && (
                <span
                  className="absolute -top-1 -right-3 min-w-4 rounded-full bg-brass px-1 text-center text-[10px] leading-4 font-semibold text-navy"
                  aria-label={`${reviewTotal} entries need attention`}
                >
                  {reviewTotal}
                </span>
              )}
            </span>
            {"short" in item ? item.short : item.label}
          </Link>
        ))}
      </nav>

      {adding && <QuickAddSheet onClose={() => setAdding(false)} />}
      {finding && <JumpSearch onClose={() => setFinding(false)} />}
    </div>
  );
}
