import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Category, api, describeError } from "../api";
import { Button, Card, Empty, ErrorText, Field, Sheet, Spinner, inputClass } from "../components/ui";
import { useToast } from "../components/toast";
import { useCategories, useRefreshMoney } from "../queries";
import { Link } from "../router";

type Kind = "expense" | "income";

const entriesText = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

function useCategoryActions(onClose: () => void) {
  const client = useQueryClient();
  const refresh = useRefreshMoney();
  const toast = useToast();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await Promise.all([client.invalidateQueries({ queryKey: ["categories"] }), refresh()]);
      toast.show(done);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };
  return { run, error, setError, busy };
}

function AddSheet({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const [name, setName] = useState("");
  const { run, error, setError, busy } = useCategoryActions(onClose);
  return (
    <Sheet title={kind === "expense" ? "Add an expense category" : "Add an income category"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Give the category a name.");
          void run(() => api.post("/api/categories", { name: name.trim(), kind }), "Category added.");
        }}
      >
        <Field label="Name">
          <input className={inputClass} maxLength={40} autoComplete="off" placeholder={kind === "expense" ? "Pets" : "Freelance"} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={busy}>
          Add
        </Button>
      </form>
    </Sheet>
  );
}

function EditSheet({ category, others, onClose }: { category: Category; others: Category[]; onClose: () => void }) {
  const [name, setName] = useState(category.name);
  const [target, setTarget] = useState("");
  const [merging, setMerging] = useState(false);
  const { run, error, setError, busy } = useCategoryActions(onClose);
  const into = others.find((o) => o.id === target);
  const url = `/api/categories/${category.id}`;

  return (
    <Sheet title={category.name} onClose={onClose}>
      <div className="space-y-5">
        <p className="text-sm text-soft">
          {entriesText(category.entryCount)}
          {category.isSystem && ". Built in, so it can be archived but not renamed, merged or deleted"}
        </p>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError("The name cannot be empty.");
            void run(() => api.patch(url, { name: name.trim() }), "Saved.");
          }}
        >
          <Field label="Name">
            <input className={inputClass} maxLength={40} autoComplete="off" disabled={category.isSystem} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {!category.isSystem && (
            <Button type="submit" variant="secondary" disabled={busy || name.trim() === category.name}>
              Save name
            </Button>
          )}
        </form>

        {!category.isSystem && !category.archived && others.length > 0 && (
          <div className="space-y-3 border-t border-line pt-4">
            <h3 className="font-medium">Merge into another category</h3>
            {!merging ? (
              <Button type="button" variant="secondary" onClick={() => setMerging(true)}>
                Merge…
              </Button>
            ) : (
              <>
                <Field label="Merge into">
                  <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Choose…</option>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {into && (
                  <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">
                    {entriesText(category.entryCount)} will move to {into.name}, and {category.name} will be removed. Its budget moves too, unless {into.name} already has one. This cannot be undone.
                  </p>
                )}
                <Button
                  type="button"
                  disabled={!into || busy}
                  onClick={() => void run(() => api.post(`${url}/merge`, { intoId: target }), `Merged into ${into?.name ?? "the other category"}.`)}
                >
                  Merge and remove {category.name}
                </Button>
              </>
            )}
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => api.patch(url, { archived: !category.archived }), category.archived ? "Restored." : "Archived.")}
          >
            {category.archived ? "Restore" : "Archive"}
          </Button>
          {!category.isSystem && category.entryCount === 0 && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete ${category.name}? Its budget, if any, goes with it.`)) void run(() => api.del(url), "Category deleted.");
              }}
            >
              Delete
            </Button>
          )}
        </div>
        {!category.isSystem && category.entryCount > 0 && (
          <p className="text-xs text-soft">A category with entries cannot be deleted. Merge it into another, or archive it to hide it.</p>
        )}
      </div>
    </Sheet>
  );
}

export function Categories() {
  const categories = useCategories();
  const [kind, setKind] = useState<Kind>("expense");
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (categories.isPending) return <Spinner />;
  if (categories.isError) return <ErrorText>Could not load your categories. Try again.</ErrorText>;

  const ofKind = categories.data.filter((c) => c.kind === kind);
  const shown = ofKind.filter((c) => showArchived || !c.archived);
  const current = categories.data.find((c) => c.id === editing);

  return (
    <div className="space-y-4">
      <div>
        <Link to="/more" className="text-sm text-brand">
          ← More
        </Link>
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-3xl">Categories</h1>
          <Button onClick={() => setAdding(true)}>Add</Button>
        </div>
      </div>

      <div role="tablist" aria-label="Kind" className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
        {(["expense", "income"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={`min-h-11 rounded-lg text-sm font-medium ${kind === k ? "bg-card shadow-sm" : "text-soft"}`}
          >
            {k === "expense" ? "Expense" : "Income"}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty title="Nothing here yet">Add a category to start filing entries under it.</Empty>
      ) : (
        <Card pad="p-0">
          <ul className="divide-y divide-line">
            {shown.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setEditing(c.id)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-hover">
                  <span className="min-w-0 truncate">
                    {c.name}
                    {c.isSystem && <span className="ml-2 text-xs text-faint">built in</span>}
                    {c.archived && <span className="ml-2 text-xs text-faint">archived</span>}
                  </span>
                  <span className="shrink-0 text-sm text-soft">{entriesText(c.entryCount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <label className="flex min-h-11 items-center gap-3 text-sm text-soft">
        <input type="checkbox" className="size-5 accent-brand" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived categories
      </label>

      {adding && <AddSheet kind={kind} onClose={() => setAdding(false)} />}
      {current && (
        <EditSheet
          key={current.id}
          category={current}
          others={ofKind.filter((o) => o.id !== current.id && !o.archived)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
