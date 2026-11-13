import { NEED_COLORS, SAVINGS_COLOR, WANT_COLORS } from "../cashflow";

/** One line that says what the colours mean. */
export function FlowLegend() {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft">
      <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: NEED_COLORS[0] }} />Needs</span>
      <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: WANT_COLORS[0] }} />Wants</span>
      <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: SAVINGS_COLOR }} />Saved</span>
    </p>
  );
}
