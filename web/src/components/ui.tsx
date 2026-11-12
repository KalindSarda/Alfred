import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { caretAfter, formatAmountInput, formatRupees, formatRupeesCompact } from "../../../src/domain/money";

export const inputClass =
  "w-full rounded-xl border border-line bg-card px-3 py-3 text-base text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong disabled:bg-brand/50",
  secondary:
    "border border-line bg-card text-ink hover:bg-hover",
  danger: "bg-bad text-white hover:opacity-90 disabled:bg-bad/50",
  ghost: "text-soft hover:bg-hover",
};

export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`min-h-11 rounded-xl px-4 py-2.5 text-base font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; /** What is wrong with this box, shown under it in place of the hint. */ error?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs font-medium text-bad">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-xs text-soft">{hint}</span>
      )}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">
      {children}
    </p>
  );
}

const surfaceClass = "border border-line bg-card shadow-sm";

/** `surface={false}` leaves the background to the caller; Tailwind utility order, not class order, decides conflicts. */
export function Card({
  children,
  className = "",
  surface = true,
  pad = "p-4",
  id,
}: {
  children: ReactNode;
  /** Lets a link point at this card ("#lent"); the page scrolls to it. */
  id?: string;
  className?: string;
  surface?: boolean;
  /** Padding utilities. Passed separately because two padding classes on one element conflict by CSS order. */
  pad?: string;
}) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-4 rounded-2xl ${pad} ${surface ? surfaceClass : ""} ${className}`}>
      {children}
    </section>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-paper p-5 pb-8 shadow-xl focus:outline-none md:max-w-md md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-full text-soft hover:bg-hover"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-center text-sm text-soft">
      {label}…
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-soft">{children}</div>}
    </div>
  );
}

const icons: Record<string, ReactNode> = {
  cashflow: (
    <>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </>
  ),
  transactions: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </>
  ),
  budgets: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  accounts: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
};

export function Icon({ name, className = "size-6" }: { name: keyof typeof icons; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

/**
 * A rupee figure for a glance: ₹45,000 as it is, then "₹1.5 L" and "₹7.23 Cr". The exact figure is the tooltip and what a
 * screen reader reads; the detail views show it in full.
 */
export function Amount({ paise, className }: { paise: number; className?: string }) {
  const full = formatRupees(paise);
  const compact = formatRupeesCompact(paise);
  if (compact === full) return <span className={className}>{full}</span>;
  return (
    <span className={className} title={full}>
      <span aria-hidden="true">{compact}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}

/**
 * A box for a rupee amount that groups the digits the Indian way as they are typed (1234567 becomes 12,34,567), keeps up to
 * two decimals, and keeps the caret beside the digit being typed. A drop-in for an input: callers read `e.target.value`, which
 * is the grouped text, and the amount parsers already ignore the commas. For quantities, percentages and days use a plain input.
 */
export function AmountInput({ allowNegative = false, onChange, ...rest }: InputHTMLAttributes<HTMLInputElement> & { allowNegative?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (caret.current !== null && el && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return (
    <input
      ref={ref}
      inputMode="decimal"
      autoComplete="off"
      {...rest}
      onChange={(e) => {
        const el = e.target;
        const typed = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/[^0-9.]/g, "").length;
        const formatted = formatAmountInput(el.value, allowNegative);
        if (formatted !== el.value) el.value = formatted;
        const at = caretAfter(formatted, typed);
        el.setSelectionRange(at, at);
        caret.current = at;
        onChange?.(e);
      }}
    />
  );
}
