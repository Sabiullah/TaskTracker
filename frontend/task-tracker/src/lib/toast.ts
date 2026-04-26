/**
 * Tiny pub/sub for in-app toast notifications.
 *
 * The Approvals UI calls `toast.show("WFH approved", "ok")` after a successful
 * action; the global `<ToastHost />` component (mounted in App.tsx in Phase 5)
 * subscribes and renders the toast briefly.
 *
 * Kept in `lib/` rather than `lib/api/` because toasts are a UI concern, not
 * an API one. The api hooks import this and emit on success/failure.
 */

export type ToastKind = "ok" | "err";
type ToastFn = (msg: string, kind: ToastKind) => void;

const listeners = new Set<ToastFn>();

export const toast = {
  show(msg: string, kind: ToastKind = "ok"): void {
    listeners.forEach((fn) => fn(msg, kind));
  },
  subscribe(fn: ToastFn): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
