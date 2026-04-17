interface ImportModalProps {
  importOpen: boolean;
  csvText: string;
  importErr: string;
  importMode: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onCsvChange: (text: string) => void;
  onModeChange: (mode: string) => void;
  onFileRead: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function ImportModal({
  importOpen,
  csvText,
  importErr,
  importMode,
  fileRef,
  onCsvChange,
  onModeChange,
  onFileRead,
  onSubmit,
  onClose,
}: ImportModalProps) {
  if (!importOpen) return null;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">Import from CSV</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {[
              {
                value: "update",
                icon: "✅",
                title: "UPDATE (Recommended)",
                sub: "Matches by Client + Description.\nUpdates existing, inserts new — no duplicates",
              },
              {
                value: "replace",
                icon: "⚠️",
                title: "REPLACE (Danger)",
                sub: "Deletes ALL existing tasks first,\nthen imports only the CSV data",
              },
            ].map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: `2px solid ${importMode === opt.value ? "#2563eb" : "#e2e8f0"}`,
                  background: importMode === opt.value ? "#eff6ff" : "#fff",
                  transition: "all .15s",
                }}
              >
                <input
                  type="radio"
                  name="importMode"
                  value={opt.value}
                  checked={importMode === opt.value}
                  onChange={() => onModeChange(opt.value)}
                  style={{ marginTop: 3, accentColor: "#2563eb" }}
                />
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: importMode === opt.value ? "#2563eb" : "#1e293b",
                    }}
                  >
                    {opt.icon} {opt.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#64748b",
                      marginTop: 2,
                      lineHeight: 1.4,
                      whiteSpace: "pre-line",
                    }}
                  >
                    {opt.sub}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="import-note" style={{ marginBottom: 12 }}>
            Export Google Sheet as <strong>CSV</strong>. Columns:{" "}
            <code>S No</code>, <code>Clients</code>, <code>Category</code>,{" "}
            <code>Description</code>, <code>Target Date</code>,{" "}
            <code>Expected Date</code>, <code>Comp Date</code>,{" "}
            <code>Responsible</code>, <code>Recurrence</code>,{" "}
            <code>Remarks</code>
            <br />
            <span style={{ color: "#2563eb", fontSize: 11 }}>
              ℹ Status is auto-computed from dates. UPDATE mode matches by
              Client + Description — safe to import multiple months without
              duplicates.
            </span>
          </div>

          <div className="form-group full" style={{ marginBottom: 10 }}>
            <label>PASTE CSV</label>
            <textarea
              rows={7}
              placeholder="S No,Clients,Category,..."
              value={csvText}
              onChange={(e) => {
                onCsvChange(e.target.value);
              }}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              className="btn btn-secondary"
              onClick={() => fileRef.current?.click()}
            >
              📂 Choose file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={onFileRead}
            />
            <span style={{ fontSize: 12, color: "var(--txt3)" }}>
              or upload a .csv file
            </span>
          </div>
          {importErr && (
            <p style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>
              {importErr}
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={!csvText.trim()}
          >
            Import Tasks
          </button>
        </div>
      </div>
    </div>
  );
}
