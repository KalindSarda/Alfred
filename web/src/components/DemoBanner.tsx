import { useClearDemo, useDemoStatus } from "../demo";
import { Link } from "../router";
import { Button } from "./ui";

/** A slim reminder on every screen while the sample data is loaded, with the way out one tap away. */
export function DemoBanner() {
  const demo = useDemoStatus();
  const clear = useClearDemo();
  if (!demo.data?.loaded) return null;
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-ink">
      <span className="font-medium">You are looking at sample data.</span>
      <Link to="/tour" className="inline-flex min-h-11 items-center underline">
        Take the tour
      </Link>
      <Button variant="secondary" className="min-h-11 py-1.5 text-sm sm:ml-auto" disabled={clear.pending} onClick={clear.clear}>
        Clear and start fresh
      </Button>
      {clear.error && <span role="alert">{clear.error}</span>}
    </div>
  );
}
