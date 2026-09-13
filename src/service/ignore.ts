import * as fs from 'fs';
import * as path from 'path';
import { IGNORE_FILENAME } from './types';

export interface IgnoreRule {
  key: string;
  /** If set, only ignore this key in the named environment. */
  environment?: string;
  raw: string;
}

export function ignorePath(root: string): string {
  return path.join(root, IGNORE_FILENAME);
}

export function readIgnoreList(root: string): IgnoreRule[] {
  const file = ignorePath(root);
  if (!fs.existsSync(file)) {
    return [];
  }
  const text = fs.readFileSync(file, 'utf8');
  const rules: IgnoreRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const at = trimmed.indexOf('@');
    if (at > 0) {
      rules.push({
        key: trimmed.slice(0, at),
        environment: trimmed.slice(at + 1).toLowerCase(),
        raw: trimmed,
      });
    } else {
      rules.push({ key: trimmed, raw: trimmed });
    }
  }
  return rules;
}

export function isIgnored(
  rules: IgnoreRule[],
  key: string,
  environment?: string
): boolean {
  return rules.some((r) => {
    if (r.key !== key) {
      return false;
    }
    if (!r.environment) {
      return true;
    }
    return environment !== undefined && r.environment === environment.toLowerCase();
  });
}

/**
 * Append a key (optionally scoped as KEY@env) to .configdrift-ignore.
 * Returns the file path written.
 */
export function appendIgnore(
  root: string,
  key: string,
  environment?: string
): string {
  const file = ignorePath(root);
  const entry = environment ? `${key}@${environment}` : key;
  const existing = readIgnoreList(root);
  if (existing.some((r) => r.raw === entry)) {
    return file;
  }
  const prefix = fs.existsSync(file) && !fs.readFileSync(file, 'utf8').endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${prefix}${entry}\n`, 'utf8');
  return file;
}
