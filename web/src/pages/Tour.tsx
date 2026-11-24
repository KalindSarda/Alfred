import { useNavigate } from "../router";
import { Button, Card, ErrorText } from "../components/ui";
import { useClearDemo, useDemoStatus, useLoadDemo } from "../demo";
import { TOUR } from "../tour";
import { setTourStep, startTour, useTourStep } from "../tourState";

/** The whole tour on one page: every step as a card with its own button, for anyone who would rather pick than be walked. */
export function Tour() {
  const go = useNavigate();
  const demo = useDemoStatus();
  const load = useLoadDemo();
  const clear = useClearDemo();
  const active = useTourStep();
  const loaded = demo.data?.loaded === true;

  return (
    <div className="space-y-4">
      <h1 className="text-3xl">Take the tour</h1>
      <p className="text-soft">A walk through every part of Alfred, one screen at a time. A small guide stays at the bottom and tells you what to look at.</p>

      <Card className="space-y-3">
        <h2 className="font-medium">{loaded ? "Sample data is loaded" : "Try it with sample data"}</h2>
        <p className="text-sm text-soft">
          {loaded
            ? "Everything you see is made up: a small, easy life with round numbers. When you are done, clear it and set up your own."
            : "Load a small, easy sample life so every screen has something to show. It is all marked Demo, and one tap clears it."}
        </p>
        <div className="flex flex-wrap gap-3">
          {loaded ? (
            <Button variant="secondary" disabled={clear.pending} onClick={clear.clear}>
              Clear sample data and start fresh
            </Button>
          ) : (
            <Button
              disabled={load.pending}
              onClick={() => {
                void load.load().then(() => go("/"));
              }}
            >
              Load sample data and start
            </Button>
          )}
          <Button
            variant={loaded ? "primary" : "secondary"}
            onClick={() => {
              startTour(0);
              go(TOUR[0]?.to ?? "/");
            }}
          >
            {active === null ? "Start the tour" : "Start again"}
          </Button>
        </div>
        <ErrorText>{load.error || clear.error}</ErrorText>
      </Card>

      <ol className="space-y-3">
        {TOUR.map((step, i) => (
          <li key={step.id}>
            <Card className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs tracking-wide text-soft uppercase">Step {i + 1}</p>
                  <h2 className="font-medium">{step.title}</h2>
                </div>
                <Button
                  variant="secondary"
                  className="min-h-11 shrink-0 text-sm"
                  onClick={() => {
                    setTourStep(i);
                    go(step.to);
                  }}
                >
                  Open
                </Button>
              </div>
              <p className="text-sm text-soft">{step.what}</p>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
