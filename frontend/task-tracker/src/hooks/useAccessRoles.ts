import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import type { ID } from "@/types";
import type { AccessRoleDto } from "@/types/api";

export interface UseAccessRolesReturn {
  hasInvoiceAccess: boolean;
  hasNoticeAccess: boolean;
  hasMastersAccess: boolean;
  hasAttendanceAccess: boolean;
  hasEmployeeAccess: boolean;
  hasLeadsAccess: boolean;
  loading: boolean;
}

export function useAccessRoles(
  userId: ID | undefined,
  isAdmin: boolean,
): UseAccessRolesReturn {
  const [invoice, setInvoice] = useState<AccessRoleDto[]>([]);
  const [notice, setNotice] = useState<AccessRoleDto[]>([]);
  const [masters, setMasters] = useState<AccessRoleDto[]>([]);
  const [attendance, setAttendance] = useState<AccessRoleDto[]>([]);
  const [employee, setEmployee] = useState<AccessRoleDto[]>([]);
  const [leads, setLeads] = useState<AccessRoleDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [inv, not, mas, att, emp, lds] = await Promise.all([
          apiGet<AccessRoleDto[]>("/invoice_access/"),
          apiGet<AccessRoleDto[]>("/notice_access/"),
          apiGet<AccessRoleDto[]>("/masters_access/"),
          apiGet<AccessRoleDto[]>("/attendance_access/"),
          apiGet<AccessRoleDto[]>("/employee_access/"),
          apiGet<AccessRoleDto[]>("/leads_access/"),
        ]);
        if (cancelled) return;
        setInvoice(inv);
        setNotice(not);
        setMasters(mas);
        setAttendance(att);
        setEmployee(emp);
        setLeads(lds);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const check = useCallback(
    (rows: AccessRoleDto[]): boolean =>
      isAdmin ||
      rows.some((r) => r.user_id === userId && r.enabled),
    [isAdmin, userId],
  );

  const hasInvoiceAccess = useMemo(() => check(invoice), [check, invoice]);
  const hasNoticeAccess = useMemo(() => check(notice), [check, notice]);
  const hasMastersAccess = useMemo(() => check(masters), [check, masters]);
  const hasAttendanceAccess = useMemo(
    () => check(attendance),
    [check, attendance],
  );
  const hasEmployeeAccess = useMemo(() => check(employee), [check, employee]);
  const hasLeadsAccess = useMemo(() => check(leads), [check, leads]);

  return {
    hasInvoiceAccess,
    hasNoticeAccess,
    hasMastersAccess,
    hasAttendanceAccess,
    hasEmployeeAccess,
    hasLeadsAccess,
    loading,
  };
}
