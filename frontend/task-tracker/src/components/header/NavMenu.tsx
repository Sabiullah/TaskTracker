import { useState, useMemo, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { loadTabOrder, saveTabOrder } from "@/utils/header";
import { SortableTab } from "./sortableTable";
import type { NavTab } from "@/types";

export interface NavMenuProps {
  view: string;
  onViewChange: (view: string) => void;
  hasInvoiceAccess: boolean;
  hasNoticeAccess: boolean;
  hasMastersAccess: boolean;
  canAccessLeads: boolean;
  canAccessClients: boolean;
  isAdmin: boolean;
  icons: Record<string, React.ReactNode>;
  clientsBadgeCount?: number;
  leadsBadgeCount?: number;
  kaizenBadgeCount?: number;
  paceBadgeCount?: number;
  invoiceBadgeCount?: number;
}

export default function NavMenu({
  view,
  onViewChange,
  hasInvoiceAccess,
  hasNoticeAccess,
  hasMastersAccess,
  canAccessLeads,
  canAccessClients,
  isAdmin,
  icons,
  clientsBadgeCount,
  leadsBadgeCount,
  kaizenBadgeCount,
  paceBadgeCount,
  invoiceBadgeCount,
}: NavMenuProps) {
  const [tabOrder, setTabOrder] = useState(() => loadTabOrder());
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
  );

  const NAV_TABS = useMemo(() => {
    const NAV_TABS_RAW: NavTab[] = [
      { id: "board", label: "Board", icon: icons.board },
      { id: "dashboard", label: "Dashboard", icon: icons.dashboard },
      { id: "calendar", label: "Calendar", icon: icons.calendar },
      { id: "worklog", label: "Work Log", icon: icons.worklog },
      ...(canAccessLeads
        ? [{ id: "leads", label: "Leads", icon: icons.leads }]
        : []),
      ...(canAccessClients
        ? [{ id: "clients", label: "Clients", icon: icons.clients }]
        : []),
      ...(hasNoticeAccess
        ? [{ id: "notice", label: "Notice", icon: icons.notice }]
        : []),
      ...(hasInvoiceAccess
        ? [{ id: "invoice", label: "Invoice", icon: icons.invoice }]
        : []),
      { id: "conveyance", label: "Conveyance", icon: icons.conveyance },
      ...(hasMastersAccess
        ? [{ id: "masters", label: "Masters", icon: icons.masters }]
        : []),
      { id: "holidays", label: "Holidays", icon: icons.holidays },
      { id: "employee", label: "Employee", icon: icons.employee },
      { id: "pace", label: "PACE", icon: icons.pacecheck },
      ...(isAdmin
        ? [{ id: "growthplan", label: "Growth Plan", icon: icons.growthplan }]
        : []),
      { id: "kaizen", label: "Kaizen", icon: icons.kaizen },
      ...(isAdmin ? [{ id: "users", label: "Users", icon: icons.users }] : []),
    ];
    if (!tabOrder) return NAV_TABS_RAW;
    const tabMap = new Map(NAV_TABS_RAW.map((t) => [t.id, t]));
    const ordered = tabOrder
      .filter((id) => tabMap.has(id))
      .map((id) => tabMap.get(id)!);
    const orderedIds = new Set(tabOrder);
    NAV_TABS_RAW.forEach((t) => {
      if (!orderedIds.has(t.id)) ordered.push(t);
    });
    return ordered;
  }, [tabOrder, icons, hasNoticeAccess, hasInvoiceAccess, hasMastersAccess, canAccessLeads, canAccessClients, isAdmin]);

  const handleTabDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      const ids = NAV_TABS.map((t) => t.id);
      const oldIdx = ids.indexOf(activeId);
      const newIdx = ids.indexOf(overId);
      if (oldIdx < 0 || newIdx < 0) return;
      const newOrder = arrayMove(ids, oldIdx, newIdx);
      setTabOrder(newOrder);
      saveTabOrder(newOrder);
    },
    [NAV_TABS],
  );

  const resetTabOrder = useCallback(() => {
    setTabOrder(null);
    try {
      localStorage.removeItem("tt_tab_order");
    } catch {}
  }, []);

  return (
    <DndContext
      sensors={tabSensors}
      collisionDetection={closestCenter}
      onDragEnd={handleTabDragEnd}
    >
      <SortableContext
        items={NAV_TABS.map((t) => t.id)}
        strategy={horizontalListSortingStrategy}
      >
        <nav className="nav-tabs">
          {NAV_TABS.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={view === tab.id}
              onClick={() => onViewChange(tab.id)}
              badge={
                tab.id === "clients"
                  ? clientsBadgeCount
                  : tab.id === "leads"
                    ? leadsBadgeCount
                    : tab.id === "kaizen"
                      ? kaizenBadgeCount
                      : tab.id === "pace"
                        ? paceBadgeCount
                        : tab.id === "invoice"
                          ? invoiceBadgeCount
                          : undefined
              }
            />
          ))}
          {tabOrder && (
            <button
              className="nav-tab-reset"
              onClick={resetTabOrder}
              title="Reset tab order to default"
            >
              ↺
            </button>
          )}
        </nav>
      </SortableContext>
    </DndContext>
  );
}
