import { isActiveItem, NAV } from "../nav";
import { Link } from "../router";
import { Icon, Sheet } from "./ui";

/** The phone's menu: every screen, grouped, in a scrollable sheet. Choosing one goes there and closes it. */
export function MoreMenu({ path, search, reviewCount, onClose }: { path: string; search: string; reviewCount: number; onClose: () => void }) {
  return (
    <Sheet title="Menu" onClose={onClose}>
      <div className="space-y-5">
        {NAV.map((section) => (
          <section key={section.hub} aria-label={section.label}>
            <h3 className="mb-1 flex items-center gap-2 text-xs font-medium tracking-wide text-soft uppercase">
              <Icon name={section.icon} className="size-4" />
              {section.label}
            </h3>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
              {section.items.map((item) => {
                const active = isActiveItem(item, path, search);
                return (
                  <li key={item.id}>
                    <Link to={item.to} onClick={onClose} aria-current={active ? "page" : undefined} className={`flex min-h-12 items-center px-4 text-[15px] ${active ? "font-medium text-brand" : ""}`}>
                      {item.label}
                      {item.id === "entries" && reviewCount > 0 && (
                        <span className="ml-auto rounded-full bg-warn-bg px-2 py-0.5 text-xs text-warn-ink" aria-label={`${reviewCount} entries need attention`}>
                          {reviewCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
