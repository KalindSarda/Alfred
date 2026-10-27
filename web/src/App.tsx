import { useState } from "react";
import { QuickAddSheet } from "./components/QuickAddSheet";
import { Icon, Spinner } from "./components/ui";
import { Accounts } from "./pages/Accounts";
import { Budgets } from "./pages/Budgets";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { More } from "./pages/More";
import { Transactions } from "./pages/Transactions";
import { useMe } from "./queries";
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
    default:
      return <Home />;
  }
}

export function App() {
  const me = useMe();
  const path = usePath();
  const [adding, setAdding] = useState(false);

  if (me.isPending) return <Spinner label="Starting" />;
  if (me.isError) {
    return (
      <p role="alert" className="p-6 text-center text-slate-600">
        Could not reach the server. Check your connection and reload.
      </p>
    );
  }
  if (!me.data) return <Login />;

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-64 shrink-0 flex-col gap-1 border-r border-slate-200 p-4 md:flex dark:border-slate-800">
        <p className="mb-4 px-3 text-lg font-semibold">Finance Tracker</p>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mb-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 font-medium text-white hover:bg-emerald-700"
        >
          <Icon name="plus" className="size-5" /> New
        </button>
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={path === item.to ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${
              path === item.to
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Icon name={item.icon} className="size-5" />
            {item.label}
          </Link>
        ))}
      </aside>

      <main className="mx-auto w-full max-w-3xl flex-1 p-4 pb-28 md:p-8 md:pb-8">
        <Page path={path} />
      </main>

      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label="New transaction"
        className="fixed right-4 bottom-20 z-40 flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 md:hidden"
      >
        <Icon name="plus" className="size-7" />
      </button>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-slate-800 dark:bg-slate-950"
      >
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={path === item.to ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              path === item.to ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"
            }`}
          >
            <Icon name={item.icon} className="size-6" />
            {"short" in item ? item.short : item.label}
          </Link>
        ))}
      </nav>

      {adding && <QuickAddSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
