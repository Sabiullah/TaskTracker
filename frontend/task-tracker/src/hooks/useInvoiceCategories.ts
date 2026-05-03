import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { InvoiceCategory } from "@/types";
import type { InvoiceCategoryDto } from "@/types/api";

function dtoToCategory(dto: InvoiceCategoryDto): InvoiceCategory {
  return {
    id: dto.uid,
    name: dto.name,
    org_uid: dto.org,
    color: dto.color,
    is_active: dto.is_active,
    sort_order: dto.sort_order,
  };
}

export interface UseInvoiceCategoriesReturn {
  categories: InvoiceCategory[];
  loading: boolean;
  reload: () => Promise<void>;
}

export function useInvoiceCategories(): UseInvoiceCategoriesReturn {
  const [categories, setCategories] = useState<InvoiceCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<InvoiceCategoryDto[]>("/invoice_categories/");
    setCategories(dtos.map(dtoToCategory));
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

    const unsub = ws.subscribe<InvoiceCategoryDto>("invoice-categories", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToCategory(evt.record);
        setCategories((prev) =>
          prev.some((c) => c.id === next.id) ? prev : [...prev, next],
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToCategory(evt.record);
        setCategories((prev) => prev.map((c) => (c.id === next.id ? next : c)));
      } else if (evt.event === "DELETE" && evt.record) {
        const id = (evt.record as { uid?: string }).uid;
        if (id) setCategories((prev) => prev.filter((c) => c.id !== id));
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [reload]);

  return { categories, loading, reload };
}
