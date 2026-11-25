import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useI18n } from "../i18n/i18n";

/* ------------------------------------------------------------------------------------- toasts */

type ToastTone = "info" | "success" | "error";
type Toast = { id: number; message: string; tone: ToastTone };
export type Notify = {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<Notify | null>(null);

export function ToastProvider(props: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const { t } = useI18n();

  const show = useCallback((message: string, tone: ToastTone) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), message, tone });
    timer.current = window.setTimeout(() => setToast(null), tone === "error" ? 6000 : 2800);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const notify = useMemo<Notify>(
    () => ({
      info: (message) => show(message, "info"),
      success: (message) => show(message, "success"),
      error: (message) => show(message, "error"),
    }),
    [show],
  );

  const Icon = toast?.tone === "error" ? AlertTriangle : toast?.tone === "success" ? CheckCircle2 : Info;

  return (
    <ToastContext.Provider value={notify}>
      {props.children}
      <div className="toast-region" aria-live={toast?.tone === "error" ? "assertive" : "polite"}>
        {toast && (
          <div
            className={`toast toast--${toast.tone}`}
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{toast.message}</span>
            <button type="button" onClick={() => setToast(null)} aria-label={t("閉じる", "Dismiss")}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useNotify() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useNotify must be used inside <ToastProvider>");
  return context;
}

/* ------------------------------------------------------------------------------- confirmation */

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  tone?: "default" | "danger";
};
type Confirm = (options: ConfirmOptions) => Promise<boolean>;
type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider(props: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  const settle = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {props.children}
      <dialog
        ref={dialogRef}
        className="sheet-dialog"
        aria-labelledby="confirm-title"
        onCancel={(event) => {
          event.preventDefault();
          settle(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) settle(false);
        }}
      >
        {pending && (
          <div className="sheet">
            <h2 id="confirm-title">{pending.title}</h2>
            {pending.message && <div className="sheet__body">{pending.message}</div>}
            <div className="sheet__actions">
              <button
                className={pending.tone === "danger" ? "button button--danger" : "button button--primary"}
                type="button"
                onClick={() => settle(true)}
                autoFocus
              >
                {pending.confirmLabel}
              </button>
              <button className="button button--ghost" type="button" onClick={() => settle(false)}>
                {t("キャンセル", "Cancel")}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return context;
}
