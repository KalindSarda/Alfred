import { useEffect, useState } from "react";
import { isActiveItem, NAV, type NavSection, sectionOf } from "../nav";
import { Link } from "../router";
import { Chevron, Icon } from "./ui";

/**
 * The wide sidebar: every screen under its section. The section you are in is open; the others show their heading and open
 * on a click. A section with a single screen (Today) is just a link.
 */
export function SideNav({ path, search, reviewCount }: { path: string; search: string; reviewCount: number }) {
  const current = sectionOf(path).hub;
  // One section is open at a time: the one the person last opened or closed by hand, otherwise the one they are on. Moving to
  // another section by a link hands the choice back to the page.
  const [chosen, setChosen] = useState<NavSection["hub"] | null | undefined>(undefined);
  useEffect(() => setChosen(undefined), [current]);

  return (
    <nav aria-label="Sections" className="hidden space-y-1 min-[1100px]:block">
      {NAV.map((section) => {
        const first = section.items[0];
        if (!first) return null;
        const on = section.hub === current;
        if (section.items.length === 1) {
          return (
            <Link key={section.hub} to={first.to} aria-current={on ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium ${on ? "bg-sunk text-brand" : "text-soft hover:bg-hover"}`}>
              <Icon name={section.icon} className="size-5" />
              {section.label}
            </Link>
          );
        }
        const open = chosen === undefined ? on : chosen === section.hub;
        return (
          <div key={section.hub}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setChosen(open ? null : section.hub)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium ${on ? "text-brand" : "text-soft hover:bg-hover"}`}
            >
              <Icon name={section.icon} className="size-5" />
              {section.label}
              <Chevron open={open} className="ml-auto" />
            </button>
            {open && (
              <ul className="mt-0.5 mb-1 ml-5 space-y-0.5 border-l border-line pl-3">
                {section.items.map((item) => {
                  const active = isActiveItem(item, path, search);
                  return (
                    <li key={item.id}>
                      <Link to={item.to} aria-current={active ? "page" : undefined} className={`flex min-h-10 items-center rounded-lg px-3 text-sm ${active ? "bg-sunk font-medium text-brand" : "text-soft hover:bg-hover"}`}>
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
            )}
          </div>
        );
      })}
    </nav>
  );
}
