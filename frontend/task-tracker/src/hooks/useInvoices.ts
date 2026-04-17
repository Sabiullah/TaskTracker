import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { InvoiceEntry, InvoicePlan } from "@/types";
import type {
  InvoiceEntryDto,
  InvoiceEntryStatusValue,
  InvoicePlanDto,
} from "@/types/api";

// ─── DTO → Domain mappers ────────────────────────────────────────────────────

function dtoToInvoicePlan(dto: InvoicePlanDto): InvoicePlan {
  const toNum = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: dto.uid,
    client_id: dto.client,
    client_name: dto.client_detail?.name ?? "",
    job_description: dto.job_description,
    periodicity: dto.periodicity,
    start_month: dto.start_month,
    end_month: dto.end_month,
    amount: toNum(dto.base_amount),
    invoice_day: dto.invoice_day,
    base_amount: toNum(dto.base_amount),
    serialNo: null,
    created_by: dto.created_by_detail?.uid ?? null,
    updated_at: dto.updated_at,
  };
}

function dtoToInvoiceEntry(dto: InvoiceEntryDto): InvoiceEntry {
  const toNum = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  return {
    id: dto.uid,
    plan_id: "", // not returned directly; callers correlate via invoice_month + client via plan list
    client_name: "", // filled by UI via plan lookup
    invoice_month: dto.invoice_month,
    invoice_date: dto.invoice_date,
    amount: toNum(dto.amount),
    status: dto.status as InvoiceEntryStatusValue,
    invoice_number: dto.invoice_number || null,
    file_name: dto.file_url ? dto.file_url.split("/").pop() || null : null,
    updated_at: dto.updated_at,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseInvoicesReturn {
  plans: InvoicePlan[];
  entries: InvoiceEntry[];
  loading: boolean;
  reload: () => Promise<void>;
}

export function useInvoices(): UseInvoicesReturn {
  const [plans, setPlans] = useState<InvoicePlan[]>([]);
  const [entries, setEntries] = useState<InvoiceEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const [planDtos, entryDtos] = await Promise.all([
      apiGet<InvoicePlanDto[]>("/invoice_plans/"),
      apiGet<InvoiceEntryDto[]>("/invoice_entries/"),
    ]);
    const mappedPlans = planDtos.map(dtoToInvoicePlan);
    // Build entry_uid → plan correlation map from the plan list's embedded entries.
    const entryToPlan: Record<string, { planId: string; clientName: string }> = {};
    planDtos.forEach((p) => {
      const clientName = p.client_detail?.name ?? "";
      p.entries.forEach((emb) => {
        entryToPlan[emb.uid] = { planId: p.uid, clientName };
      });
    });
    setPlans(mappedPlans);
    setEntries(
      entryDtos.map((dto) => {
        const base = dtoToInvoiceEntry(dto);
        const link = entryToPlan[dto.uid];
        return link
          ? { ...base, plan_id: link.planId, client_name: link.clientName }
          : base;
      }),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubPlans = ws.subscribe<InvoicePlanDto>("invoice-plans", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToInvoicePlan(evt.record);
        setPlans((prev) =>
          prev.some((p) => p.id === next.id) ? prev : [...prev, next],
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToInvoicePlan(evt.record);
        setPlans((prev) => prev.map((p) => (p.id === next.id ? next : p)));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedId = (evt.record as { uid?: string }).uid;
        if (deletedId)
          setPlans((prev) => prev.filter((p) => p.id !== deletedId));
      }
    });

    const unsubEntries = ws.subscribe<InvoiceEntryDto>(
      "invoice-entries",
      (evt) => {
        if (evt.event === "INSERT" && evt.record) {
          const next = dtoToInvoiceEntry(evt.record);
          setEntries((prev) =>
            prev.some((e) => e.id === next.id) ? prev : [...prev, next],
          );
        } else if (evt.event === "UPDATE" && evt.record) {
          const next = dtoToInvoiceEntry(evt.record);
          setEntries((prev) =>
            prev.map((e) => (e.id === next.id ? next : e)),
          );
        } else if (evt.event === "DELETE" && evt.record) {
          const deletedId = (evt.record as { uid?: string }).uid;
          if (deletedId)
            setEntries((prev) => prev.filter((e) => e.id !== deletedId));
        }
      },
    );

    return () => {
      cancelled = true;
      unsubPlans();
      unsubEntries();
    };
  }, [reload]);

  return { plans, entries, loading, reload };
}
