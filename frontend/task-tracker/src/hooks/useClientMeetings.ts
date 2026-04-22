import { useCallback, useEffect, useState } from "react";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  ws,
} from "@/lib/api";
import type {
  ClientActionPointDto,
  ClientActionPointWrite,
  ClientMeetingAttachmentDto,
  ClientMeetingDto,
  ClientMeetingWrite,
} from "@/types/api/clients";

export interface UseClientMeetingsReturn {
  meetings: ClientMeetingDto[];
  loading: boolean;
  reload: (clientUid?: string) => Promise<void>;
  createMeeting: (body: ClientMeetingWrite) => Promise<ClientMeetingDto>;
  updateMeeting: (
    uid: string,
    body: Partial<ClientMeetingWrite>,
  ) => Promise<ClientMeetingDto>;
  deleteMeeting: (uid: string) => Promise<void>;
  addActionPoint: (
    meetingUid: string,
    body: ClientActionPointWrite,
  ) => Promise<ClientActionPointDto>;
  updateActionPoint: (
    apUid: string,
    body: Partial<ClientActionPointWrite>,
  ) => Promise<ClientActionPointDto>;
  deleteActionPoint: (apUid: string) => Promise<void>;
  uploadAttachment: (
    meetingUid: string,
    file: File,
  ) => Promise<ClientMeetingAttachmentDto>;
  deleteAttachment: (attachmentUid: string) => Promise<void>;
}

function replaceActionPoint(
  meetings: ClientMeetingDto[],
  ap: ClientActionPointDto,
): ClientMeetingDto[] {
  return meetings.map((m) =>
    m.id === ap.meeting
      ? {
          ...m,
          action_points: m.action_points.some((x) => x.uid === ap.uid)
            ? m.action_points.map((x) => (x.uid === ap.uid ? ap : x))
            : [...m.action_points, ap],
        }
      : m,
  );
}

export function useClientMeetings(clientUid?: string): UseClientMeetingsReturn {
  const [meetings, setMeetings] = useState<ClientMeetingDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    async (uid?: string): Promise<void> => {
      const effective = uid ?? clientUid;
      const query = effective ? { client_uid: effective } : undefined;
      const data = await apiGet<ClientMeetingDto[]>("/client-meetings/", query);
      setMeetings(data);
    },
    [clientUid],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubMeetings = ws.subscribe<ClientMeetingDto>("client-meetings", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = evt.record;
        if (clientUid && next.client !== clientUid) return;
        setMeetings((prev) => (prev.some((m) => m.uid === next.uid) ? prev : [next, ...prev]));
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = evt.record;
        setMeetings((prev) => prev.map((m) => (m.uid === next.uid ? next : m)));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedUid = (evt.record as { uid?: string }).uid;
        if (deletedUid) setMeetings((prev) => prev.filter((m) => m.uid !== deletedUid));
      }
    });

    const unsubAP = ws.subscribe<ClientActionPointDto>("client-action-points", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        setMeetings((prev) => replaceActionPoint(prev, evt.record!));
      } else if (evt.event === "UPDATE" && evt.record) {
        setMeetings((prev) => replaceActionPoint(prev, evt.record!));
      } else if (evt.event === "DELETE" && evt.record) {
        const payload = evt.record as { uid?: string; meeting_id?: number };
        if (!payload.uid || payload.meeting_id === undefined) return;
        setMeetings((prev) =>
          prev.map((m) =>
            m.id === payload.meeting_id
              ? { ...m, action_points: m.action_points.filter((ap) => ap.uid !== payload.uid) }
              : m,
          ),
        );
      }
    });

    return () => {
      cancelled = true;
      unsubMeetings();
      unsubAP();
    };
  }, [reload, clientUid]);

  const createMeeting = useCallback(async (body: ClientMeetingWrite) => {
    const dto = await apiPost<ClientMeetingDto>("/client-meetings/", body);
    setMeetings((prev) =>
      prev.some((m) => m.uid === dto.uid)
        ? prev.map((m) => (m.uid === dto.uid ? dto : m))
        : [dto, ...prev],
    );
    return dto;
  }, []);

  const updateMeeting = useCallback(
    async (uid: string, body: Partial<ClientMeetingWrite>) => {
      const dto = await apiPatch<ClientMeetingDto>(`/client-meetings/${uid}/`, body);
      setMeetings((prev) => prev.map((m) => (m.uid === uid ? dto : m)));
      return dto;
    },
    [],
  );

  const deleteMeeting = useCallback(async (uid: string) => {
    await apiDelete(`/client-meetings/${uid}/`);
    setMeetings((prev) => prev.filter((m) => m.uid !== uid));
  }, []);

  const addActionPoint = useCallback(
    async (meetingUid: string, body: ClientActionPointWrite) => {
      const dto = await apiPost<ClientActionPointDto>(
        `/client-meetings/${meetingUid}/action-points/`,
        body,
      );
      setMeetings((prev) => replaceActionPoint(prev, dto));
      return dto;
    },
    [],
  );

  const updateActionPoint = useCallback(
    async (apUid: string, body: Partial<ClientActionPointWrite>) => {
      const dto = await apiPatch<ClientActionPointDto>(
        `/client-action-points/${apUid}/`,
        body,
      );
      setMeetings((prev) => replaceActionPoint(prev, dto));
      return dto;
    },
    [],
  );

  const deleteActionPoint = useCallback(async (apUid: string) => {
    await apiDelete(`/client-action-points/${apUid}/`);
    setMeetings((prev) =>
      prev.map((m) => ({
        ...m,
        action_points: m.action_points.filter((ap) => ap.uid !== apUid),
      })),
    );
  }, []);

  const uploadAttachment = useCallback(
    async (meetingUid: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      const dto = await apiPostForm<ClientMeetingAttachmentDto>(
        `/client-meetings/${meetingUid}/attachments/`,
        form,
      );
      setMeetings((prev) =>
        prev.map((m) => {
          if (m.uid !== meetingUid) return m;
          const exists = m.attachments.some((a) => a.uid === dto.uid);
          return {
            ...m,
            attachments: exists
              ? m.attachments.map((a) => (a.uid === dto.uid ? dto : a))
              : [dto, ...m.attachments],
          };
        }),
      );
      return dto;
    },
    [],
  );

  const deleteAttachment = useCallback(async (attachmentUid: string) => {
    await apiDelete(`/client-attachments/${attachmentUid}/`);
    setMeetings((prev) =>
      prev.map((m) => ({
        ...m,
        attachments: m.attachments.filter((a) => a.uid !== attachmentUid),
      })),
    );
  }, []);

  return {
    meetings,
    loading,
    reload,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    addActionPoint,
    updateActionPoint,
    deleteActionPoint,
    uploadAttachment,
    deleteAttachment,
  };
}
