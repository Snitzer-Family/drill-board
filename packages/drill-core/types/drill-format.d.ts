export type RinkMode = "full" | "half" | "quarter";

export interface DrillPiece {
  id: string;
  kind: string;
  x: number;
  y: number;
  color: string;
  label?: string;
  text?: string;
  goalie?: boolean;
  defense?: boolean;
  [key: string]: unknown;
}

export interface DrillStep {
  at?: number;
  on?: string;
  pos?: { x: number; y: number };
  text: string;
}

export interface InventoryRow {
  key: string;
  label: string;
  custom: boolean;
  autoCount: number;
  count: number;
  hide: boolean;
}

export interface ParsedDrill {
  rink: RinkMode;
  pieces: DrillPiece[];
  /** Soft errors. Most problems land here rather than throwing — check it. */
  errors: string[];
  title: string;
  desc: string;
  dslVersion: number;
  steps: DrillStep[];
  notes: string | null;
  items: unknown[];
}

/** Pulls the first ```drill fence. Returns the INPUT UNCHANGED when none exists. */
export function extractDrill(text: string): string;
export function parseDrill(text: string): ParsedDrill;
export function serializeDrill(
  rink: RinkMode,
  pieces: DrillPiece[],
  title?: string,
  desc?: string,
  steps?: DrillStep[],
  notes?: string,
  items?: unknown[],
): string;
export function deriveInventory(pieces: DrillPiece[], items?: unknown[]): InventoryRow[];
export function ensureShotNet(pieces: DrillPiece[]): DrillPiece[];
export const INV_KINDS: readonly string[];
