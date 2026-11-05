import { Goals } from "../components/Goals";
import { Recurring } from "../components/Recurring";
import { type PlanView, searchForView, viewFromSearch } from "../planView";
import { replaceSearch, useSearch } from "../router";
import { BudgetsView } from "./Budgets";

const VIEWS: { value: PlanView; label: string }[] = [
  { value: "budgets", label: "Budgets" },
  { value: "recurring", label: "Recurring" },
  { value: "goals", label: "Goals" },
];

/** What you set up ahead of time: budgets, what repeats, and savings goals. */
export function Plan() {
  const view = viewFromSearch(useSearch());
  return (
    <div className="space-y-4">
      <h1 className="text-3xl">Plan</h1>
      <div role="tablist" aria-label="View" className="grid grid-cols-3 gap-1 rounded-xl bg-sunk p-1">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => replaceSearch(searchForView(v.value))}
            className={`min-h-11 rounded-lg text-sm font-medium ${view === v.value ? "bg-card shadow-sm" : "text-soft"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "recurring" ? <Recurring /> : view === "goals" ? <Goals /> : <BudgetsView />}
    </div>
  );
}
