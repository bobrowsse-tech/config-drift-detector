export type ValueShape = 'string' | 'number-looking' | 'boolean-looking' | 'empty';

export type SourceKind = 'env' | 'k8s' | 'tfvars';

export interface KeyLocation {
  type: ValueShape;
  sourceFile: string;
  line: number;
  kind: SourceKind;
}

export interface EnvironmentMapping {
  name: string;
  /** Relative paths that belong to this environment. */
  sources: string[];
}

export interface DiscoveredEnvironments {
  environments: EnvironmentMapping[];
  notes: string[];
}

export interface KeyEntry extends KeyLocation {
  key: string;
  environment: string;
}

export type DriftFlag = 'missing' | 'type-mismatch' | 'ok' | 'ignored';

export interface DriftRow {
  key: string;
  presentIn: string[];
  missingFrom: string[];
  flag: DriftFlag;
  /** True when present environments disagree on coarse value shape (heuristic). */
  typeMismatch: boolean;
  shapes: Partial<Record<string, ValueShape>>;
  locations: Partial<Record<string, KeyLocation>>;
  severity: number;
}

export interface DriftReport {
  scannedAt: string;
  environments: string[];
  rows: DriftRow[];
  ignoredKeys: string[];
  summary: {
    missing: number;
    typeMismatch: number;
    ignored: number;
    ok: number;
  };
}

export const IGNORE_FILENAME = '.configdrift-ignore';
