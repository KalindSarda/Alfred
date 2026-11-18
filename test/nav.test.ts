import { describe, expect, it } from "vitest";
import { isActiveItem, NAV, sectionOf } from "../web/src/nav";
import { HUB_PATHS, redirectFor } from "../web/src/routes";

const items = NAV.flatMap((s) => s.items);
const split = (to: string) => {
  const url = new URL(to, "https://x.test");
  return { path: url.pathname, search: url.search };
};

describe("the navigation tree", () => {
  it("has unique ids and addresses, and none is an old address that redirects", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.to)).size).toBe(items.length);
    for (const i of items) {
      const { path, search } = split(i.to);
      expect(path, i.id).toBe(i.path);
      expect(redirectFor(path, search, ""), i.id).toBeNull();
    }
  });

  it("opens each section on its own hub's address", () => {
    for (const s of NAV) expect(s.items[0]?.to, s.hub).toBe(HUB_PATHS[s.hub]);
  });

  it("marks exactly one item as the screen showing, for every address in the tree", () => {
    for (const i of items) {
      const { path, search } = split(i.to);
      const active = items.filter((o) => isActiveItem(o, path, search));
      expect(active.map((a) => a.id), i.to).toEqual([i.id]);
    }
  });

  it("falls back to the first view of a page when the address names none or an unknown one", () => {
    const active = (to: string) => {
      const { path, search } = split(to);
      return items.filter((o) => isActiveItem(o, path, search)).map((a) => a.id);
    };
    expect(active("/plan?view=nonsense")).toEqual(["overview"]);
    expect(active("/money?view=other")).toEqual(["accounts"]);
  });

  it("puts every page under the section it belongs to", () => {
    expect(sectionOf("/trends").hub).toBe("activity");
    expect(sectionOf("/settings").hub).toBe("you");
    expect(sectionOf("/categories").hub).toBe("you");
    expect(sectionOf("/plan").hub).toBe("plan");
    expect(sectionOf("/something-else").hub).toBe("today");
  });
});
