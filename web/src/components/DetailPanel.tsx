import type { ReactNode } from "react";

/**
 * The column beside a list on a wide screen: the open entry's form, or a line saying what to do. It stays in view while the
 * list scrolls. On a phone the same form opens in a sheet instead.
 */
export function DetailPanel({ title, onClose, empty, children }: { title?: string; onClose?: () => void; empty: string; children?: ReactNode }) {
  return (
    <aside aria-label="Details" className="sticky top-6 max-h-[calc(100dvh-3rem)] self-start overflow-y-auto rounded-2xl border border-line bg-card p-4">
      {children ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-lg">{title}</h2>
            {onClose && (
              <button type="button" onClick={onClose} aria-label="Close details" className="flex size-11 items-center justify-center rounded-full text-soft hover:bg-hover">
                ✕
              </button>
            )}
          </div>
          {children}
        </>
      ) : (
        <p className="py-6 text-center text-sm text-soft">{empty}</p>
      )}
    </aside>
  );
}
