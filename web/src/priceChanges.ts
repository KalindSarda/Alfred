import type { PriceOutcome } from "./api";

/** One line of "what changed" after a price refresh. */
export interface ChangeLine {
  id: string;
  name: string;
  /** The rate before (null when it had none) and now, quoted per `per`. */
  from: number | null;
  to: number;
  per: string;
  /** How much the holding's worth moved, and how far the rate moved in percent (one decimal; null with no earlier rate). */
  changePaise: number;
  ratePct: number | null;
}

/** The prices that changed, the biggest move in rupees first; a first price (no earlier rate) comes last. */
export function changeLines(items: readonly PriceOutcome[]): ChangeLine[] {
  return items
    .filter((i) => i.status === "updated" && i.ratePaise !== null)
    .map((i) => ({
      id: i.holdingId,
      name: i.name,
      from: i.previousPaise,
      to: i.ratePaise as number,
      per: i.per ?? "unit",
      changePaise: i.changePaise,
      ratePct: i.previousPaise !== null && i.previousPaise > 0 ? Math.round(((i.ratePaise as number) / i.previousPaise - 1) * 1000) / 10 : null,
    }))
    .sort((a, b) => Math.abs(b.changePaise) - Math.abs(a.changePaise) || a.name.localeCompare(b.name));
}
