import * as fs from 'fs';
import * as path from 'path';
import { classifyShape } from './parseEnv';
import type { KeyEntry } from './types';

/**
 * Regex-based top-level `key = value` extractor for flat .tfvars files.
 * Nested/module-scoped variables are a known v2 gap (see DIRECTIVE.md).
 */
export function parseTfvarsFile(
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
  const lines = text.split(/\r?\n/);
  // Matches: key = "value" | key = 123 | key = true | key = null
  const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*(?:#.*)?$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#') || line.trim().startsWith('//')) {
      continue;
    }
    // Skip block starts (objects/lists) — v2 gap for nested vars.
    if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*[{\[]/.test(line)) {
      continue;
    }
    const m = line.match(re);
    if (!m) {
      continue;
    }
    const key = m[1];
    let raw = m[2].trim();
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    }
    entries.push({
      key,
      environment,
      type: classifyShape(raw === 'null' ? '' : raw),
      sourceFile: relativePath.replace(/\\/g, '/'),
      line: i + 1,
      kind: 'tfvars',
    });
  }
  return entries;
}
