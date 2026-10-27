import type { ReactNode } from "react";
import type { BriefingLine } from "../api";
import { Link } from "../router";

export function Orb({ className = "size-8" }: { className?: string }) {
  return <span className={`orb inline-block shrink-0 ${className}`} aria-hidden="true" />;
}

/** Alfred's briefing: the greeting and the facts that matter now, plus a reserved spot for conversation. */
export function AlfredPanel({ greeting, subline, lines, footer }: { greeting: string; subline?: string; lines: BriefingLine[]; footer?: ReactNode }) {
  return (
    <section aria-label="Alfred's briefing" className="rounded-3xl bg-navy p-5 text-on-navy md:p-6">
      <div className="flex items-center gap-3">
        <Orb className="size-9" />
        <div>
          <h2 className="font-display text-xl leading-tight text-white">{greeting}</h2>
          <p className="text-xs text-navy-muted">{subline ?? "Here is where things stand."}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-1">
        {lines.map((line) => (
          <li key={line.key}>
            {line.to ? (
              <Link
                to={line.to}
                className="-mx-2 flex min-h-11 items-start gap-3 rounded-xl px-2 py-2 text-[15px] leading-snug hover:bg-navy-soft"
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brass" aria-hidden="true" />
                <span>{line.text}</span>
              </Link>
            ) : (
              <p className="flex items-start gap-3 py-2 text-[15px] leading-snug">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brass" aria-hidden="true" />
                <span>{line.text}</span>
              </p>
            )}
          </li>
        ))}
      </ul>

      <div
        aria-disabled="true"
        className="mt-4 flex min-h-11 items-center justify-between rounded-xl border border-navy-soft px-3 text-sm text-navy-muted"
      >
        <span>Ask Alfred anything…</span>
        <span className="rounded-full bg-navy-soft px-2 py-0.5 text-xs">coming soon</span>
      </div>

      <p className="mt-3 text-xs text-navy-muted">
        {footer ?? "Everything here comes from your recorded transactions. I don't make estimates yet."}
      </p>
    </section>
  );
}
