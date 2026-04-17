import { useCallback, useEffect, useState } from "react";
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
    employee_name: dto.employee_name,
    father_name: dto.father_name || null,
    phone: dto.phone || null,
    alt_phone: dto.alt_phone || null,
    email: dto.email || null,
    designation:
      dto.salary_records[0]?.designation ?? null,
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

function employeeFormToCreate(form: Partial<Employee>): EmployeeCreate {
  return {
    employee_name: (form.employee_name ?? "").trim(),
    status: (form.status as EmployeeCreate["status"]) || "Active",
    date_of_birth: form.date_of_birth ?? undefined,
    gender: (form.gender as EmployeeCreate["gender"]) ?? undefined,
    blood_group: form.blood_group ?? undefined,
    marital_status:
      (form.marital_status as EmployeeCreate["marital_status"]) ?? undefined,
    father_name: form.father_name ?? undefined,
    phone: form.phone ?? undefined,
    alt_phone: form.alt_phone ?? undefined,
    email: form.email ?? undefined,
    permanent_address: form.permanent_address ?? undefined,
    current_address: form.current_address ?? undefined,
    aadhar_number: form.aadhar_number ?? undefined,
    pan_number: form.pan_number ?? undefined,
    bank_name: form.bank_name ?? undefined,
    bank_account: form.bank_account ?? undefined,
    ifsc_code: form.ifsc_code ?? undefined,
    emergency_contact_name: form.emergency_contact_name ?? undefined,
    emergency_contact_phone: form.emergency_contact_phone ?? undefined,
    emergency_contact_relation: form.emergency_contact_relation ?? undefined,
    reference_name: form.reference_name ?? undefined,
    reference_contact: form.reference_contact ?? undefined,
    reference_relation: form.reference_relation ?? undefined,
  };
}

function salaryFormToCreate(form: Partial<SalaryRecord>): EmployeeSalaryCreate {
  const num = (n: number | null | undefined): string =>
    n !== null && n !== undefined && Number.isFinite(n)
      ? n.toFixed(2)
      : "0.00";
  return {
    employee: form.employee_id ?? "",
    designation: form.designation ?? undefined,
    department: form.department ?? undefined,
    fixed_salary: num(form.fixed_salary),
    basic_salary: num(form.basic_salary),
    hra: num(form.hra),
    da: num(form.da),
    other_allowances: num(form.other_allowances),
    pf_number: form.pf_number ?? undefined,
    esi_number: form.esi_number ?? undefined,
    uan_number: form.uan_number ?? undefined,
    effective_from: form.effective_from ?? undefined,
    remarks: form.remarks ?? undefined,
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
    ): Promise<boolean> => {
      if (!form.employee_name?.trim()) {
        alert("Employee name is required");
        return false;
      }
      try {
        const payload = employeeFormToCreate(form);
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
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
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

  return {
    employees,
    salaries,
    loading,
    reloadEmployees,
    reloadSalaries,
    saveEmployee,
    deleteEmployee,
    saveSalary,
    deleteSalary,
  };
}
