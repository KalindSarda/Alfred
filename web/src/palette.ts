import type { FoundationRow } from "./api";

/** The colours the Plan, Foundations and the charts share: done is green, in progress blue, needs attention amber, long term purple. */
export const STATUS_COLOR: Record<FoundationRow["status"], string> = { ok: "#1f8a5b", building: "#2b6cde", attention: "#d98a1f" };
export const BLUE = "#2b6cde";
export const LONG_TERM = "#7a5ea8";

/** The bar colour for a foundation: its status, except the long-term goal while it is still in progress. */
export const barColor = (r: Pick<FoundationRow, "key" | "status">): string => (r.key === "fire" && r.status !== "ok" ? LONG_TERM : STATUS_COLOR[r.status]);
