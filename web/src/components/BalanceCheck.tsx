import { useState } from "react";
import { type BalancePreview, type BalanceSettled, type BankAccount, api, describeError } from "../api";
import { rupeesToPaise } from "../filters";
import { rupees } from "../format";
import { useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, ErrorText, Field, Sheet, inputClass } from "./ui";

/**
 * Makes Alfred agree with the bank: type what the bank app shows, see how far apart they are, and book the gap as one
 * entry (spending when the bank holds less, income when it holds more).
 */
export function BalanceCheckSheet({ banks, onClose }: { banks: BankAccount[]; onClose: () => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [accountId, setAccountId] = useState(banks[0]?.id ?? "");
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState<BalancePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const compare = async () => {
    const paise = rupeesToPaise(typed);
    if (paise === null) return setError("Enter the balance your bank shows, such as 100284.52.");
    setBusy(true);
    setError("");
    try {
      setPreview(await api.post<BalancePreview>("/api/balance-check", { accountId, typedPaise: paise }));
    } catch (e) {
      setError(describeError(e));
    }
    setBusy(false);
  };

  const book = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const done = await api.post<BalanceSettled>("/api/balance-check/settle", { accountId, typedPaise: preview.typedPaise });
      await refresh();
      toast.show(done.kind === "none" ? "Already matches." : `Booked ${rupees(done.bookedPaise)} as ${done.kind === "spending" ? "unlogged spending" : "unrecorded income"}.`);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const diff = preview?.differencePaise ?? 0;
  return (
    <Sheet title="Check a balance" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void compare();
        }}
      >
        <Field label="Bank account">
          <select
            className={inputClass}
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPreview(null);
            }}
          >
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What your bank shows (₹)">
          <input
            className={inputClass}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="100284.52"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setPreview(null);
            }}
          />
        </Field>
        {!preview && (
          <Button type="submit" className="w-full" disabled={busy}>
            Compare
          </Button>
        )}
      </form>

      {preview && (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            Alfred has {rupees(preview.alfredPaise)} and your bank shows {rupees(preview.typedPaise)}.
          </p>
          {diff === 0 ? (
            <p className="rounded-lg bg-sunk px-3 py-2 text-sm">That matches. Nothing to book.</p>
          ) : (
            <>
              <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
                {diff < 0 ? `That is ${rupees(-diff)} less than Alfred knows of: spending that was not logged.` : `That is ${rupees(diff)} more than Alfred knows of: money that was not recorded.`}
              </p>
              <Button className="w-full" disabled={busy} onClick={() => void book()}>
                {diff < 0 ? `Book ${rupees(-diff)} as unlogged spending` : `Book ${rupees(diff)} as unrecorded income`}
              </Button>
            </>
          )}
          <Button variant="secondary" className="w-full" onClick={onClose}>
            {diff === 0 ? "Close" : "Leave it"}
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Sheet>
  );
}
