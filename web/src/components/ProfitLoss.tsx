import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Cashflow, type CashflowRow, api } from "../api";
import { emptyFilters, toApiParams, transactionsLink, type TxnFilters } from "../filters";
import { longDate, rupees } from "../format";
import type { TransactionPage } from "../queries";
import { Link } from "../router";

export function rowFilters(data: Cashflow, row: CashflowRow, type: "income" | "expense"): TxnFilters {
  const base = { ...emptyFilters, type, from: data.period.from, to: data.period.to };
  if (data.groupBy === "category") return { ...base, categories: [row.categoryId ?? "none"] };
  // Merchant rows are matched by name through search; entries with no merchant cannot be filtered this way.
  return row.key === "" ? base : { ...base, q: row.name };
}

function Details({ filters }: { filters: TxnFilters }) {
  const detail = useQuery({
    queryKey: ["pnl-detail", filters],
    queryFn: () => {
      const params = toApiParams(filters);
      params.set("limit", "6");
      return api.get<TransactionPage>(`/api/transactions?${params}`);
    },
  });
  if (detail.isPending) return <p className="px-4 py-2 text-sm text-soft">Loading…</p>;
  if (detail.isError) return <p className="px-4 py-2 text-sm text-bad">Could not load these entries.</p>;
  const { items, totals } = detail.data;
  return (
    <div className="bg-hover px-4 py-2">
      <ul className="divide-y divide-line">
        {items.map((t) => (
          <li key={t.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0 truncate">
              <span className="text-soft">{longDate(t.txnDate)}</span> · {t.merchant || t.note || "Entry"}
            </span>
            <span className="shrink-0 tabular-nums">{rupees(t.amountPaise)}</span>
          </li>
        ))}
      </ul>
      {totals.count > items.length && (
        <Link to={transactionsLink(filters)} className="mt-1 inline-block min-h-9 py-1.5 text-sm text-brand hover:underline">
          See all {totals.count}
        </Link>
      )}
    </div>
  );
}

function Row({ data, row, type, share }: { data: Cashflow; row: CashflowRow; type: "income" | "expense"; share: string }) {
  const [open, setOpen] = useState(false);
  const filters = rowFilters(data, row, type);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid min-h-11 w-full grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2 text-left hover:bg-hover"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`text-soft transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">
            ›
          </span>
          <span className="truncate">{row.name}</span>
        </span>
        <span className="w-14 text-right text-sm text-soft tabular-nums">{share}</span>
        <span className="w-28 text-right tabular-nums">
          {type === "expense" ? "−" : ""}
          {rupees(row.amountPaise)}
        </span>
      </button>
      {open && <Details filters={filters} />}
    </>
  );
}

function Section({ title, total, rows, data, type }: { title: string; total: number; rows: CashflowRow[]; data: Cashflow; type: "income" | "expense" }) {
  const pctOfIncome = data.incomePaise > 0 ? Math.round((total / data.incomePaise) * 1000) / 10 : 0;
  return (
    <>
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-y border-line bg-hover px-4 py-2 font-medium">
        <span>{title}</span>
        <span className="w-14 text-right text-sm text-soft tabular-nums">{data.incomePaise > 0 ? `${pctOfIncome}%` : ""}</span>
        <span className="w-28 text-right tabular-nums">
          {type === "expense" ? "−" : ""}
          {rupees(total)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-soft">Nothing recorded in this period.</p>
      ) : (
        <div className="divide-y divide-line">
          {rows.map((r) => (
            <Row key={r.key} data={data} row={r} type={type} share={data.incomePaise > 0 ? `${r.pctOfIncome}%` : ""} />
          ))}
        </div>
      )}
    </>
  );
}

/** The table view: category, share of income, amount. Rows expand to the entries behind them. */
export function ProfitLoss({ data }: { data: Cashflow }) {
  const saved = data.surplusPaise;
  return (
    <div className="-mx-4 text-[15px]">
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 pb-2 text-xs tracking-wide text-soft uppercase">
        <span>Category</span>
        <span className="w-14 text-right">% of income</span>
        <span className="w-28 text-right">Amount</span>
      </div>
      <Section title="Income" total={data.incomePaise} rows={data.income} data={data} type="income" />
      <Section title="Expenses" total={data.expensePaise} rows={data.expenses} data={data} type="expense" />
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-t border-brass/60 px-4 py-3 font-medium">
        <span>{saved >= 0 ? "Saved" : "Spent beyond income"}</span>
        <span className="w-14 text-right text-sm text-soft tabular-nums">
          {data.incomePaise > 0 ? `${Math.round((Math.abs(saved) / data.incomePaise) * 1000) / 10}%` : ""}
        </span>
        <span className={`w-28 text-right tabular-nums ${saved >= 0 ? "text-good" : "text-bad"}`}>{rupees(saved)}</span>
      </div>
    </div>
  );
}
