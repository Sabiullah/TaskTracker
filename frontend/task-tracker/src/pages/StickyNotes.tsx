import { useState, useEffect, useRef, useCallback } from "react";
import { loadLS, saveLS } from "@/utils/storage";
import type { StickyNote } from "@/types";

interface StickyNotesProps {
  userId: string | null | undefined;
}

const COLORS = [
  { bg: "#fef9c3", border: "#fde047", label: "Yellow" },
  { bg: "#dcfce7", border: "#86efac", label: "Green" },
  { bg: "#dbeafe", border: "#93c5fd", label: "Blue" },
  { bg: "#fce7f3", border: "#f9a8d4", label: "Pink" },
  { bg: "#ede9fe", border: "#c4b5fd", label: "Purple" },
  { bg: "#fff", border: "#cbd5e1", label: "White" },
];

function storageKey(userId: string): string {
  return `sticky_notes_${userId}`;
}

function loadNotes(userId: string): StickyNote[] {
  return loadLS(storageKey(userId), []) as StickyNote[];
}

function saveNotes(userId: string, notes: StickyNote[]): void {
  saveLS(storageKey(userId), notes);
}

function makeNote(colorIdx = 0): StickyNote {
  return {
    id: Date.now() + Math.random(),
    text: "",
    colorIdx,
    created: new Date().toISOString(),
  };
}

export default function StickyNotes({ userId }: StickyNotesProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  // skipSave starts true so the very first save effect (with notes=[])
  // doesn't overwrite the real data that the load effect is about to restore.
  const skipSave = useRef(true);

  // Load from localStorage when userId is available
  useEffect(() => {
    if (!userId) return;
    skipSave.current = true; // tell save effect to skip the upcoming re-render
    Promise.resolve().then(() => setNotes(loadNotes(userId)));
  }, [userId]);

  // Persist whenever notes change — but skip the first fire caused by the load above
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false; // allow all future saves
      return;
    }
    if (userId) saveNotes(userId, notes);
  }, [notes, userId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const addNote = () => {
    setNotes((n) => [...n, makeNote(0)]);
  };

  const updateNote = useCallback((id: number, text: string) => {
    setNotes((n) =>
      n.map((note) => (note.id === id ? { ...note, text } : note)),
    );
  }, []);

  const changeColor = useCallback((id: number, colorIdx: number) => {
    setNotes((n) =>
      n.map((note) => (note.id === id ? { ...note, colorIdx } : note)),
    );
  }, []);

  const deleteNote = useCallback((id: number) => {
    setNotes((n) => n.filter((note) => note.id !== id));
  }, []);

  const toggleOpen = () => {
    setOpen((o) => {
      if (!o && notes.length === 0) {
        setNotes([makeNote(0)]);
      }
      return !o;
    });
  };

  const noteCount = notes.filter((n) => n.text.trim()).length;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={toggleOpen}
        title="My Notes (private)"
        style={{
          position: "fixed",
          top: 8,
          left: "calc(50% - 60px)",
          zIndex: 9000,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "1.5px solid rgba(255,255,255,.85)",
          background: open ? "#1e293b" : "#f59e0b",
          color: "#fff",
          fontSize: 16,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .2s, transform .15s",
          transform: open ? "rotate(45deg) scale(1.05)" : "scale(1)",
        }}
      >
        {open ? "✕" : "📝"}
        {/* Badge — count of non-empty notes */}
        {!open && noteCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              background: "#ef4444",
              color: "#fff",
              fontSize: 9,
              fontWeight: 800,
              borderRadius: "50%",
              width: 15,
              height: 15,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #fff",
            }}
          >
            {noteCount}
          </span>
        )}
      </button>

      {/* Notes panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 8999,
            width: 340,
            maxHeight: "70vh",
            background: "#1e293b",
            borderRadius: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,.35)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px 10px",
              background: "#0f172a",
              borderBottom: "1px solid #334155",
              flexShrink: 0,
            }}
          >
            <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 14 }}>
              📝 My Notes
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: "#94a3b8",
                  marginLeft: 6,
                }}
              >
                (private · only you can see this)
              </span>
            </div>
            <button
              onClick={addNote}
              style={{
                padding: "4px 12px",
                background: "#f59e0b",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              + Add
            </button>
          </div>

          {/* Notes list */}
          <div
            style={{
              overflowY: "auto",
              flex: 1,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {notes.length === 0 ? (
              <div
                style={{
                  color: "#64748b",
                  textAlign: "center",
                  padding: "30px 0",
                  fontSize: 13,
                }}
              >
                No notes yet.
                <br />
                Click <b>+ Add</b> to create one.
              </div>
            ) : (
              notes.map((note) => {
                const col = COLORS[note.colorIdx] || COLORS[0];
                return (
                  <div
                    key={note.id}
                    style={{
                      background: col.bg,
                      border: `1.5px solid ${col.border}`,
                      borderRadius: 8,
                      padding: "8px 10px",
                      flexShrink: 0,
                    }}
                  >
                    {/* Color picker + delete */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginBottom: 6,
                      }}
                    >
                      {COLORS.map((c, i) => (
                        <button
                          key={i}
                          onClick={() => changeColor(note.id, i)}
                          title={c.label}
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: c.bg,
                            border:
                              note.colorIdx === i
                                ? `2.5px solid #1e293b`
                                : `1.5px solid ${c.border}`,
                            cursor: "pointer",
                            padding: 0,
                            flexShrink: 0,
                          }}
                        />
                      ))}
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>
                        {new Date(note.created).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                      <button
                        onClick={() => deleteNote(note.id)}
                        title="Delete note"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          color: "#94a3b8",
                          padding: "0 2px",
                          lineHeight: 1,
                        }}
                      >
                        🗑
                      </button>
                    </div>
                    <textarea
                      autoFocus={note.text === ""}
                      value={note.text}
                      onChange={(e) => updateNote(note.id, e.target.value)}
                      placeholder="Type your note here…"
                      rows={3}
                      style={{
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        resize: "vertical",
                        fontSize: 13,
                        color: "#1e293b",
                        outline: "none",
                        fontFamily: "inherit",
                        lineHeight: 1.5,
                        boxSizing: "border-box",
                        minHeight: 60,
                      }}
                    />
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "8px 14px",
              borderTop: "1px solid #334155",
              fontSize: 11,
              color: "#475569",
              background: "#0f172a",
              flexShrink: 0,
              textAlign: "center",
            }}
          >
            🔒 Saved only on this device · not shared with anyone
          </div>
        </div>
      )}
    </>
  );
}
