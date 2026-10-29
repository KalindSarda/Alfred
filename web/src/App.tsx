import { useState } from "react";
import { QuickAddSheet } from "./components/QuickAddSheet";
import { Icon, Spinner } from "./components/ui";
import { Accounts } from "./pages/Accounts";
import { Budgets } from "./pages/Budgets";
import { Categories } from "./pages/Categories";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Setup } from "./pages/Setup";
import { More } from "./pages/More";
import { Transactions } from "./pages/Transactions";
import { useMe, useReviewCounts } from "./queries";
import { Link, usePath } from "./router";

const NAV = [
  { to: "/", label: "Cash flow", icon: "cashflow" },
  { to: "/transactions", label: "Transactions", icon: "transactions" },
  { to: "/budgets", label: "Budgets", icon: "budgets" },
  { to: "/accounts", label: "Accounts and cards", short: "Accounts", icon: "accounts" },
  { to: "/more", label: "More", icon: "more" },
] as const;

function Page({ path }: { path: string }) {
  switch (path) {
    case "/transactions":
      return <Transactions />;
    case "/budgets":
      return <Budgets />;
    case "/accounts":
      return <Accounts />;
    case "/more":
      return <More />;
    case "/categories":
      return <Categories />;
    default:
      return <Home />;
  }
}

export function App() {
  const me = useMe();
  const path = usePath();
  const [adding, setAdding] = useState(false);
  const isActive = (to: string) => path === to || (to === "/more" && path === "/categories");
  const review = useReviewCounts(Boolean(me.data));
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
  // New people are guided through setup first; "Run setup again" under More opens it on request.
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
        <div className={path === "/" ? "" : "max-w-3xl"}>
          <Page path={path} />
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
    </div>
  );
}
