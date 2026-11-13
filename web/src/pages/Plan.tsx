import { Goals } from "../components/Goals";
import { PlanOverview } from "../components/PlanOverview";
import { Recurring } from "../components/Recurring";
import { type PlanView, searchForView, viewFromSearch } from "../planView";
import { replaceSearch, useSearch } from "../router";
import { BudgetsView } from "./Budgets";
import { Freedom } from "./Freedom";
import { Protection } from "./Protection";

const VIEWS: { value: PlanView; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "budgets", label: "Budgets" },
  { value: "recurring", label: "Recurring" },
  { value: "goals", label: "Goals" },
  { value: "foundations", label: "Foundations" },
  { value: "protection", label: "Protection" },
];

/** Where you stand and what you set up ahead of time: an overview first, then budgets, what repeats, goals, the foundations and cover. */
export function Plan() {
  const view = viewFromSearch(useSearch());
  return (
    <div className="space-y-4">
      <h1 className="text-3xl">Plan</h1>
      <div role="tablist" aria-label="View" className="flex gap-1 overflow-x-auto rounded-xl bg-sunk p-1">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => replaceSearch(searchForView(v.value))}
            className={`min-h-11 shrink-0 grow rounded-lg px-4 text-sm font-medium whitespace-nowrap ${view === v.value ? "bg-card shadow-sm" : "text-soft"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "overview" ? (
        <PlanOverview />
      ) : view === "recurring" ? (
        <Recurring />
      ) : view === "goals" ? (
        <Goals />
      ) : view === "foundations" ? (
        <Freedom embedded />
      ) : view === "protection" ? (
        <Protection embedded />
      ) : (
        <BudgetsView />
      )}
    </div>
  );
}
