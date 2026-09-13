import type {
  DriftReport,
  DriftRow,
  EnvironmentMapping,
  KeyEntry,
  KeyLocation,
  ValueShape,
} from './types';
import { isIgnored, type IgnoreRule } from './ignore';

export type Inventory = Map<string, Map<string, KeyLocation>>;

export function buildInventory(entries: KeyEntry[]): Inventory {
  const inv: Inventory = new Map();
  for (const e of entries) {
    if (!inv.has(e.environment)) {
      inv.set(e.environment, new Map());
    }
    const envMap = inv.get(e.environment)!;
    if (!envMap.has(e.key)) {
      envMap.set(e.key, {
        type: e.type,
        sourceFile: e.sourceFile,
        line: e.line,
        kind: e.kind,
      });
    }
  }
  return inv;
}

function severityOf(flag: DriftRow['flag']): number {
  if (flag === 'missing') {
    return 3;
  }
  if (flag === 'type-mismatch') {
    return 2;
  }
  if (flag === 'ok') {
    return 1;
  }
  return 0;
}

function shouldIgnore(
  rules: IgnoreRule[],
  key: string,
  presentIn: string[],
  _missingFrom: string[]
): boolean {
  if (isIgnored(rules, key)) {
    return true;
  }
  // KEY@environment — intentionally env-specific: every environment that has
  // the key is covered by a scoped ignore rule.
  if (presentIn.length > 0 && presentIn.every((env) => isIgnored(rules, key, env))) {
    return true;
  }
  return false;
}

/**
 * Diff normalized inventories across environments.
 * Type-mismatch is a heuristic on coarse shapes, not a hard type system.
 */
export function diffInventories(
  inventory: Inventory,
  environments: string[],
  ignoreRules: IgnoreRule[],
  envFilter?: string[]
): DriftReport {
  const filter = envFilter?.map((e) => e.toLowerCase());
  const uniqueEnvs = [
    ...new Set(
      (filter?.length ? environments.filter((e) => filter.includes(e)) : environments).map((e) =>
        e.toLowerCase()
      )
    ),
  ];

  const allKeys = new Set<string>();
  for (const env of uniqueEnvs) {
    for (const key of inventory.get(env)?.keys() ?? []) {
      allKeys.add(key);
    }
  }

  const rows: DriftRow[] = [];
  const ignoredKeys: string[] = [];

  for (const key of [...allKeys].sort()) {
    const presentIn: string[] = [];
    const missingFrom: string[] = [];
    const shapes: Partial<Record<string, ValueShape>> = {};
    const locations: Partial<Record<string, KeyLocation>> = {};

    for (const env of uniqueEnvs) {
      const loc = inventory.get(env)?.get(key);
      if (loc) {
        presentIn.push(env);
        shapes[env] = loc.type;
        locations[env] = loc;
      } else {
        missingFrom.push(env);
      }
    }

    const typeMismatch = new Set(Object.values(shapes)).size > 1;
    let flag: DriftRow['flag'] = 'ok';
    if (missingFrom.length > 0) {
      flag = 'missing';
    } else if (typeMismatch) {
      flag = 'type-mismatch';
    }

    if (flag !== 'ok' && shouldIgnore(ignoreRules, key, presentIn, missingFrom)) {
      flag = 'ignored';
      ignoredKeys.push(key);
    } else if (flag === 'ok' && isIgnored(ignoreRules, key)) {
      flag = 'ignored';
      ignoredKeys.push(key);
    }

    rows.push({
      key,
      presentIn,
      missingFrom,
      flag,
      typeMismatch,
      shapes,
      locations,
      severity: severityOf(flag),
    });
  }

  rows.sort((a, b) => b.severity - a.severity || a.key.localeCompare(b.key));

  return {
    scannedAt: new Date().toISOString(),
    environments: uniqueEnvs,
    rows,
    ignoredKeys: [...new Set(ignoredKeys)],
    summary: {
      missing: rows.filter((r) => r.flag === 'missing').length,
      typeMismatch: rows.filter((r) => r.flag === 'type-mismatch').length,
      ignored: rows.filter((r) => r.flag === 'ignored').length,
      ok: rows.filter((r) => r.flag === 'ok').length,
    },
  };
}

export function collectEntries(
  root: string,
  mappings: EnvironmentMapping[],
  parsers: {
    env: (root: string, rel: string, env: string) => KeyEntry[];
    k8s: (root: string, rel: string, env: string) => KeyEntry[];
    tfvars: (root: string, rel: string, env: string) => KeyEntry[];
  }
): KeyEntry[] {
  const entries: KeyEntry[] = [];
  for (const mapping of mappings) {
    for (const source of mapping.sources) {
      const lower = source.toLowerCase();
      if (/(^|\/)\.env(\.|$)/.test(lower) || pathBasename(lower).startsWith('.env.')) {
        entries.push(...parsers.env(root, source, mapping.name));
      } else if (lower.endsWith('.tfvars')) {
        entries.push(...parsers.tfvars(root, source, mapping.name));
      } else if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
        entries.push(...parsers.k8s(root, source, mapping.name));
      }
    }
  }
  return entries;
}

function pathBasename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] ?? p;
}
