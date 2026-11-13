import { rememberFeature } from "../components/JumpSearch";
import { Icon } from "../components/ui";
import { groupedFeatures } from "../features";
import { useMe } from "../queries";
import { type NavStyle, setNavStyle, useNavStyle } from "../navStyle";
import { Link } from "../router";

/** You: settings and every feature in one place, grouped, with a line on what each is for. The search opens from the box at the top. */
export function You({ onSearch }: { onSearch: () => void }) {
  const me = useMe();
  const groups = groupedFeatures(undefined, Boolean(me.data?.isOwner));
  const layout = useNavStyle();

  return (
    <div className="space-y-5">
      <h1 className="text-3xl">You</h1>

      <button
        type="button"
        onClick={onSearch}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-card px-4 text-left text-soft hover:bg-hover"
      >
        <Icon name="search" className="size-5" />
        <span>Find anything: “emi”, “lent”, “goal”…</span>
      </button>

      <section aria-label="Layout" className="hidden space-y-2 md:block">
        <h2 className="text-xs tracking-wide text-soft uppercase">Layout on a big screen</h2>
        <div role="group" aria-label="Navigation on a big screen" className="grid max-w-sm grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
          {(
            [
              ["side", "Sidebar"],
              ["top", "Top bar"],
            ] as [NavStyle, string][]
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={layout === value} onClick={() => setNavStyle(value)} className={`min-h-11 rounded-lg text-sm font-medium ${layout === value ? "bg-card shadow-sm" : "text-soft"}`}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {groups.map(({ group, items }) => (
        <section key={group} aria-label={group} className="space-y-2">
          <h2 className="text-xs tracking-wide text-soft uppercase">{group}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((f) => (
              <li key={f.id}>
                <Link
                  to={f.to}
                  onClick={() => rememberFeature(f.id)}
                  className="flex min-h-16 flex-col justify-center rounded-2xl border border-line bg-card px-4 py-2.5 hover:bg-hover"
                >
                  <span className="font-medium">{f.title}</span>
                  <span className="text-sm text-soft">{f.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
