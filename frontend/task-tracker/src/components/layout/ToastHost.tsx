import { useEffect, useState, type CSSProperties } from "react";

import { toast, type ToastKind } from "@/lib/toast";

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

const stack: CSSProperties = {
  position: "fixed",
  bottom: 24,
  right: 24,
  zIndex: 9999,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  pointerEvents: "none",
};

const card = (kind: ToastKind): CSSProperties => ({
  background: kind === "ok" ? "#166534" : "#991b1b",
  color: "#fff",
  padding: "10px 18px",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
  pointerEvents: "auto",
  maxWidth: 400,
  animation: "tt-toast-in 200ms ease-out",
});

let nextId = 1;

/**
 * Subscribes to the global `toast` bus and renders the most recent 5 toasts
 * in a fixed stack. Each auto-dismisses after 3.5s. Mount once at the App
 * root.
 */
export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const unsub = toast.subscribe((text, kind) => {
      const id = nextId++;
      setItems((prev) => [...prev, { id, text, kind }].slice(-5));
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    });
    return () => {
      unsub();
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={stack} role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} style={card(t.kind)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
