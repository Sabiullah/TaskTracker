import { useCallback, useEffect, useState } from "react";
import { listAuditEvents } from "@/lib/api";
import type { VisitReportAuditEventDto } from "@/types/api/internalReports";

export function useVisitAuditEvents(visitUid: string | null) {
  const [events, setEvents] = useState<VisitReportAuditEventDto[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!visitUid) return;
    setLoading(true);
    try {
      setEvents(await listAuditEvents(visitUid));
    } finally {
      setLoading(false);
    }
  }, [visitUid]);

  useEffect(() => { void reload(); }, [reload]);
  return { events, loading, reload };
}
