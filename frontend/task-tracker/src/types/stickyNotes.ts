export interface StickyNote {
  id: number;
  text: string;
  colorIdx: number;
  created: string;
}

export interface StickyNotesProps {
  userId: string;
}
