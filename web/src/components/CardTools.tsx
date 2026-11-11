import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type CardAccount, type RankedCard, type StatementAnalysis, type StatementSettled, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { rupees, shortDate } from "../format";
import { useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, Card, ErrorText, Field, Sheet, inputClass } from "./ui";

/** Which card to use today for a purchase: the longest interest-free time before the bill falls due. */
export function BestCard() {
  const [amount, setAmount] = useState("");
  const paise = rupeesToPaise(amount);
  const ranked = useQuery({
    queryKey: ["card-float", paise ?? 1],
    queryFn: async () => (await api.get<{ items: RankedCard[] }>(`/api/cards/float?amountPaise=${paise ?? 1}`)).items,
  });
  const cards = ranked.data ?? [];
  const best = cards.find((c) => c.fits);

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-medium">Which card today?</h2>
        <p className="text-sm text-soft">The card that gives the longest time before its bill is due.</p>
      </div>
      <Field label="Purchase (₹)" hint="Optional. With an amount, cards that cannot take it go last.">
        <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="20000" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <ul className="divide-y divide-line">
        {cards.map((c) => (
          <li key={c.id} className="flex min-h-14 items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block text-xs text-soft">
                Statement {shortDate(c.statementDate)} · bill due {shortDate(c.dueDate)}
                {!c.fits && ` · only ${rupees(Math.max(0, c.availableCreditPaise))} of credit left`}
              </span>
            </span>
            <span className={`shrink-0 text-lg font-semibold tabular-nums ${c.fits ? "" : "text-soft"}`}>{c.days} days</span>
          </li>
        ))}
      </ul>
      {best?.waitDate && best.waitDays !== null && (
        <p className="rounded-lg bg-sunk px-3 py-2 text-sm">
          If it can wait until {shortDate(best.waitDate)}, the day after its statement, {best.name} would give {best.waitDays} days instead of {best.days}.
        </p>
      )}
    </Card>
  );
}

/** Compares a card statement's total with what Alfred expected, says what the gap might be, and can book it. */
export function StatementCheckSheet({ cards, onClose }: { cards: CardAccount[]; onClose: () => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [typed, setTyped] = useState("");
  const [analysis, setAnalysis] = useState<StatementAnalysis | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const facts = useQuery({ queryKey: ["statement-facts", cardId], queryFn: () => api.get<StatementAnalysis["facts"]>(`/api/cards/statement?cardId=${cardId}`), enabled: cardId !== "" });

  const compare = async () => {
    const paise = rupeesToPaise(typed);
    if (paise === null) return setError("Enter the total amount due on the statement, such as 20988.76.");
    setBusy(true);
    setError("");
    try {
      setAnalysis(await api.post<StatementAnalysis>("/api/cards/statement", { cardId, billedPaise: paise }));
    } catch (e) {
      setError(describeError(e));
    }
    setBusy(false);
  };

  const book = async () => {
    if (!analysis) return;
    setBusy(true);
    setError("");
    try {
      const done = await api.post<StatementSettled>("/api/cards/statement/settle", { cardId, billedPaise: analysis.billedPaise });
      await refresh();
      toast.show(done.kind === null ? "Already matches." : `Booked ${rupees(done.bookedPaise)} on ${done.cardName}.`);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const diff = analysis?.differencePaise ?? 0;
  const label = analysis?.bookAs === "fee" ? `Add ${rupees(Math.abs(diff))} as Fees & Charges` : analysis?.bookAs === "spending" ? `Add ${rupees(Math.abs(diff))} as unlogged spending` : `Add ${rupees(Math.abs(diff))} as a credit`;

  return (
    <Sheet title="Check a statement" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void compare();
        }}
      >
        <Field label="Card">
          <select
            className={inputClass}
            value={cardId}
            onChange={(e) => {
              setCardId(e.target.value);
              setAnalysis(null);
            }}
          >
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {facts.data && (
          <p className="text-sm text-soft">
            Its last statement was on {shortDate(facts.data.statementDate)}, with the bill due {shortDate(facts.data.dueDate)}. Alfred makes the total {rupees(facts.data.expectedPaise)}.
          </p>
        )}
        <Field label="Total amount due on the statement (₹)">
          <input
            className={inputClass}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="20988.76"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setAnalysis(null);
            }}
          />
        </Field>
        {!analysis && (
          <Button type="submit" className="w-full" disabled={busy}>
            Compare
          </Button>
        )}
      </form>

      {analysis && (
        <div className="mt-4 space-y-3">
          <p className="rounded-lg bg-sunk px-3 py-2 text-sm">{analysis.reason}</p>
          {analysis.bookAs !== null && (
            <Button className="w-full" disabled={busy} onClick={() => void book()}>
              {label}
            </Button>
          )}
          <Button variant="secondary" className="w-full" onClick={onClose}>
            {analysis.bookAs === null ? "Close" : "Leave it"}
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Sheet>
  );
}
