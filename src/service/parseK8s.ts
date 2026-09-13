import * as fs from 'fs';
import * as path from 'path';
import { parseAllDocuments } from 'yaml';
import { classifyShape } from './parseEnv';
import type { KeyEntry } from './types';

function lineOfKeyInYaml(text: string, key: string): number {
  const re = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      return i + 1;
    }
  }
  return 1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk k8s manifests for ConfigMap/Secret data keys and container env names.
 * Records key names + redacted type descriptors only — never secret values.
 */
export function parseK8sFile(
  root: string,
  relativePath: string,
  environment: string
): KeyEntry[] {
  const abs = path.join(root, relativePath);
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return [];
  }

  const entries: KeyEntry[] = [];
  const seen = new Set<string>();

  const add = (key: string, rawHint?: string) => {
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push({
      key,
      environment,
      type: classifyShape(rawHint),
      sourceFile: relativePath.replace(/\\/g, '/'),
      line: lineOfKeyInYaml(text, key),
      kind: 'k8s',
    });
  };

  let docs;
  try {
    docs = parseAllDocuments(text);
  } catch {
    return [];
  }

  for (const doc of docs) {
    const obj = doc.toJSON() as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object') {
      continue;
    }
    const kind = String(obj.kind ?? '');

    if (kind === 'ConfigMap' || kind === 'Secret') {
      const data = (obj.data ?? {}) as Record<string, string>;
      const stringData = (obj.stringData ?? {}) as Record<string, string>;
      for (const key of Object.keys(data)) {
        // Secret.data values are base64 — do not decode; treat as opaque string.
        add(key, kind === 'Secret' ? 'opaque' : data[key]);
      }
      for (const key of Object.keys(stringData)) {
        add(key, kind === 'Secret' ? 'opaque' : stringData[key]);
      }
    }

    walkContainers(obj, add);
  }

  return entries;
}

function walkContainers(
  obj: Record<string, unknown>,
  add: (key: string, rawHint?: string) => void
): void {
  const spec = obj.spec as Record<string, unknown> | undefined;
  if (!spec) {
    return;
  }
  const template = spec.template as Record<string, unknown> | undefined;
  const podSpec = (template?.spec ?? spec) as Record<string, unknown> | undefined;
  if (!podSpec) {
    return;
  }
  const containers = [
    ...((podSpec.containers as unknown[]) ?? []),
    ...((podSpec.initContainers as unknown[]) ?? []),
  ];
  for (const c of containers) {
    if (!c || typeof c !== 'object') {
      continue;
    }
    const env = (c as { env?: Array<{ name?: string; value?: string }> }).env ?? [];
    for (const e of env) {
      if (e?.name) {
        add(e.name, e.value);
      }
    }
    const envFrom = (c as { envFrom?: unknown[] }).envFrom ?? [];
    // envFrom references ConfigMaps/Secrets by name — no keys to inventory here.
    void envFrom;
  }
}
