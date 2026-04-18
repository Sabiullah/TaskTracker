import React from "react";
import { createPortal } from "react-dom";

export interface ModalWrapProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Tailor the inner card — defaults match the legacy ModalWrap layout. */
  cardStyle?: React.CSSProperties;
  /** Swap the default centred layout for a top-anchored overlay, useful
   *  when the underlying page is a tall table and the user needs the
   *  modal visible without scrolling the page. */
  anchor?: "center" | "top";
}

/**
 * Overlay + card rendered into ``document.body`` via a portal. The portal
 * is essential — any ancestor with ``transform`` / ``filter`` /
 * ``backdrop-filter`` / ``will-change`` / ``contain: paint`` creates a
 * containing block for ``position: fixed``, which silently traps the
 * overlay inside that ancestor. Rendering to ``document.body`` guarantees
 * the modal escapes every parent and layers on top of the page content.
 */
export default function ModalWrap({
  onClose,
  children,
  cardStyle,
  anchor = "top",
}: ModalWrapProps) {
  const overlay = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,.65)",
        zIndex: 10000,
        display: "flex",
        alignItems: anchor === "top" ? "flex-start" : "center",
        justifyContent: "center",
        padding:
          anchor === "top" ? "48px 16px 24px" : "16px",
        overflowY: "auto",
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 24,
          width: 420,
          maxWidth: "96vw",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 24px 70px rgba(0,0,0,.35)",
          ...cardStyle,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
  return createPortal(overlay, document.body);
}
