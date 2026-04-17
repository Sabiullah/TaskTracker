import { lblS } from "@/utils/tableStyles";
import { inpS } from "@/utils/paceGoals";
import type { GoalForm } from "@/types/paceGoals";

interface GoalFormFieldProps {
  label: string;
  field: keyof GoalForm;
  form: GoalForm;
  setForm: (updater: (prev: GoalForm) => GoalForm) => void;
  type?: string;
  options?: readonly string[];
  textarea?: boolean;
}

export function GoalFormField({
  label,
  field,
  form,
  setForm,
  type = "text",
  options,
  textarea,
}: GoalFormFieldProps) {
  const onChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ): void =>
    setForm((f) => ({ ...f, [field]: e.target.value }) as GoalForm);
  const value = String(form[field] ?? "");
  return (
    <div>
      <label style={lblS}>{label}</label>
      {options ? (
        <select style={inpS} value={value} onChange={onChange}>
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : textarea ? (
        <textarea
          style={{
            ...inpS,
            minHeight: 50,
            resize: "vertical",
            lineHeight: 1.5,
          }}
          value={value}
          onChange={onChange}
          onInput={(e) => {
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = Math.max(50, ta.scrollHeight) + "px";
          }}
          placeholder="Shift+Enter for new line…"
        />
      ) : (
        <input type={type} style={inpS} value={value} onChange={onChange} />
      )}
    </div>
  );
}
