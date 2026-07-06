import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPatchForm,
  apiPost,
  apiPostForm,
  ws,
} from "@/lib/api";
import type { Employee, ID, SalaryRecord } from "@/types";
import type {
  EmployeeCreate,
  EmployeeDto,
  EmployeeSalaryCreate,
  EmployeeSalaryDto,
  EmployeeSalaryUpdate,
  EmployeeUpdate,
} from "@/types/api";

// ─── DTO → Domain mappers ────────────────────────────────────────────────────

function dtoToEmployee(dto: EmployeeDto): Employee {
  return {
    id: dto.uid,
    org: dto.org_uid ?? null,
    employee_name: dto.employee_name,
    father_name: dto.father_name || null,
    phone: dto.phone || null,
    alt_phone: dto.alt_phone || null,
    email: dto.email || null,
    designation:
      dto.salary_records[0]?.designation ?? null,
    designation_uid: dto.designation ?? null,
    designation_name: dto.designation_detail?.name ?? null,
    department: dto.salary_records[0]?.department ?? null,
    status: dto.status,
    gender: dto.gender || null,
    marital_status: dto.marital_status || null,
    date_of_birth: dto.date_of_birth,
    blood_group: dto.blood_group || null,
    permanent_address: dto.permanent_address || null,
    current_address: dto.current_address || null,
    aadhar_number: dto.aadhar_number || null,
    pan_number: dto.pan_number || null,
    bank_name: dto.bank_name || null,
    bank_account: dto.bank_account || null,
    ifsc_code: dto.ifsc_code || null,
    address_proof_url: dto.address_proof_url,
    emergency_contact_name: dto.emergency_contact_name || null,
    emergency_contact_phone: dto.emergency_contact_phone || null,
    emergency_contact_relation: dto.emergency_contact_relation || null,
    reference_name: dto.reference_name || null,
    reference_contact: dto.reference_contact || null,
    reference_relation: dto.reference_relation || null,
    date_of_joining: dto.date_of_joining,
    created_by: null,
    created_at: dto.created_at,
    updated_at: dto.updated_at,
  };
}

function dtoToSalaryRecord(dto: EmployeeSalaryDto): SalaryRecord {
  const toNum = (s: string | null | undefined): number | null => {
    if (s === null || s === undefined || s === "") return null;
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: dto.uid,
    employee_id: dto.employee,
    employee_name: "", // filled from matching employee at UI layer
    designation: dto.designation || null,
    department: dto.department || null,
    date_of_joining: null,
    fixed_salary: toNum(dto.fixed_salary),
    basic_salary: toNum(dto.basic_salary),
    hra: toNum(dto.hra),
    da: toNum(dto.da),
    other_allowances: toNum(dto.other_allowances),
    pf_number: dto.pf_number || null,
    esi_number: dto.esi_number || null,
    uan_number: dto.uan_number || null,
    effective_from: dto.effective_from,
    remarks: dto.remarks || null,
    updated_at: dto.updated_at,
    created_at: dto.created_at,
  };
}

// ─── Form → Create payload helpers ───────────────────────────────────────────

// Empty strings are NOT the same as null/undefined for Django: DateField
// and choice CharFields reject ``""`` with a 400, so strip them here.
// Keeps the write path PATCH-safe (absent key = "don't touch the field")
// instead of "set it to blank".
function blank<T extends string | null | undefined>(v: T): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

// Strip non-digit characters (spaces, dashes) before sending an Aadhaar
// number. Users routinely paste the pretty-printed "1234 5678 9012" form
// but Django's ``AADHAR_VALIDATOR`` requires exactly 12 digits with no
// separators.
function digitsOnly(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/\D+/g, "");
  return s.length ? s : undefined;
}

// PAN is a fixed ABCDE1234F pattern — backend regex is anchored and
// case-sensitive uppercase, so we normalise client-side.
function panOnly(v: string | null | undefined): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/\s+/g, "").toUpperCase();
  return s.length ? s : undefined;
}

function employeeFormToCreate(form: Partial<Employee>): EmployeeCreate {
  return {
    employee_name: (form.employee_name ?? "").trim(),
    status: (form.status as EmployeeCreate["status"]) || "Active",
    date_of_birth: blank(form.date_of_birth),
    date_of_joining: blank(form.date_of_joining),
    gender: blank(form.gender) as EmployeeCreate["gender"] | undefined,
    blood_group: blank(form.blood_group),
    marital_status: blank(
      form.marital_status,
    ) as EmployeeCreate["marital_status"] | undefined,
    father_name: blank(form.father_name),
    phone: blank(form.phone),
    alt_phone: blank(form.alt_phone),
    email: blank(form.email),
    permanent_address: blank(form.permanent_address),
    current_address: blank(form.current_address),
    aadhar_number: digitsOnly(form.aadhar_number),
    pan_number: panOnly(form.pan_number),
    bank_name: blank(form.bank_name),
    bank_account: blank(form.bank_account),
    ifsc_code: blank(form.ifsc_code),
    emergency_contact_name: blank(form.emergency_contact_name),
    emergency_contact_phone: blank(form.emergency_contact_phone),
    emergency_contact_relation: blank(form.emergency_contact_relation),
    reference_name: blank(form.reference_name),
    reference_contact: blank(form.reference_contact),
    reference_relation: blank(form.reference_relation),
    designation: form.designation_uid || null,
  };
}

function salaryFormToCreate(form: Partial<SalaryRecord>): EmployeeSalaryCreate {
  // Numeric inputs: a blank field should stay null in the DB, not be
  // coerced to "0.00" — otherwise the salary list shows ₹0 for fields the
  // user deliberately left empty.
  const num = (n: number | string | null | undefined): string | undefined => {
    if (n === null || n === undefined) return undefined;
    if (typeof n === "string") {
      const s = n.trim();
      if (!s) return undefined;
      const parsed = Number.parseFloat(s);
      return Number.isFinite(parsed) ? parsed.toFixed(2) : undefined;
    }
    return Number.isFinite(n) ? n.toFixed(2) : undefined;
  };
  return {
    employee: form.employee_id ?? "",
    designation: blank(form.designation),
    department: blank(form.department),
    fixed_salary: num(form.fixed_salary),
    basic_salary: num(form.basic_salary),
    hra: num(form.hra),
    da: num(form.da),
    other_allowances: num(form.other_allowances),
    pf_number: blank(form.pf_number),
    esi_number: blank(form.esi_number),
    uan_number: blank(form.uan_number),
    effective_from: blank(form.effective_from),
    remarks: blank(form.remarks),
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseEmployeesReturn {
  employees: Employee[];
  salaries: SalaryRecord[];
  loading: boolean;
  reloadEmployees: () => Promise<void>;
  reloadSalaries: () => Promise<void>;
  saveEmployee: (
    form: Partial<Employee>,
    mode: "add" | "edit",
    addressProofFile?: File | null,
    orgUid?: string,
  ) => Promise<boolean>;
  deleteEmployee: (id: ID) => Promise<void>;
  saveSalary: (
    form: Partial<SalaryRecord>,
    mode: "add" | "edit",
    empList: Employee[],
  ) => Promise<boolean>;
  deleteSalary: (id: ID) => Promise<void>;
}

export function useEmployees(): UseEmployeesReturn {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadEmployees = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<EmployeeDto[]>("/employees/");
    setEmployees(
      dtos
        .map(dtoToEmployee)
        .sort((a, b) => a.employee_name.localeCompare(b.employee_name)),
    );
  }, []);

  const reloadSalaries = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<EmployeeSalaryDto[]>("/employee_salary/");
    setSalaries(dtos.map(dtoToSalaryRecord));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([reloadEmployees(), reloadSalaries()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubEmp = ws.subscribe<EmployeeDto>("employees", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToEmployee(evt.record);
        setEmployees((prev) =>
          prev.some((e) => e.id === next.id)
            ? prev
            : [...prev, next].sort((a, b) =>
                a.employee_name.localeCompare(b.employee_name),
              ),
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToEmployee(evt.record);
        setEmployees((prev) =>
          prev.map((e) => (e.id === next.id ? next : e)),
        );
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedId = (evt.record as { uid?: string }).uid;
        if (deletedId)
          setEmployees((prev) => prev.filter((e) => e.id !== deletedId));
      }
    });

    const unsubSal = ws.subscribe<EmployeeSalaryDto>(
      "employee-salary",
      (evt) => {
        if (evt.event === "INSERT" && evt.record) {
          const next = dtoToSalaryRecord(evt.record);
          setSalaries((prev) =>
            prev.some((s) => s.id === next.id) ? prev : [...prev, next],
          );
        } else if (evt.event === "UPDATE" && evt.record) {
          const next = dtoToSalaryRecord(evt.record);
          setSalaries((prev) =>
            prev.map((s) => (s.id === next.id ? next : s)),
          );
        } else if (evt.event === "DELETE" && evt.record) {
          const deletedId = (evt.record as { uid?: string }).uid;
          if (deletedId)
            setSalaries((prev) => prev.filter((s) => s.id !== deletedId));
        }
      },
    );

    return () => {
      cancelled = true;
      unsubEmp();
      unsubSal();
    };
  }, [reloadEmployees, reloadSalaries]);

  const saveEmployee = useCallback(
    async (
      form: Partial<Employee>,
      mode: "add" | "edit",
      addressProofFile?: File | null,
      orgUid?: string,
    ): Promise<boolean> => {
      if (!form.employee_name?.trim()) {
        alert("Employee name is required");
        return false;
      }
      try {
        // Only attach ``org`` on create. Edit PATCH must not move a row
        // between orgs — backend would reject and it would silently look
        // like the edit "didn't take" if the picker was wrong.
        const orgPart =
          mode === "add" && orgUid ? { org: orgUid } : {};
        const payload: EmployeeCreate = {
          ...employeeFormToCreate(form),
          ...orgPart,
        };
        let saved: EmployeeDto;
        if (addressProofFile) {
          const fd = new FormData();
          for (const [k, v] of Object.entries(payload)) {
            if (v !== undefined) fd.append(k, String(v));
          }
          fd.append("address_proof", addressProofFile);
          if (mode === "edit" && form.id) {
            saved = await apiPatchForm<EmployeeDto>(
              `/employees/${form.id}/`,
              fd,
            );
          } else {
            saved = await apiPostForm<EmployeeDto>("/employees/", fd);
          }
        } else {
          if (mode === "edit" && form.id) {
            const body: EmployeeUpdate = payload;
            saved = await apiPatch<EmployeeDto>(
              `/employees/${form.id}/`,
              body,
            );
          } else {
            saved = await apiPost<EmployeeDto>("/employees/", payload);
          }
        }
        const next = dtoToEmployee(saved);
        setEmployees((prev) => {
          const exists = prev.some((e) => e.id === next.id);
          const updated = exists
            ? prev.map((e) => (e.id === next.id ? next : e))
            : [...prev, next];
          return updated.sort((a, b) =>
            a.employee_name.localeCompare(b.employee_name),
          );
        });
        return true;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
        return false;
      }
    },
    [],
  );

  const deleteEmployee = useCallback(async (id: ID): Promise<void> => {
    if (!window.confirm("Delete this employee record?")) return;
    try {
      await apiDelete(`/employees/${id}/`);
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      // Server cascades deletion of salary records. Refresh local cache.
      setSalaries((prev) => prev.filter((s) => s.employee_id !== id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  }, []);

  const saveSalary = useCallback(
    async (
      form: Partial<SalaryRecord>,
      mode: "add" | "edit",
      empList: Employee[],
    ): Promise<boolean> => {
      if (!form.employee_id) {
        alert("Select an employee");
        return false;
      }
      if (!blank(form.effective_from)) {
        alert("Effective From is required");
        return false;
      }
      try {
        const payload = salaryFormToCreate(form);
        let saved: EmployeeSalaryDto;
        if (mode === "edit" && form.id) {
          const body: EmployeeSalaryUpdate = payload;
          saved = await apiPatch<EmployeeSalaryDto>(
            `/employee_salary/${form.id}/`,
            body,
          );
        } else {
          saved = await apiPost<EmployeeSalaryDto>(
            "/employee_salary/",
            payload,
          );
        }
        const next = dtoToSalaryRecord(saved);
        const emp = empList.find((e) => e.id === next.employee_id);
        next.employee_name = emp?.employee_name ?? "";
        setSalaries((prev) => {
          const exists = prev.some((s) => s.id === next.id);
          return exists
            ? prev.map((s) => (s.id === next.id ? next : s))
            : [...prev, next];
        });
        return true;
      } catch (err) {
        // DRF returns field-level errors as ``{field: ["msg", ...]}`` —
        // ``ApiError.message`` falls back to ``HTTP 400 Bad Request`` in
        // that case, so surface ``err.body`` to make the failure
        // actionable (e.g. "effective_from: salary_unique_employee...").
        let detail = "";
        if (err instanceof ApiError) {
          if (err.body && typeof err.body === "object") {
            detail = Object.entries(err.body as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
              .join("\n");
          }
          alert(`Save failed: ${err.message}${detail ? `\n${detail}` : ""}`);
        } else {
          alert(`Save failed: ${String(err)}`);
        }
        return false;
      }
    },
    [],
  );

  const deleteSalary = useCallback(async (id: ID): Promise<void> => {
    if (!window.confirm("Delete this salary record?")) return;
    try {
      await apiDelete(`/employee_salary/${id}/`);
      setSalaries((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  }, []);

  // ``EmployeeSalaryDto`` only carries ``employee`` (the employee uid) —
  // not the name or DOJ. The salary sub-tab wants both, so join against
  // the loaded employees list here. Falls back to empty/null when an
  // employee hasn't loaded yet (first paint / after a WS insert on a new
  // employee before the employees fetch catches up).
  const enrichedSalaries = useMemo(() => {
    const empById = new Map(employees.map((e) => [e.id, e]));
    return salaries.map((s) => {
      const emp = empById.get(s.employee_id);
      if (!emp) return s;
      return {
        ...s,
        employee_name: emp.employee_name,
        date_of_joining: emp.date_of_joining,
      };
    });
  }, [salaries, employees]);

  return {
    employees,
    salaries: enrichedSalaries,
    loading,
    reloadEmployees,
    reloadSalaries,
    saveEmployee,
    deleteEmployee,
    saveSalary,
    deleteSalary,
  };
}
