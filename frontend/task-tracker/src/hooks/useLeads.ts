import { useCallback, useEffect, useState } from "react";
import { apiGet, dtoToLead, ws } from "@/lib/api";
import type { Lead, LeadStatusRecord } from "@/types";
import type { LeadDto, LeadStatusDto } from "@/types/api";

function dtoToLeadStatusRecord(dto: LeadStatusDto): LeadStatusRecord {
  return {
    id: String(dto.id),
    name: dto.name,
    color: dto.color,
    sort_order: dto.sort_order,
  };
}

export interface UseLeadsReturn {
  leads: Lead[];
  statuses: LeadStatusRecord[];
  loading: boolean;
  reload: () => Promise<void>;
  reloadStatuses: () => Promise<void>;
}

export function useLeads(): UseLeadsReturn {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [statuses, setStatuses] = useState<LeadStatusRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    // Django applies admin/manager/employee filtering server-side.
    const dtos = await apiGet<LeadDto[]>("/leads/");
    setLeads(dtos.map(dtoToLead));
  }, []);

  const reloadStatuses = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<LeadStatusDto[]>("/lead_statuses/");
    setStatuses(dtos.map(dtoToLeadStatusRecord));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([reload(), reloadStatuses()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubLeads = ws.subscribe<LeadDto>("leads", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToLead(evt.record);
        setLeads((prev) =>
          prev.some((l) => l.id === next.id) ? prev : [...prev, next],
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToLead(evt.record);
        setLeads((prev) => prev.map((l) => (l.id === next.id ? next : l)));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedId = (evt.record as { uid?: string }).uid;
        if (deletedId)
          setLeads((prev) => prev.filter((l) => l.id !== deletedId));
      }
    });

    const unsubStatuses = ws.subscribe<LeadStatusDto>(
      "lead-statuses",
      (evt) => {
        if (evt.event === "INSERT" && evt.record) {
          const next = dtoToLeadStatusRecord(evt.record);
          setStatuses((prev) =>
            prev.some((s) => s.id === next.id)
              ? prev
              : [...prev, next].sort(
                  (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
                ),
          );
        } else if (evt.event === "UPDATE" && evt.record) {
          const next = dtoToLeadStatusRecord(evt.record);
          setStatuses((prev) =>
            prev.map((s) => (s.id === next.id ? next : s)),
          );
        } else if (evt.event === "DELETE" && evt.record) {
          const deletedId = String((evt.record as { id?: number }).id ?? "");
          if (deletedId)
            setStatuses((prev) => prev.filter((s) => s.id !== deletedId));
        }
      },
    );

    return () => {
      cancelled = true;
      unsubLeads();
      unsubStatuses();
    };
  }, [reload, reloadStatuses]);

  return { leads, statuses, loading, reload, reloadStatuses };
}
