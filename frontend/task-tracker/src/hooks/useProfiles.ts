import { useCallback, useEffect, useState } from "react";
import { apiGet, dtoToProfile } from "@/lib/api";
import type { Profile } from "@/types";
import type { ProfileDto } from "@/types/api";

export interface UseProfilesReturn {
  profiles: Profile[];
  loading: boolean;
  reload: () => Promise<void>;
}

export function useProfiles(): UseProfilesReturn {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<ProfileDto[]>("/profiles/");
    setProfiles(dtos.map(dtoToProfile));
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
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return { profiles, loading, reload };
}
