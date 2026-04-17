import type { ID } from "./common";

export interface MasterItem {
  id: ID;
  name: string;
  /** 'client' | 'team' | 'org' | 'category' */
  type: string;
  org: string | null;
  /** Used for team members */
  color?: string | null;
}

/** State shape for the masters add/edit modal */
export interface MasterModalState {
  type: string;
  item: MasterItem | null;
}
