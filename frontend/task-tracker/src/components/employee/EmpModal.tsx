import {
  STATUS_LIST,
  GENDERS,
  BLOOD_GROUPS,
  MARITAL,
  inpS,
  lblS,
} from "@/utils/employee";
import { openAuthenticatedFile, ApiError } from "@/lib/api";

interface FormFieldProps {
  label: string;
  field: string;
  type?: string;
  form: Record<string, unknown>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  options?: string[];
  textarea?: boolean;
}

function FormField({
  label,
  field,
  type = "text",
  form,
  setForm,
  options,
  textarea,
}: FormFieldProps) {
  const onChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));
  return (
    <div>
      <label style={lblS}>{label}</label>
      {options ? (
        <select
          style={inpS}
          value={(form[field] as string) || ""}
          onChange={onChange}
        >
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : textarea ? (
        <textarea
          style={{ ...inpS, minHeight: 60, resize: "vertical" }}
          value={(form[field] as string) || ""}
          onChange={onChange}
        />
      ) : (
        <input
          type={type}
          style={inpS}
          value={(form[field] as string) || ""}
          onChange={onChange}
        />
      )}
    </div>
  );
}

export interface EmpModalProps {
  form: Record<string, unknown>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onSave: () => void;
  onFileSelect: (file: File | null) => void;
  onClose: () => void;
  saving: boolean;
  title: string;
  /** Org picker — only relevant for create mode of multi-org users.
   *  Backend's ``resolve_create_org`` requires an explicit ``org`` whenever
   *  the caller belongs to more than one org; without it the POST 400s
   *  with "you belong to multiple organisations". */
  orgOptions?: ReadonlyArray<{ uid: string; name: string }>;
  orgUid?: string;
  setOrgUid?: (uid: string) => void;
}

export default function EmpModal({
  form,
  setForm,
  onSave,
  onFileSelect,
  onClose,
  saving,
  title,
  orgOptions,
  orgUid,
  setOrgUid,
}: EmpModalProps) {
  const showOrgPicker =
    !!setOrgUid && (orgOptions?.length ?? 0) > 1;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(3px)",
      }}
      onClick={onClose}
    >
      <div
        className="dm-modal-card"
        style={{
          background: "#fff",
          borderRadius: 14,
          width: 720,
          maxWidth: "96vw",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 24px 14px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 1,
            borderRadius: "14px 14px 0 0",
          }}
        >
          <span
            style={{
              fontWeight: 800,
              fontSize: 18,
              fontFamily: "var(--font-heading)",
              color: "var(--txt)",
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          {showOrgPicker && (
            <div style={{ marginBottom: 16 }}>
              <label style={lblS}>Organisation *</label>
              <select
                style={inpS}
                value={orgUid ?? ""}
                onChange={(e) => setOrgUid?.(e.target.value)}
              >
                <option value="">— Select organisation —</option>
                {orgOptions?.map((o) => (
                  <option key={o.uid} value={o.uid}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#2563eb",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            👤 Basic Information
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <FormField
              label="Full Name *"
              field="employee_name"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Father's Name"
              field="father_name"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Date of Birth"
              field="date_of_birth"
              type="date"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Date of Joining"
              field="date_of_joining"
              type="date"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Gender"
              field="gender"
              form={form}
              setForm={setForm}
              options={GENDERS}
            />
            <FormField
              label="Blood Group"
              field="blood_group"
              form={form}
              setForm={setForm}
              options={BLOOD_GROUPS}
            />
            <FormField
              label="Marital Status"
              field="marital_status"
              form={form}
              setForm={setForm}
              options={MARITAL}
            />
            <FormField
              label="Status"
              field="status"
              form={form}
              setForm={setForm}
              options={STATUS_LIST}
            />
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#0891b2",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            📞 Contact Details
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <FormField
              label="Phone *"
              field="phone"
              type="tel"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Alt Phone"
              field="alt_phone"
              type="tel"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Email"
              field="email"
              type="email"
              form={form}
              setForm={setForm}
            />
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#7c3aed",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            🏠 Address
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <FormField
              label="Permanent Address"
              field="permanent_address"
              form={form}
              setForm={setForm}
              textarea
            />
            <FormField
              label="Current Address"
              field="current_address"
              form={form}
              setForm={setForm}
              textarea
            />
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#d97706",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            🪪 ID & Documents
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <FormField
              label="Aadhar Number"
              field="aadhar_number"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="PAN Number"
              field="pan_number"
              form={form}
              setForm={setForm}
            />
            <div>
              <label style={lblS}>Aadhar / Address Proof Upload</label>
              {(() => {
                const url = (form.address_proof_url as string) || "";
                const isRealUrl = url.startsWith("/") || url.startsWith("http");
                // A locally-selected filename (no slash, not a URL) should
                // NOT be wired up as an <a href> — the browser would turn
                // "proof.pdf" into "/proof.pdf" and the React router would
                // swallow the route. Show it as pending text instead.
                if (isRealUrl) {
                  return (
                    <div
                      style={{
                        marginBottom: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await openAuthenticatedFile(url);
                          } catch (err) {
                            const msg =
                              err instanceof ApiError
                                ? err.message
                                : String(err);
                            alert(`Could not open file: ${msg}`);
                          }
                        }}
                        style={{
                          fontSize: 12,
                          color: "#2563eb",
                          fontWeight: 600,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textDecoration: "underline",
                          padding: 0,
                        }}
                      >
                        📎 View uploaded file
                      </button>
                      <button
                        onClick={() =>
                          setForm((f) => ({ ...f, address_proof_url: "" }))
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: "#dc2626",
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        ✕ Remove
                      </button>
                    </div>
                  );
                }
                if (url) {
                  return (
                    <div
                      style={{
                        marginBottom: 6,
                        fontSize: 12,
                        color: "#64748b",
                      }}
                    >
                      📎 Pending upload: <strong>{url}</strong> — save the
                      form to upload.
                    </div>
                  );
                }
                return null;
              })()}
              <input
                type="file"
                accept="image/*,.pdf"
                style={{ fontSize: 12, width: "100%" }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  onFileSelect(file);
                  if (file) {
                    // Show the local filename as pending-upload text — the
                    // viewer downstream treats plain filenames as "not a
                    // URL" and renders them as plain text rather than an
                    // <a href>, which would 404 on the SPA route.
                    setForm((f) => ({
                      ...f,
                      address_proof_url: file.name,
                    }));
                  }
                }}
              />
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                Accepts images or PDF (Aadhar, Passport, Voter ID, etc.)
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#dc2626",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            🆘 Emergency Contact
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <FormField
              label="Name"
              field="emergency_contact_name"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Phone"
              field="emergency_contact_phone"
              type="tel"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Relation"
              field="emergency_contact_relation"
              form={form}
              setForm={setForm}
            />
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#16a34a",
              marginBottom: 10,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 6,
            }}
          >
            📋 Communication Reference
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <FormField
              label="Reference Name"
              field="reference_name"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Contact"
              field="reference_contact"
              type="tel"
              form={form}
              setForm={setForm}
            />
            <FormField
              label="Relation"
              field="reference_relation"
              form={form}
              setForm={setForm}
            />
          </div>
        </div>

        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            position: "sticky",
            bottom: 0,
            background: "#fff",
            borderRadius: "0 0 14px 14px",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px",
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              padding: "8px 18px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Save Employee"}
          </button>
        </div>
      </div>
    </div>
  );
}
