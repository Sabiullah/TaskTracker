import ClientMOMSingleView from "./ClientMOMSingleView";
import ClientMOMAllView from "./ClientMOMAllView";
import type { Profile } from "@/types/auth";

interface Props {
  clientUid: string;
  selectedOrg: string | null;
  profile: Profile | null;
  profiles: Profile[];
  canWrite: boolean;
}

export default function ClientMOMTab({ clientUid, selectedOrg, profile, profiles, canWrite }: Props) {
  if (clientUid) {
    return (
      <ClientMOMSingleView
        clientUid={clientUid}
        profile={profile}
        profiles={profiles}
        canWrite={canWrite}
      />
    );
  }
  return (
    <ClientMOMAllView
      selectedOrg={selectedOrg}
      profile={profile}
      profiles={profiles}
      canWrite={canWrite}
    />
  );
}
