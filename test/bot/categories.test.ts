import { describe, expect, it } from "vitest";
import { world } from "./harness";

describe("/category", () => {
  it("lists expense and income categories, hiding archived ones", async () => {
    const w = await world();
    await w.api("PATCH", `/api/categories/${w.category("Fuel")}`, { archived: true });
    await w.say("/category");
    const text = w.tg.last.text;
    expect(text).toContain("Expense categories: ");
    expect(text).toContain("Food & Dining");
    expect(text).not.toContain("Fuel");
    expect(text).toContain("Income categories: ");
    expect(text).toContain("Salary");
    expect(text).toContain("/category add Pets");
  });

  it("adds an expense category", async () => {
    const w = await world();
    await w.say("/category add Pets");
    expect(w.tg.last.text).toBe("Added Pets as an expense category. You can use it straight away.");
    const names = ((await w.api("GET", "/api/categories")).json.items as Record<string, any>[]).filter((c) => c.kind === "expense").map((c) => c.name);
    expect(names).toContain("Pets");
  });

  it("adds an income category with the word income", async () => {
    const w = await world();
    await w.say("/category add income Freelance work");
    expect(w.tg.last.text).toBe("Added Freelance work as an income category. You can use it straight away.");
    const made = ((await w.api("GET", "/api/categories")).json.items as Record<string, any>[]).find((c) => c.name === "Freelance work");
    expect(made?.kind).toBe("income");
  });

  it("says so when the category already exists, and does not add a second", async () => {
    const w = await world();
    await w.say("/category add Fuel");
    expect(w.tg.last.text).toBe("You already have a category called Fuel.");
    const fuels = ((await w.api("GET", "/api/categories")).json.items as Record<string, any>[]).filter((c) => c.name === "Fuel");
    expect(fuels).toHaveLength(1);
  });

  it("asks for a name when it is missing or too long", async () => {
    const w = await world();
    await w.say("/category add");
    expect(w.tg.last.text).toContain("Expense categories:");
    await w.say(`/category add ${"x".repeat(41)}`);
    expect(w.tg.last.text).toContain("1 to 40 characters");
  });

  it("works with /categories as well", async () => {
    const w = await world();
    await w.say("/categories");
    expect(w.tg.last.text).toContain("Expense categories:");
  });

  it("a category added in chat can be used in the next entry", async () => {
    const w = await world();
    await w.say("/category add Pets");
    await w.say("/add 800 pets using sbi");
    expect(w.tg.last.text).toContain("under Pets");
  });

  it("an unlinked chat gets nothing", async () => {
    const w = await world({ link: false });
    const before = w.tg.messages.length;
    await w.say("/category add Pets");
    expect(w.tg.messages.length).toBe(before);
    expect(((await w.api("GET", "/api/categories")).json.items as Record<string, any>[]).some((c) => c.name === "Pets")).toBe(false);
  });
});

describe("categories after a rename or merge", () => {
  it("a merchant word whose category was merged away falls back to no category instead of failing", async () => {
    const w = await world();
    await w.api("POST", `/api/categories/${w.category("Food & Dining")}/merge`, { intoId: w.category("Groceries") });
    await w.say("/add 450 swiggy using sbi");
    expect(w.tg.last.text).toContain("Noted");
    expect(w.tg.last.text).not.toContain("went wrong");
    expect(w.tg.last.text).not.toContain("did not go through");
  });
});
