export type {
  DiscoveredEnvironments,
  DriftFlag,
  DriftReport,
  DriftRow,
  EnvironmentMapping,
  KeyEntry,
  KeyLocation,
  SourceKind,
  ValueShape,
} from './types';
export { IGNORE_FILENAME } from './types';

export { discoverEnvironments } from './discover';
export { parseEnvFile, classifyShape } from './parseEnv';
export { parseK8sFile } from './parseK8s';
export { parseTfvarsFile } from './parseTfvars';
export {
  appendIgnore,
  ignorePath,
  isIgnored,
  readIgnoreList,
} from './ignore';
export { buildInventory, collectEntries, diffInventories } from './diff';

import { discoverEnvironments } from './discover';
import { parseEnvFile } from './parseEnv';
import { parseK8sFile } from './parseK8s';
import { parseTfvarsFile } from './parseTfvars';
import { appendIgnore, readIgnoreList } from './ignore';
import { buildInventory, collectEntries, diffInventories } from './diff';
import type { DriftReport, DriftRow, EnvironmentMapping, KeyLocation } from './types';

export interface ScanOptions {
  /** Subset of environment names to compare. */
  environments?: string[];
  /** Pre-confirmed mapping; if omitted, discovery is used. */
  mappings?: EnvironmentMapping[];
}

export interface ScanResult {
  report: DriftReport;
  mappings: EnvironmentMapping[];
  notes: string[];
}

/**
 * High-level facade used by commands and the Language Model Tool.
 * Pure Node — no vscode imports. Ignore-list writes are exposed separately
 * so the LM tool path can stay report-only.
 */
export class ConfigDriftService {
  constructor(private readonly root: string) {}

  discover() {
    return discoverEnvironments(this.root);
  }

  scan(options: ScanOptions = {}): ScanResult {
    const discovered = this.discover();
    const mappings =
      options.mappings ??
      discovered.environments.filter((m) =>
        options.environments?.length
          ? options.environments.map((e) => e.toLowerCase()).includes(m.name)
          : true
      );

    const entries = collectEntries(this.root, mappings, {
      env: parseEnvFile,
      k8s: parseK8sFile,
      tfvars: parseTfvarsFile,
    });
    const inventory = buildInventory(entries);
    const envNames = mappings.map((m) => m.name);
    const ignoreRules = readIgnoreList(this.root);
    const report = diffInventories(inventory, envNames, ignoreRules, options.environments);

    return { report, mappings, notes: discovered.notes };
  }

  ignoreKey(key: string, environment?: string): string {
    return appendIgnore(this.root, key, environment);
  }

  findSource(
    report: DriftReport,
    key: string,
    environment?: string
  ): KeyLocation & { environment: string } | undefined {
    const row = report.rows.find((r) => r.key === key);
    if (!row) {
      return undefined;
    }
    const env =
      environment ??
      row.presentIn[0] ??
      Object.keys(row.locations)[0];
    if (!env) {
      return undefined;
    }
    const loc = row.locations[env];
    if (!loc) {
      return undefined;
    }
    return { ...loc, environment: env };
  }

  formatReport(report: DriftReport): string {
    const lines = [
      `Config drift scan at ${report.scannedAt}`,
      `Environments: ${report.environments.join(', ') || '(none)'}`,
      `Summary: ${report.summary.missing} missing, ${report.summary.typeMismatch} type-mismatch (heuristic), ${report.summary.ignored} ignored, ${report.summary.ok} ok`,
      '',
    ];
    const interesting = report.rows.filter((r) => r.flag !== 'ok');
    if (!interesting.length) {
      lines.push('No structural drift detected.');
      return lines.join('\n');
    }
    for (const row of interesting) {
      lines.push(formatRow(row));
    }
    return lines.join('\n');
  }
}

function formatRow(row: DriftRow): string {
  const parts = [`[${row.flag}] ${row.key}`];
  if (row.presentIn.length) {
    parts.push(`present in: ${row.presentIn.join(', ')}`);
  }
  if (row.missingFrom.length) {
    parts.push(`missing from: ${row.missingFrom.join(', ')}`);
  }
  if (row.typeMismatch) {
    const shapeStr = Object.entries(row.shapes)
      .map(([e, s]) => `${e}=${s}`)
      .join(', ');
    parts.push(`shapes (heuristic): ${shapeStr}`);
  }
  return parts.join(' | ');
}
