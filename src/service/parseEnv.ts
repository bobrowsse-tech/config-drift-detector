import * as fs from 'fs';
import * as path from 'path';
import { parse as dotenvParse } from 'dotenv';
import type { KeyEntry, ValueShape } from './types';

export function classifyShape(raw: string | undefined): ValueShape {
  if (raw === undefined || raw === '') {
    return 'empty';
  }
  const v = raw.trim();
  if (/^(true|false)$/i.test(v)) {
    return 'boolean-looking';
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    return 'number-looking';
  }
  return 'string';
}

/**
 * Parse a .env file with dotenv.parse — never require()/execute the file.
 * Values are classified then discarded; only shape + location are kept.
 */
export function parseEnvFile(
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

  const parsed = dotenvParse(text);
  const lines = text.split(/\r?\n/);
  const lineOf = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !lineOf.has(m[1])) {
      lineOf.set(m[1], i + 1);
    }
  }

  const entries: KeyEntry[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    entries.push({
      key,
      environment,
      type: classifyShape(value),
      sourceFile: relativePath.replace(/\\/g, '/'),
      line: lineOf.get(key) ?? 1,
      kind: 'env',
    });
  }
  return entries;
}
