import { useState } from "react";
import { type HoldingKind, api, describeError } from "../api";
import { useHoldingKinds, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, Card, Empty, ErrorText, Field, Sheet, Spinner, inputClass } from "./ui";

const RATE_PERS = [1, 10, 100, 1000] as const;
const oneOf = (unit: string) => (unit.length > 2 && /s$/i.test(unit) ? unit.slice(0, -1) : unit);
const amountOf = (n: number, unit: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? oneOf(unit) : unit}`;
const holdingsText = (n: number) => `${n} ${n === 1 ? "investment" : "investments"}`;

/** "Quantity" kinds are counted as quantity times a rate; the others are valued by typing. */
function UnitFields({ counted, setCounted, unit, setUnit, ratePer, setRatePer, disabled }: { counted: boolean; setCounted: (v: boolean) => void; unit: string; setUnit: (v: string) => void; ratePer: number; setRatePer: (v: number) => void; disabled?: boolean }) {
  return (
    <>
      <Field label="Counted by">
        <select className={inputClass} disabled={disabled} value={counted ? "quantity" : "value"} onChange={(e) => setCounted(e.target.value === "quantity")}>
          <option value="quantity">Quantity held times a rate (grams, units, shares)</option>
          <option value="value">What it is worth, typed by me</option>
        </select>
      </Field>
      {counted && (
        <>
          <Field label="Unit" hint="What you count it in: g, kg, units, shares, coins.">
            <input className={inputClass} list="kind-units" maxLength={12} autoComplete="off" placeholder="g" disabled={disabled} value={unit} onChange={(e) => setUnit(e.target.value)} />
            <datalist id="kind-units">
              {["g", "kg", "units", "shares", "coins"].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
          <Field label="The rate you type is for" hint="Gold is usually quoted for 10 g, silver for 1 kg (1,000 g) or 1 g.">
            <select className={inputClass} disabled={disabled} value={ratePer} onChange={(e) => setRatePer(Number(e.target.value))}>
              {RATE_PERS.map((n) => (
                <option key={n} value={n}>
                  {amountOf(n, unit.trim() || "units")}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
    </>
  );
}

/** Adds a kind of investment; calls back with it so a form can select it at once. */
export function NewKindSheet({ onCreated, onClose }: { onCreated?: (kind: HoldingKind) => void; onClose: () => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [name, setName] = useState("");
  const [counted, setCounted] = useState(true);
  const [unit, setUnit] = useState("g");
  const [ratePer, setRatePer] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError("Name it, such as Silver.");
    if (counted && !unit.trim()) return setError("Give the unit, such as g.");
    setBusy(true);
    setError("");
    try {
      const kind = await api.post<HoldingKind>("/api/holding-kinds", { name: name.trim(), ...(counted ? { unit: unit.trim(), ratePer } : {}) });
      await refresh();
      toast.show(`${kind.name} added.`);
      onCreated?.(kind);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title="Add a kind of investment" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          <input className={inputClass} maxLength={40} autoComplete="off" autoFocus placeholder="Silver" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <UnitFields counted={counted} setCounted={setCounted} unit={unit} setUnit={setUnit} ratePer={ratePer} setRatePer={setRatePer} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Add
        </Button>
      </form>
    </Sheet>
  );
}

function EditKindSheet({ kind, others, onClose }: { kind: HoldingKind; others: HoldingKind[]; onClose: () => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [name, setName] = useState(kind.name);
  const [counted, setCounted] = useState(kind.unit !== null);
  const [unit, setUnit] = useState(kind.unit ?? "g");
  const [ratePer, setRatePer] = useState<number>(kind.ratePer);
  const [target, setTarget] = useState("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/holding-kinds/${kind.id}`;
  const into = others.find((o) => o.id === target);
  const mergeable = others.filter((o) => (o.unit ?? null) === (kind.unit ?? null) && o.ratePer === kind.ratePer);
  const changed = name.trim() !== kind.name || (!kind.locked && (counted ? unit.trim() !== (kind.unit ?? "") || ratePer !== kind.ratePer : kind.unit !== null));

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
      toast.show(done);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title={kind.name} onClose={onClose}>
      <div className="space-y-5">
        <p className="text-sm text-soft">
          {holdingsText(kind.holdingCount)}
          {kind.isSystem && ". Built in, so it can be renamed but not archived, merged or deleted"}
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError("The name cannot be empty.");
            if (counted && !unit.trim()) return setError("Give the unit, such as g.");
            const body = kind.locked ? { name: name.trim() } : { name: name.trim(), unit: counted ? unit.trim() : null, ...(counted ? { ratePer } : {}) };
            void run(() => api.patch(url, body), "Saved.");
          }}
        >
          <Field label="Name">
            <input className={inputClass} maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <UnitFields counted={counted} setCounted={setCounted} unit={unit} setUnit={setUnit} ratePer={ratePer} setRatePer={setRatePer} disabled={kind.locked} />
          {kind.locked && <p className="text-xs text-soft">Its unit and rate are fixed because something is counted by quantity in it. Changing them would change every value. Add a new kind instead.</p>}
          <Button type="submit" variant="secondary" disabled={busy || !changed}>
            Save
          </Button>
        </form>

        {!kind.isSystem && !kind.archived && mergeable.length > 0 && (
          <div className="space-y-3 border-t border-line pt-4">
            <h3 className="font-medium">Merge into another kind</h3>
            {!merging ? (
              <Button type="button" variant="secondary" onClick={() => setMerging(true)}>
                Merge…
              </Button>
            ) : (
              <>
                <Field label="Merge into" hint="Only kinds counted the same way (same unit and rate) are offered.">
                  <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Choose…</option>
                    {mergeable.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {into && (
                  <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
                    {holdingsText(kind.holdingCount)} will move to {into.name}, and {kind.name} will be removed. This cannot be undone.
                  </p>
                )}
                <Button type="button" disabled={!into || busy} onClick={() => void run(() => api.post(`${url}/merge`, { intoId: target }), `Merged into ${into?.name ?? "the other kind"}.`)}>
                  Merge and remove {kind.name}
                </Button>
              </>
            )}
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          {!kind.isSystem && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => api.patch(url, { archived: !kind.archived }), kind.archived ? "Restored." : "Archived.")}>
              {kind.archived ? "Restore" : "Archive"}
            </Button>
          )}
          {!kind.isSystem && kind.holdingCount === 0 && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete ${kind.name}?`)) void run(() => api.del(url), "Kind deleted.");
              }}
            >
              Delete
            </Button>
          )}
        </div>
        {!kind.isSystem && kind.holdingCount > 0 && <p className="text-xs text-soft">A kind with investments cannot be deleted. Merge it into another, or archive it to hide it.</p>}
      </div>
    </Sheet>
  );
}

const describe = (k: HoldingKind) => (k.unit ? `Counted in ${k.unit}, rate for ${amountOf(k.ratePer, k.unit)}` : "Valued by typing what it is worth");

/** The person's kinds of investment: add, rename, archive, merge, delete. */
export function InvestmentKinds() {
  const kinds = useHoldingKinds();
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (kinds.isPending) return <Spinner />;
  if (kinds.isError) return <ErrorText>Could not load your investment kinds. Try again.</ErrorText>;

  const shown = kinds.data.filter((k) => showArchived || !k.archived);
  const current = kinds.data.find((k) => k.id === editing);

  return (
    <div className="space-y-4" id="kinds">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-soft">The kinds you can choose when adding an investment.</p>
        <Button onClick={() => setAdding(true)}>Add</Button>
      </div>
      {shown.length === 0 ? (
        <Empty title="No kinds">Add a kind such as Silver.</Empty>
      ) : (
        <Card pad="p-0">
          <ul className="divide-y divide-line">
            {shown.map((k) => (
              <li key={k.id}>
                <button type="button" onClick={() => setEditing(k.id)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-hover">
                  <span className="min-w-0">
                    <span className="block truncate">
                      {k.name}
                      {k.isSystem && <span className="ml-2 text-xs text-faint">built in</span>}
                      {k.archived && <span className="ml-2 text-xs text-faint">archived</span>}
                    </span>
                    <span className="block truncate text-xs text-soft">{describe(k)}</span>
                  </span>
                  <span className="shrink-0 text-sm text-soft">{holdingsText(k.holdingCount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <label className="flex min-h-11 items-center gap-3 text-sm text-soft">
        <input type="checkbox" className="size-5 accent-brand" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived kinds
      </label>
      {adding && <NewKindSheet onClose={() => setAdding(false)} />}
      {current && <EditKindSheet key={current.id} kind={current} others={kinds.data.filter((o) => o.id !== current.id && !o.archived)} onClose={() => setEditing(null)} />}
    </div>
  );
}
