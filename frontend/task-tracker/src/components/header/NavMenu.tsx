import { useState, useMemo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
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
  const [drawerOpen, setDrawerOpen] = useState(false);
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
      ...(show("costing") ? [{ id: "costing", label: "Costing", icon: icons.costing }] : []),
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
      // Always shown — not gated by navVisible since it's a static download
      // link, not an org/role-scoped feature.
      { id: "apk", label: "Android App", icon: icons.apk },
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

  const badgeFor = (tabId: string): number | undefined =>
    tabId === "clients"
      ? clientsBadgeCount
      : tabId === "leads"
        ? leadsBadgeCount
        : tabId === "kaizen"
          ? kaizenBadgeCount
          : tabId === "pace"
            ? paceBadgeCount
            : tabId === "invoice"
              ? invoiceBadgeCount
              : tabId === "conveyance"
                ? conveyanceBadgeCount
                : undefined;

  const totalBadge = NAV_TABS.reduce(
    (sum, t) => sum + (badgeFor(t.id) ?? 0),
    0,
  );

  const activeTab = NAV_TABS.find((t) => t.id === view);

  // Close the drawer with the hardware/browser back-friendly Escape key.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

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

  const drawer = drawerOpen
    ? createPortal(
        <div
          className="nav-drawer-overlay"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setDrawerOpen(false)
          }
        >
          <div className="nav-drawer" role="dialog" aria-label="Menu">
            <div className="nav-drawer-head">
              <span className="nav-drawer-title">📋 Menu</span>
              <button
                className="nav-drawer-close"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="nav-drawer-list">
              {NAV_TABS.map((tab) => {
                const badge = badgeFor(tab.id);
                return (
                  <button
                    key={tab.id}
                    className={`nav-drawer-item${view === tab.id ? " active" : ""}`}
                    onClick={() => {
                      onViewChange(tab.id);
                      setDrawerOpen(false);
                    }}
                  >
                    <span className="nav-drawer-item-icon">{tab.icon}</span>
                    <span className="nav-drawer-item-label">{tab.label}</span>
                    {badge != null && badge > 0 && (
                      <span className="nav-drawer-item-badge">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {/* Mobile-only hamburger bar (CSS shows it ≤640px, hides .nav-tabs) */}
      <div className="nav-mobile-bar">
        <button
          className="nav-mobile-btn"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(true)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="nav-mobile-title">
          {activeTab?.label ?? ""}
        </span>
        <button
          className="nav-mobile-btn"
          aria-label="Notifications"
          title="Pending items"
          onClick={() => setDrawerOpen(true)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          {totalBadge > 0 && (
            <span className="nav-mobile-badge">
              {totalBadge > 99 ? "99+" : totalBadge}
            </span>
          )}
        </button>
      </div>
      {drawer}

      {/* Desktop tab strip (draggable) */}
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
                badge={badgeFor(tab.id)}
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
    </>
  );
}
