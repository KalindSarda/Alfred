import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type FeedPreview, type Holding, type HoldingKind, type PriceCandidate, type PriceRefresh, api, describeError } from "../api";
import { qtyToE4, rupees, shortDate } from "../format";
import { usePriceStatus, useRefreshMoney } from "../queries";
import { useToast } from "./toast";
import { Button, Card, ErrorText, Field, Sheet, inputClass } from "./ui";

const signedRupees = (paise: number) => `${paise > 0 ? "+" : paise < 0 ? "−" : ""}${rupees(Math.abs(paise))}`;

/** "24 Nov, 3:35 pm", in Indian time. */
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** One sentence for what a refresh did. */
export function describeRefresh(r: PriceRefresh): string {
  if (r.items.length === 0) return "Nothing is linked to a price yet.";
  const parts = [`${r.updated} updated`, `${r.unchanged} the same`];
  if (r.held > 0) parts.push(`${r.held} to check`);
  if (r.failed > 0) parts.push(`${r.failed} not found`);
  return parts.join(", ");
}

/** The button that fetches every linked price now, when they were last fetched, and what the last fetch did. */
export function RefreshPrices() {
  const status = usePriceStatus();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [result, setResult] = useState<PriceRefresh | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nothing = (status.data?.linked ?? 0) === 0 && (status.data?.kinds ?? 0) === 0;

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.post<PriceRefresh>("/api/prices/refresh");
      setResult(r);
      await refresh();
      toast.show(describeRefresh(r));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const problems = (result?.items ?? []).filter((i) => i.status === "held" || i.status === "failed" || i.status === "typed_today");
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-soft">
          {status.data?.checkedAt ? `Prices checked ${when(status.data.checkedAt)}.` : nothing ? "Link an investment to a live price: open it, then More, then Live price." : "No prices fetched yet."}
        </p>
        <Button variant="secondary" className="min-h-11 py-1.5 text-sm" disabled={busy} onClick={() => void run()}>
          {busy ? "Fetching…" : "Refresh prices"}
        </Button>
      </div>
      {result && result.items.length > 0 && (
        <div className="space-y-1 rounded-xl bg-sunk p-3 text-sm">
          <p className="font-medium">
            {describeRefresh(result)}
            {result.changePaise !== 0 && <span className="font-normal text-soft"> · worth {signedRupees(result.changePaise)} since the last prices</span>}
          </p>
          {problems.length > 0 && (
            <ul className="space-y-0.5 text-xs text-soft">
              {problems.map((i) => (
                <li key={i.holdingId}>
                  <span className="font-medium text-ink">{i.name}</span>: {i.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

/**
 * Links an investment to a live price. Alfred suggests matches by name; the person picks the right one. An investment valued by
 * typing (a fund, usually) also needs its units, so the price can set its worth.
 */
export function LinkPriceSheet({ holding, onClose }: { holding: Holding; onClose: () => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [kind, setKind] = useState<"stock" | "fund">(holding.kind === "fund" || holding.priceLink?.feed === "amfi" ? "fund" : "stock");
  const [query, setQuery] = useState(holding.name);
  const [found, setFound] = useState<PriceCandidate[] | null>(null);
  const [picked, setPicked] = useState<PriceCandidate | null>(null);
  const [units, setUnits] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsUnits = holding.tracking === "value";
  const unitWord = kind === "fund" ? "units" : "shares";

  const search = async () => {
    setBusy(true);
    setError("");
    setPicked(null);
    try {
      const r = await api.get<{ items: PriceCandidate[] }>(`/api/prices/suggest?kind=${kind}&q=${encodeURIComponent(query.trim())}`);
      setFound(r.items);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!picked) return setError("Pick the one that matches.");
    const held = needsUnits ? qtyToE4(units) : undefined;
    if (needsUnits && !held) return setError(`Say how many ${unitWord} you hold, such as 120.5.`);
    setBusy(true);
    setError("");
    try {
      const r = await api.put<{ ratePaise: number }>(`/api/prices/links/${holding.id}`, { feed: picked.feed, code: picked.code, label: picked.label, ...(held ? { unitsE4: held } : {}) });
      await refresh();
      toast.show(`Linked. Price now ${rupees(r.ratePaise)}.`);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await api.del(`/api/prices/links/${holding.id}`);
      await refresh();
      toast.show("Link removed. The price stays as it is until you type a new one.");
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title={`Live price: ${holding.name}`} onClose={onClose}>
      <div className="space-y-4">
        {holding.priceLink ? (
          <p className="text-sm">
            Linked to <span className="font-medium">{holding.priceLink.label ?? holding.priceLink.code}</span> ({holding.priceLink.code}). Pick another below to change it.
          </p>
        ) : (
          <p className="text-sm text-soft">Alfred fetches the price every Saturday, and when you press Refresh prices. A price you type yourself on the same day is never replaced.</p>
        )}
        <div role="group" aria-label="What it is" className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
          {(
            [
              ["stock", "Share or ETF"],
              ["fund", "Mutual fund"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={kind === key} onClick={() => (setKind(key), setFound(null), setPicked(null))} className={`min-h-11 rounded-lg text-sm font-medium ${kind === key ? "bg-card shadow-sm" : "text-soft"}`}>
              {label}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className={inputClass} aria-label="Name to search for" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "fund" ? "Parag Parikh Flexi Cap" : "Tata Power"} />
          <Button type="submit" variant="secondary" disabled={busy || query.trim().length < 2}>
            Search
          </Button>
        </form>
        {found && found.length === 0 && <p className="text-sm text-soft">Nothing matched. Try fewer or different words.</p>}
        {found && found.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line" role="radiogroup" aria-label="Matches">
            {found.map((c) => (
              <li key={c.code}>
                <label className="flex min-h-14 cursor-pointer items-start gap-3 px-3 py-2">
                  <input type="radio" name="match" className="mt-1.5 size-5 accent-brand" checked={picked?.code === c.code} onChange={() => setPicked(c)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-soft">
                      {c.code}
                      {c.paise !== null && ` · ${rupees(c.paise)} now`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {needsUnits && (
          <Field label={`How many ${unitWord} do you hold?`} hint="It is valued by typing now. With the quantity, its price sets what it is worth, and it is counted by quantity from here on.">
            <input className={inputClass} inputMode="decimal" autoComplete="off" placeholder="120.5" value={units} onChange={(e) => setUnits(e.target.value)} />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button className="flex-1" disabled={busy || !picked} onClick={() => void save()}>
            Link this price
          </Button>
          {holding.priceLink && (
            <Button variant="secondary" disabled={busy} onClick={() => void unlink()}>
              Remove link
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Gold or silver outside a broker follows IBJA's benchmark. It is a market benchmark, not what a jeweller pays, so the person can
 * adjust it by a percentage; the sheet shows the gap to the rate they last typed to choose from.
 */
export function KindFeedSheet({ kind, onClose }: { kind: HoldingKind; onClose: () => void }) {
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [feed, setFeed] = useState<"" | "gold" | "silver">(kind.feed ?? (/silver/i.test(kind.name) ? "silver" : /gold/i.test(kind.name) ? "gold" : ""));
  const [percent, setPercent] = useState(String(kind.feedAdjustBp / 100));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useQuery({ queryKey: ["feed-preview", kind.id, feed], queryFn: () => api.get<FeedPreview>(`/api/prices/kinds/${kind.id}/preview?feed=${feed}`), enabled: feed !== "", retry: false });
  const per = kind.ratePer > 1 ? `${kind.ratePer} ${kind.unit ?? ""}`.trim() : (kind.unitOne ?? kind.unit ?? "unit");
  const bp = Math.round(Number(percent) * 100);
  const valid = percent.trim() !== "" && Number.isFinite(bp) && Math.abs(bp) <= 5000;

  const save = async () => {
    if (feed !== "" && !valid) return setError("The adjustment looks wrong. Use a percentage such as 1.2, or 0.");
    setBusy(true);
    setError("");
    try {
      await api.patch(`/api/holding-kinds/${kind.id}`, { feed: feed === "" ? null : feed, ...(feed !== "" ? { feedAdjustBp: bp } : {}) });
      if (feed !== "") {
        const r = await api.post<PriceRefresh>("/api/prices/refresh");
        toast.show(describeRefresh(r));
      } else {
        toast.show("Price feed removed. Type the rate yourself again.");
      }
      await refresh();
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  const gap = preview.data && preview.data.lastTypedPaise !== null ? preview.data.suggestedAdjustBp / 100 : null;
  return (
    <Sheet title={`${kind.name}: price feed`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-sm text-soft">Alfred can follow the IBJA benchmark, the rate jewellers across India go by, published each day. It applies to {kind.name} you hold outside a broker, every Saturday and when you press Refresh prices.</p>
        <Field label="Follow">
          <select className={inputClass} value={feed} onChange={(e) => setFeed(e.target.value as "" | "gold" | "silver")}>
            <option value="">Nothing, I type the rate myself</option>
            <option value="gold">IBJA gold (999)</option>
            <option value="silver">IBJA silver (999)</option>
          </select>
        </Field>
        {feed !== "" && (
          <>
            {preview.isPending && <p className="text-sm text-soft">Looking up today&apos;s rate…</p>}
            {preview.isError && <p className="text-sm text-warn-ink">IBJA could not be reached just now. You can still save and it will be tried again.</p>}
            {preview.data && (
              <div className="space-y-1 rounded-xl bg-sunk p-3 text-sm">
                <p>
                  IBJA {feed} now <span className="font-medium">{rupees(preview.data.ratePaise)}</span> per {per}, {shortDate(preview.data.date)} {preview.data.session}.
                </p>
                {preview.data.lastTypedPaise !== null && (
                  <p className="text-soft">
                    Your last typed rate was {rupees(preview.data.lastTypedPaise)}, {gap !== null && gap !== 0 ? `${Math.abs(gap)}% ${gap > 0 ? "above" : "below"}` : "the same as"} IBJA.
                    {gap !== null && gap !== 0 && (
                      <button type="button" className="ml-1 text-brand underline" onClick={() => setPercent(String(gap))}>
                        Use {gap > 0 ? "+" : ""}
                        {gap}%
                      </button>
                    )}
                  </p>
                )}
              </div>
            )}
            <Field label="Adjust by (%)" hint="Added to IBJA's rate. Use a positive figure if you are quoted more than the benchmark, a negative one if less. 0 uses IBJA as it is.">
              <input className={inputClass} inputMode="decimal" autoComplete="off" value={percent} onChange={(e) => setPercent(e.target.value)} />
            </Field>
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          {feed === "" ? "Save" : "Save and fetch now"}
        </Button>
      </form>
    </Sheet>
  );
}
