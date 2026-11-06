import { daysBetween, inDays } from "../../../src/alfred/voice";
import { rupees, shortDate, today } from "../format";
import { useCommitments } from "../queries";
import { Card } from "./ui";

const SOURCE: Record<string, string> = { card: "Card bill", emi: "Card EMI", loan: "Loan EMI", recurring: "Repeats", debt: "Borrowed" };

/**
 * Free to spend until the next salary, shown beside safe-to-spend: safe-to-spend less what is still to leave. A card bill
 * is listed but is already held back by safe-to-spend, so it is not taken off twice.
 */
export function CommitmentsCard() {
  const query = useCommitments();
  if (!query.data) return null;
  const v = query.data;
  const negative = v.freeToSpendPaise < 0;
  const coming = v.items.filter((i) => !i.counted);

  return (
    <Card>
      <p className="text-xs tracking-wide text-soft uppercase">Free to spend until {shortDate(v.until)}{v.basis === "salary" ? " (next salary)" : ""}</p>
      <p className={`font-display mt-1 text-3xl tabular-nums ${negative ? "text-bad" : ""}`}>{rupees(v.freeToSpendPaise)}</p>
      <p className="mt-1 text-sm text-soft">
        Safe to spend {rupees(v.safeToSpendPaise)}
        {v.commitmentsPaise > 0 && <> less {rupees(v.commitmentsPaise)} still to leave</>}
      </p>

      {v.shortfalls.map((s) => (
        <p key={`${s.commitment.key}${s.commitment.date}`} className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
          {s.commitment.title} ({rupees(s.commitment.amountPaise)}) is due {inDays(daysBetween(today(), s.commitment.date))} from {s.commitment.accountName}, which will hold {rupees(Math.max(0, s.balancePaise))}. It is {rupees(s.shortByPaise)} short.
        </p>
      ))}

      {v.items.length > 0 && (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-soft">
            What is coming ({coming.length}
            {v.items.length > coming.length ? `, plus ${v.items.length - coming.length} card ${v.items.length - coming.length === 1 ? "bill" : "bills"}` : ""})
          </summary>
          <ul className="divide-y divide-line">
            {v.items.map((i) => (
              <li key={`${i.key}${i.date}`} className="flex min-h-12 items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{i.title}</span>
                  <span className="block truncate text-xs text-soft">
                    {shortDate(i.date)} · {SOURCE[i.source]}
                    {i.accountName ? ` · ${i.accountName}` : ""}
                    {i.counted ? " · already held back" : ""}
                  </span>
                </span>
                <span className={`shrink-0 tabular-nums ${i.counted ? "text-soft" : "font-semibold"}`}>{rupees(i.amountPaise)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
