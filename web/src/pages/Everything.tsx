import { rememberFeature } from "../components/JumpSearch";
import { Icon } from "../components/ui";
import { groupedFeatures } from "../features";
import { useMe } from "../queries";
import { Link } from "../router";

/** Every feature in one place, grouped, with a line on what each is for. The search opens from the box at the top. */
export function Everything({ onSearch }: { onSearch: () => void }) {
  const me = useMe();
  const groups = groupedFeatures(undefined, Boolean(me.data?.isOwner));

  return (
    <div className="space-y-5">
      <h1 className="text-3xl">Everything</h1>

      <button
        type="button"
        onClick={onSearch}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-card px-4 text-left text-soft hover:bg-hover"
      >
        <Icon name="search" className="size-5" />
        <span>Find anything: “emi”, “lent”, “goal”…</span>
      </button>

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
