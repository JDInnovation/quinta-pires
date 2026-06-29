import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [pending, setPending] = useState<PendingState | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const close = useCallback(
    (result: boolean) => {
      setPending((curr) => {
        if (curr) curr.resolve(result);
        return null;
      });
    },
    []
  );

  useEffect(() => {
    if (!pending) return;
    confirmBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  const tone = pending?.tone ?? "default";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="confirm-overlay"
          role="presentation"
          onClick={() => close(false)}
        >
          <div
            className={`confirm-dialog confirm-dialog--${tone}`}
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title ?? "Confirmação"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-icon" aria-hidden="true">
              {tone === "danger" ? "⚠️" : "❓"}
            </div>
            {pending.title && (
              <h2 className="confirm-title">{pending.title}</h2>
            )}
            <p className="confirm-message">{pending.message}</p>
            <div className="confirm-actions">
              <button
                type="button"
                className="confirm-btn confirm-btn--cancel"
                onClick={() => close(false)}
              >
                {pending.cancelLabel ?? "Cancelar"}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className={`confirm-btn confirm-btn--${tone}`}
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = (): ConfirmFn => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm deve ser usado dentro de <ConfirmProvider>");
  }
  return ctx;
};

export default ConfirmProvider;
