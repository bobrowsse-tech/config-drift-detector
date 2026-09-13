import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import type { DiscoveredEnvironments, EnvironmentMapping } from './types';

const ENV_NAME_RE = /^\.env\.(.+)$/;

function rel(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, '/');
}

/**
 * Discover environment groupings by common filename/folder conventions.
 * Caps default scope to deploy-/k8s-/terraform-style trees plus root .env* files.
 */
export function discoverEnvironments(root: string): DiscoveredEnvironments {
  const notes: string[] = [];
  const byName = new Map<string, Set<string>>();

  const add = (name: string, sourceRel: string) => {
    const env = name.toLowerCase();
    if (!byName.has(env)) {
      byName.set(env, new Set());
    }
    byName.get(env)!.add(sourceRel);
  };

  // Root and nested .env.<env> files (skip .env alone — no environment tag).
  const envFiles = fg.sync(['**/.env.*', '!.env.example', '!.env.sample'], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/out/**'],
    deep: 6,
  });
  for (const file of envFiles) {
    const base = path.basename(file);
    const m = base.match(ENV_NAME_RE);
    if (!m) {
      continue;
    }
    add(m[1], rel(root, file));
  }

  // k8s/overlays/<env>/ or deploy/<env>/
  const overlayDirs = fg.sync(
    ['k8s/overlays/*', 'deploy/*', 'deployments/*', 'overlays/*'],
    {
      cwd: root,
      absolute: true,
      onlyDirectories: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
      deep: 4,
    }
  );
  for (const dir of overlayDirs) {
    const name = path.basename(dir);
    if (name.startsWith('.')) {
      continue;
    }
    const manifests = fg.sync(['**/*.{yml,yaml}'], {
      cwd: dir,
      absolute: true,
      onlyFiles: true,
      deep: 4,
    });
    for (const m of manifests) {
      add(name, rel(root, m));
    }
    if (!manifests.length) {
      notes.push(`Overlay folder ${rel(root, dir)} has no YAML manifests yet.`);
    }
  }

  // terraform/environments/<env>/*.tfvars
  const tfvars = fg.sync(
    [
      'terraform/environments/*/*.tfvars',
      'terraform/*/terraform.tfvars',
      'environments/*/*.tfvars',
      '**/environments/*/*.tfvars',
    ],
    {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/.terraform/**'],
      deep: 8,
    }
  );
  for (const file of tfvars) {
    // .../environments/<env>/x.tfvars or .../<env>/terraform.tfvars
    const parts = rel(root, file).split('/');
    const envIdx = parts.findIndex((p) => p === 'environments');
    let envName: string | undefined;
    if (envIdx >= 0 && parts[envIdx + 1]) {
      envName = parts[envIdx + 1];
    } else {
      // terraform/<env>/terraform.tfvars
      const tfIdx = parts.findIndex((p) => p === 'terraform');
      if (tfIdx >= 0 && parts[tfIdx + 1] && parts[tfIdx + 1] !== 'environments') {
        envName = parts[tfIdx + 1];
      }
    }
    if (envName) {
      add(envName, rel(root, file));
    }
  }

  const environments: EnvironmentMapping[] = [...byName.entries()]
    .map(([name, sources]) => ({ name, sources: [...sources].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!environments.length) {
    notes.push(
      'No environments detected. Expected .env.<name>, k8s/overlays/<name>/, deploy/<name>/, or terraform/environments/<name>/*.tfvars.'
    );
  }

  return { environments, notes };
}

export function mappingExists(root: string, mapping: EnvironmentMapping): boolean {
  return mapping.sources.some((s) => fs.existsSync(path.join(root, s)));
}
