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
  /** Per-menu visibility keyed by catalog code (true => show the tab). */
  navVisible: Record<string, boolean>;
  icons: Record<string, React.ReactNode>;
  clientsBadgeCount?: number;
  leadsBadgeCount?: number;
  kaizenBadgeCount?: number;
  paceBadgeCount?: number;
  invoiceBadgeCount?: number;
  conveyanceBadgeCount?: number;
}

export default function NavMenu({
  view,
  onViewChange,
  navVisible,
  icons,
  clientsBadgeCount,
  leadsBadgeCount,
  kaizenBadgeCount,
  paceBadgeCount,
  invoiceBadgeCount,
  conveyanceBadgeCount,
}: NavMenuProps) {
  const [tabOrder, setTabOrder] = useState(() => loadTabOrder());
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
  );

  const NAV_TABS = useMemo(() => {
    const show = (code: string) => navVisible[code] ?? false;
    const NAV_TABS_RAW: NavTab[] = [
      ...(show("board") ? [{ id: "board", label: "Board", icon: icons.board }] : []),
      ...(show("dashboard") ? [{ id: "dashboard", label: "Dashboard", icon: icons.dashboard }] : []),
      ...(show("calendar") ? [{ id: "calendar", label: "Calendar", icon: icons.calendar }] : []),
      ...(show("worklog") ? [{ id: "worklog", label: "Work Log", icon: icons.worklog }] : []),
      ...(show("leads") ? [{ id: "leads", label: "Leads", icon: icons.leads }] : []),
      ...(show("clients") ? [{ id: "clients", label: "Clients", icon: icons.clients }] : []),
      ...(show("notice") ? [{ id: "notice", label: "Notice", icon: icons.notice }] : []),
      ...(show("invoice") ? [{ id: "invoice", label: "Invoice", icon: icons.invoice }] : []),
      ...(show("conveyance") ? [{ id: "conveyance", label: "Conveyance", icon: icons.conveyance }] : []),
      ...(show("masters") ? [{ id: "masters", label: "Masters", icon: icons.masters }] : []),
      ...(show("holidays") ? [{ id: "holidays", label: "Holidays", icon: icons.holidays }] : []),
      ...(show("employee") ? [{ id: "employee", label: "Employee", icon: icons.employee }] : []),
      ...(show("pace") ? [{ id: "pace", label: "PACE", icon: icons.pacecheck }] : []),
      ...(show("growthplan") ? [{ id: "growthplan", label: "Growth Plan", icon: icons.growthplan }] : []),
      ...(show("kaizen") ? [{ id: "kaizen", label: "Kaizen", icon: icons.kaizen }] : []),
      ...(show("users") ? [{ id: "users", label: "Users", icon: icons.users }] : []),
      ...(show("settings") ? [{ id: "settings", label: "Settings", icon: icons.settings }] : []),
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
  }, [tabOrder, icons, navVisible]);

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
                          : tab.id === "conveyance"
                            ? conveyanceBadgeCount
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
