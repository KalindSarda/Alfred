import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { type Policy, type ProtectionView, api, describeError } from "../api";
import { useToast } from "../components/toast";
import { AmountInput, Button, Card, Empty, ErrorText, Field, Sheet, Spinner, inputClass } from "../components/ui";
import { rupeesToPaise } from "../filters";
import { paiseToInput, rupees, shortDate, today } from "../format";
import { useProtection } from "../queries";
import { Link } from "../router";

const KIND: Record<Policy["kind"], string> = { health: "Health", term: "Term life", other: "Other" };
const FREQ: Record<Policy["frequency"], string> = { yearly: "a year", half_yearly: "every 6 months", quarterly: "every 3 months", monthly: "a month" };
const TONE: Record<string, string> = { high: "bg-bad-bg text-bad", medium: "bg-warn-bg text-warn-ink", info: "bg-sunk text-soft" };

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-sunk p-1">
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} onClick={() => onChange(key)} className={`min-h-11 rounded-lg text-sm font-medium ${value === key ? "bg-card shadow-sm" : "text-soft"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function PolicySheet({ policy, onClose }: { policy: Policy | null; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<Policy["kind"]>(policy?.kind ?? "health");
  const [source, setSource] = useState<Policy["source"]>(policy?.source ?? "personal");
  const [insurer, setInsurer] = useState(policy?.insurer ?? "");
  const [cover, setCover] = useState(policy ? paiseToInput(policy.coverPaise) : "");
  const [premium, setPremium] = useState(policy && policy.premiumPaise > 0 ? paiseToInput(policy.premiumPaise) : "");
  const [frequency, setFrequency] = useState<Policy["frequency"]>(policy?.frequency ?? "yearly");
  const [renewal, setRenewal] = useState(policy?.renewalDate ?? today());
  const [error, setError] = useState("");
  const done = async (message: string) => {
    await client.invalidateQueries({ queryKey: ["protection"] });
    await client.invalidateQueries({ queryKey: ["commitments"] });
    toast.show(message);
    onClose();
  };
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (policy ? api.patch(`/api/insurance/${policy.id}`, body) : api.post("/api/insurance", body)),
    onSuccess: () => done(policy ? "Saved" : "Policy added"),
  });
  const mark = useMutation({
    mutationFn: (status: "active" | "lapsed") => api.patch(`/api/insurance/${policy?.id}`, { status }),
    onSuccess: () => done("Saved"),
  });
  const remove = useMutation({ mutationFn: () => api.del(`/api/insurance/${policy?.id}`), onSuccess: () => done("Policy removed") });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!insurer.trim()) return setError("Who is it with? Type the insurer's name.");
    const coverPaise = cover.trim() ? rupeesToPaise(cover) : 0;
    if (cover.trim() && coverPaise === null) return setError("The cover looks wrong. Use a number such as 1000000.");
    const premiumPaise = premium.trim() ? rupeesToPaise(premium) : 0;
    if (premium.trim() && premiumPaise === null) return setError("The premium looks wrong. Use a number such as 25000, or leave it empty.");
    setError("");
    save.mutate({ kind, source, insurer: insurer.trim(), coverPaise, premiumPaise: source === "employer" ? 0 : premiumPaise, frequency, renewalDate: renewal });
  };

  return (
    <Sheet title={policy ? "Edit policy" : "Add a policy"} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Segmented label="Kind" value={kind} onChange={setKind} options={[["health", "Health"], ["term", "Term life"], ["other", "Other"]] as const} />
        <Segmented label="Who pays" value={source} onChange={setSource} options={[["personal", "My own policy"], ["employer", "Through work"]] as const} />
        <Field label="Insurer">
          <input className={inputClass} maxLength={40} autoComplete="off" value={insurer} onChange={(e) => setInsurer(e.target.value)} />
        </Field>
        <Field label="Cover (₹)" hint="The sum insured.">
          <AmountInput className={inputClass} autoComplete="off" placeholder="1000000" value={cover} onChange={(e) => setCover(e.target.value)} />
        </Field>
        {source === "personal" && (
          <>
            <Field label="Premium (₹)" hint="What you pay each time. Alfred counts it among what is coming up.">
              <AmountInput className={inputClass} autoComplete="off" value={premium} onChange={(e) => setPremium(e.target.value)} />
            </Field>
            <Segmented label="How often" value={frequency} onChange={setFrequency} options={[["yearly", "Yearly"], ["half_yearly", "6 months"], ["quarterly", "3 months"], ["monthly", "Monthly"]] as const} />
          </>
        )}
        <Field label={source === "personal" ? "Next premium or renewal date" : "Renewal date"} hint={source === "personal" ? "Later dates follow from it. Alfred reminds you a week ahead and on the day." : undefined}>
          <input className={inputClass} type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} />
        </Field>
        <ErrorText>{error || (save.isError ? describeError(save.error) : mark.isError ? describeError(mark.error) : remove.isError ? describeError(remove.error) : "")}</ErrorText>
        <Button type="submit" className="w-full" disabled={save.isPending}>
          {policy ? "Save changes" : "Add policy"}
        </Button>
        {policy && (
          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" disabled={mark.isPending} onClick={() => mark.mutate(policy.status === "active" ? "lapsed" : "active")}>
              {policy.status === "active" ? "Mark as lapsed" : "Mark as active"}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove the ${policy.insurer} policy? This cannot be undone.`)) remove.mutate();
              }}
            >
              Remove
            </Button>
          </div>
        )}
      </form>
    </Sheet>
  );
}

/** The two answers the check rests on. */
function Questions({ view }: { view: ProtectionView }) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (patch: Partial<ProtectionView["profile"]>) => api.put<ProtectionView>("/api/protection/profile", patch),
    onSuccess: (data) => client.setQueryData(["protection"], data),
  });
  return (
    <Card className="space-y-4">
      <h2 className="font-medium">Two questions</h2>
      <div className="space-y-2">
        <p className="text-sm">Does anyone depend on your income, or would your loans fall on family?</p>
        <Segmented label="Dependants" value={view.profile.dependants} onChange={(dependants) => save.mutate({ dependants })} options={[["yes", "Yes"], ["partly", "Partly"], ["no", "No"], ["unknown", "Not sure"]] as const} />
      </div>
      <div className="space-y-2">
        <p className="text-sm">Do you have health cover through your employer?</p>
        <Segmented label="Employer cover" value={view.profile.employerHealth} onChange={(employerHealth) => save.mutate({ employerHealth })} options={[["yes", "Yes"], ["no", "No"], ["unknown", "Not sure"]] as const} />
      </div>
      <ErrorText>{save.isError ? describeError(save.error) : ""}</ErrorText>
    </Card>
  );
}

/** Health and life cover: where there is none, and the policies you hold. */
export function Protection() {
  const query = useProtection();
  const [sheet, setSheet] = useState<{ policy: Policy | null } | null>(null);
  const v = query.data;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/more" className="text-sm text-brand">
          ← Everything
        </Link>
        <h1 className="text-3xl">Protection</h1>
        <p className="text-sm text-soft">Health and life cover. Reference figures are common rules of thumb. Alfred does not recommend products or insurers.</p>
      </div>

      {!v && <Spinner />}
      {query.isError && <Empty title="Could not load this">Check your connection and reload.</Empty>}

      {v && (
        <>
          <div className="space-y-2">
            {v.gaps.length === 0 ? (
              <Card>
                <p className="text-sm text-good">No gaps found against the usual rules of thumb. Keep the renewal dates up to date.</p>
              </Card>
            ) : (
              v.gaps.map((g) => (
                <div key={g.key} className={`rounded-xl p-3 text-sm ${TONE[g.severity]}`}>
                  <p className="font-medium">{g.title}</p>
                  <p className="mt-1">{g.detail}</p>
                </div>
              ))
            )}
          </div>

          <Questions view={v} />

          <Card className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">Policies</h2>
              <Button variant="secondary" className="min-h-11 py-1.5 text-sm" onClick={() => setSheet({ policy: null })}>
                Add a policy
              </Button>
            </div>
            {v.policies.length === 0 ? (
              <p className="text-sm text-soft">Nothing recorded yet. Add the cover you have, including through work, so the gaps above are right.</p>
            ) : (
              <ul className="divide-y divide-line">
                {v.policies.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="flex min-h-11 w-full items-start justify-between gap-3 py-2 text-left" onClick={() => setSheet({ policy: p })}>
                      <span className={p.status === "lapsed" ? "text-faint" : ""}>
                        <span className="block font-medium">
                          {p.insurer} · {KIND[p.kind]}
                        </span>
                        <span className="block text-xs text-soft">
                          {p.source === "employer" ? "Through work" : "Your own"}
                          {p.status === "lapsed" ? " · lapsed" : ` · due ${shortDate(p.nextDueDate)}${p.daysToDue <= 30 ? ` (${p.daysToDue === 0 ? "today" : `in ${p.daysToDue} ${p.daysToDue === 1 ? "day" : "days"}`})` : ""}`}
                        </span>
                      </span>
                      <span className="text-right text-sm tabular-nums">
                        {rupees(p.coverPaise)}
                        {p.premiumPaise > 0 && (
                          <span className="block text-xs text-soft">
                            {rupees(p.premiumPaise)} {FREQ[p.frequency]}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {v.yearlyPremiumPaise > 0 && <p className="text-xs text-soft">Your own policies cost {rupees(v.yearlyPremiumPaise)} a year in all.</p>}
          </Card>
        </>
      )}
      {sheet && <PolicySheet policy={sheet.policy} onClose={() => setSheet(null)} />}
    </div>
  );
}
