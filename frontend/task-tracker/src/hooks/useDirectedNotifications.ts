import { useEffect } from "react";
import { ws } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { DirectedNotificationPayload } from "@/types/api/internalReports";
import { useAuth } from "@/hooks/useAuth";

/**
 * Subscribes to the realtime ``notifications`` channel and pops a toast for
 * messages addressed to the current user. Mount once at the app root.
 *
 * The ``link`` payload is currently informational — clicking the toast cannot
 * yet deep-link to a specific visit. A follow-up can wire that up via a small
 * router helper; for v1 the toast text alone is enough.
 */
export function useDirectedNotifications(): void {
  const { profile } = useAuth();
  const myUid = profile?.id;
  useEffect(() => {
    if (!myUid) return;
    const unsub = ws.subscribe<DirectedNotificationPayload>("notifications", (evt) => {
      if (evt.event !== "INSERT" || !evt.record) return;
      if (evt.record.to_user_uid !== myUid) return;
      toast.show(`${evt.record.title} — ${evt.record.body}`, "ok");
    });
    return unsub;
  }, [myUid]);
}
