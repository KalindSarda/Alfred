import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

interface ToastState {
  message: string;
  action?: { label: string; run: () => void };
}

interface ToastApi {
  show: (message: string, action?: ToastState["action"]) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((message: string, action?: ToastState["action"]) => {
    window.clearTimeout(timer.current);
    setToast({ message, ...(action && { action }) });
    timer.current = window.setTimeout(() => setToast(null), action ? 7000 : 3500);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-24 z-[60] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-navy px-4 py-3 text-sm text-white shadow-lg md:bottom-6"
        >
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="min-h-11 shrink-0 px-2 font-semibold text-brass"
              onClick={() => {
                toast.action?.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}
