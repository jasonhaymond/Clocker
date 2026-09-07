export interface Job {
  id: string;
  name: string;
  colorHex: string;
  hourlyRateCents: number | null;
  archived: boolean;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Shift {
  id: string;
  jobId: string;
  clockIn: string;
  clockOut: string | null;
  notes: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Break {
  id: string;
  shiftId: string;
  start: string;
  end: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export type EntityType = "job" | "shift" | "break";
export type PendingOp = "upsert" | "delete";
