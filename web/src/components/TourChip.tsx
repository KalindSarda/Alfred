import { useState } from "react";
import { useClearDemo, useDemoStatus } from "../demo";
import { navigate } from "../router";
import { TOUR } from "../tour";
import { endTour, setTourStep, useTourStep } from "../tourState";
import { Button } from "./ui";

/**
 * The tour's guide: a card above the phone's bottom bar (bottom right on a wide screen) saying what the screen behind it is and what
 * to look at. It stays as the person opens the screens it points to, and can be folded away to a small pill.
 */
export function TourChip() {
  const step = useTourStep();
  const demo = useDemoStatus();
  const clear = useClearDemo();
  const [folded, setFolded] = useState(false);
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  const current = step === null ? undefined : TOUR[step];
  if (step === null || !current) return null;

  const last = step === TOUR.length - 1;
  const go = (to: number) => {
    const target = TOUR[to];
    if (!target) return;
    setTourStep(to);
    setFolded(false);
    navigate(target.to);
  };
  const lines = [...current.look, ...(demo.data?.loaded ? current.sample : [])];

  if (folded) {
    return (
      <button
        type="button"
        onClick={() => setFolded(false)}
        className="fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 min-h-11 rounded-full bg-navy px-4 text-sm font-medium text-on-navy shadow-lg md:right-6 md:bottom-6"
      >
        Tour {step + 1} of {TOUR.length}
      </button>
    );
  }

  return (
    <aside
      aria-label="Tour guide"
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 max-h-[55dvh] space-y-2 overflow-y-auto rounded-2xl bg-navy p-4 text-on-navy shadow-xl md:inset-x-auto md:right-6 md:bottom-6 md:w-96"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-navy-muted uppercase">
            Tour · {step + 1} of {TOUR.length}
          </p>
          <h2 className="font-display text-xl">{current.title}</h2>
        </div>
        <button type="button" onClick={() => setFolded(true)} aria-label="Fold the guide away" className="flex size-11 shrink-0 items-center justify-center rounded-xl text-navy-muted hover:bg-white/10">
          <span aria-hidden="true">–</span>
        </button>
      </div>
      <p className="text-sm">{current.what}</p>
      {/* On a phone the guide would cover the screen it points at, so what to look for starts folded there. */}
      <details key={step} open={wide} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium">
          <span aria-hidden="true" className="inline-block text-navy-muted transition-transform group-open:rotate-90">
            ›
          </span>
          What to look for
        </summary>
        <ul className="list-disc space-y-1 pl-5 text-sm text-navy-muted">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      {last && (
        <div className="space-y-2 rounded-xl bg-white/10 p-3 text-sm">
          <p>Done exploring? Clear the sample data and set up your own.</p>
          {demo.data?.loaded && (
            <Button variant="secondary" className="min-h-11 w-full text-sm" disabled={clear.pending} onClick={clear.clear}>
              Clear sample data and start fresh
            </Button>
          )}
          {clear.error && <p role="alert">{clear.error}</p>}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button variant="secondary" className="min-h-11 text-sm" disabled={step === 0} onClick={() => go(step - 1)}>
          Back
        </Button>
        {last ? (
          <Button className="min-h-11 flex-1 text-sm" onClick={endTour}>
            Finish the tour
          </Button>
        ) : (
          <Button className="min-h-11 flex-1 text-sm" onClick={() => go(step + 1)}>
            Next: {TOUR[step + 1]?.title}
          </Button>
        )}
        <button type="button" onClick={endTour} className="min-h-11 px-2 text-sm text-navy-muted hover:underline">
          End
        </button>
      </div>
    </aside>
  );
}
