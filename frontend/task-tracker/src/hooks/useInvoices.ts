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
    // Django serialises ``start_month`` / ``end_month`` (DateField) as
    // ``YYYY-MM-DD``. ``getApplicableMonths`` and the schedule grid append
    // ``"-01"`` to build a Date; without this slice it produces
    // ``"2024-04-01-01"`` → invalid date → no plan ever matches a month and
    // the schedule renders as empty cells.
    start_month: dto.start_month?.slice(0, 7) ?? dto.start_month,
    end_month: dto.end_month?.slice(0, 7) ?? dto.end_month,
    amount: toNum(dto.base_amount),
    invoice_day: dto.invoice_day,
    base_amount: toNum(dto.base_amount),
    serialNo: null,
    created_by: dto.created_by_detail?.uid ?? null,
    updated_at: dto.updated_at,
    project_status: dto.project_status,
    default_categories: (dto.default_categories ?? []).map((c) => ({
      category_uid: c.category_uid,
      category_name: c.category_name ?? "",
      color: c.color ?? "",
      contribution_pct: Number(c.contribution_pct),
    })),
    default_owners: (dto.default_owners ?? []).map((o) => ({
      user_uid: o.user_uid,
      user_name: o.user_name ?? "",
      contribution_pct: Number(o.contribution_pct),
    })),
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
    // Django serialises ``invoice_month`` (a DateField) as ``YYYY-MM-DD`` —
    // every UI comparison (``fyMonths.includes(...)``, group keys, ScheduleTab
    // cells) works in ``YYYY-MM``. Normalise here so the rest of the app can
    // compare strings directly without slicing on every site.
    invoice_month: dto.invoice_month.slice(0, 7),
    invoice_date: dto.invoice_date,
    amount: toNum(dto.amount),
    status: dto.status as InvoiceEntryStatusValue,
    invoice_number: dto.invoice_number || null,
    // Use the server's ``file_name`` (stored basename). The old derive-
    // from-URL trick fell apart once the URL became
    // ``/api/invoice_entries/<uid>/download/`` — splitting on "/" and
    // popping returned an empty string, and the whole modal stopped
    // showing the "has file" block for re-uploads / downloads.
    file_name: dto.file_name || null,
    file_url: dto.file_url || null,
    updated_at: dto.updated_at,
    project_status: dto.project_status,
    categories: (dto.categories ?? []).map((c) => ({
      category_uid: c.category_uid,
      category_name: c.category_name ?? "",
      color: c.color ?? "",
      contribution_pct: Number(c.contribution_pct),
    })),
    owners: (dto.owners ?? []).map((o) => ({
      user_uid: o.user_uid,
      user_name: o.user_name ?? "",
      contribution_pct: Number(o.contribution_pct),
    })),
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
