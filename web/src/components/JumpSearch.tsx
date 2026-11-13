import { useMemo, useState } from "react";
import { FEATURES, type Feature, pushRecent, RECENT_MAX, searchFeatures } from "../features";
import { useMe } from "../queries";
import { navigate } from "../router";
import { Icon, Sheet, inputClass } from "./ui";

const RECENT_KEY = "alfred.recentFeatures";

function loadRecent(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Storage can be blocked; recent items simply are not remembered.
  }
}

/** Remembers that a feature was opened, so it shows first next time the search is empty. */
export function rememberFeature(id: string): void {
  saveRecent(pushRecent(loadRecent(), id));
}

/** Type a few letters, such as "emi" or "lent", and go straight to the place; or search the entries for the words. */
export function JumpSearch({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const isOwner = Boolean(me.data?.isOwner);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const recent = useMemo(() => loadRecent(), []);
  const results = useMemo(() => {
    if (query.trim()) return searchFeatures(query, FEATURES, isOwner);
    return recent.flatMap((id) => FEATURES.filter((f) => f.id === id && (!f.ownerOnly || isOwner)));
  }, [query, recent, isOwner]);

  const text = query.trim();
  // The last row searches the entries themselves, for anything that is not a feature name.
  const rows: { key: string; label: string; sub: string; go: () => void }[] = [
    ...results.map((f: Feature) => ({
      key: f.id,
      label: f.title,
      sub: f.blurb,
      go: () => {
        rememberFeature(f.id);
        onClose();
        navigate(f.to);
      },
    })),
    ...(text
      ? [
          {
            key: "entries",
            label: `Search entries for “${text}”`,
            sub: "Merchant, note, category or account",
            go: () => {
              onClose();
              navigate(`/activity?q=${encodeURIComponent(text)}`);
            },
          },
        ]
      : []),
  ];
  const current = Math.min(active, Math.max(0, rows.length - 1));

  return (
    <Sheet title="Find anything" onClose={onClose}>
      <div className="space-y-3">
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-soft" />
          <input
            className={`${inputClass} pl-10`}
            type="search"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            autoComplete="off"
            placeholder="Try “emi”, “lent”, “goal” or “export”"
            aria-label="Find a feature"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.min(rows.length - 1, current + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(0, current - 1));
              } else if (e.key === "Enter" && rows[current]) {
                e.preventDefault();
                rows[current]!.go();
              }
            }}
          />
        </div>

        {!text && rows.length > 0 && <p className="text-xs tracking-wide text-soft uppercase">Recent</p>}
        {!text && rows.length === 0 && <p className="text-sm text-soft">Start typing to find a feature, such as EMIs, lent and borrowed, goals or your data export.</p>}

        <ul className="divide-y divide-line" role="listbox" aria-label="Results">
          {rows.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === current}>
              <button type="button" onClick={r.go} onMouseEnter={() => setActive(i)} className={`flex min-h-14 w-full flex-col justify-center rounded-lg px-2 py-2 text-left ${i === current ? "bg-sunk" : "hover:bg-hover"}`}>
                <span className="font-medium">{r.label}</span>
                <span className="text-sm text-soft">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>

        {text && results.length === 0 && <p className="text-sm text-soft">No feature by that name. You can still search your entries below.</p>}
      </div>
    </Sheet>
  );
}
