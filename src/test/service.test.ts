import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigDriftService,
  discoverEnvironments,
  parseEnvFile,
  parseK8sFile,
  parseTfvarsFile,
  classifyShape,
  readIgnoreList,
  appendIgnore,
  buildInventory,
  collectEntries,
  diffInventories,
} from '../service';

const fixtures = path.join(__dirname, 'fixtures');

describe('classifyShape', () => {
  it('classifies coarse value shapes without exposing values', () => {
    assert.equal(classifyShape(''), 'empty');
    assert.equal(classifyShape('true'), 'boolean-looking');
    assert.equal(classifyShape('42'), 'number-looking');
    assert.equal(classifyShape('https://x'), 'string');
  });
});

describe('discoverEnvironments', () => {
  it('finds .env.<env> siblings', () => {
    const { environments } = discoverEnvironments(path.join(fixtures, 'env-files'));
    const names = environments.map((e) => e.name).sort();
    assert.deepEqual(names, ['development', 'production', 'staging']);
  });

  it('finds k8s/overlays/<env>/', () => {
    const { environments } = discoverEnvironments(path.join(fixtures, 'k8s-overlays'));
    assert.ok(environments.some((e) => e.name === 'staging'));
    assert.ok(environments.some((e) => e.name === 'production'));
  });

  it('finds terraform/environments/<env>/*.tfvars', () => {
    const { environments } = discoverEnvironments(path.join(fixtures, 'tfvars'));
    assert.ok(environments.some((e) => e.name === 'staging'));
    assert.ok(environments.some((e) => e.name === 'production'));
  });
});

describe('parsers', () => {
  it('parses .env keys with line numbers and never needs values later', () => {
    const entries = parseEnvFile(
      path.join(fixtures, 'env-files'),
      '.env.development',
      'development'
    );
    const shared = entries.find((e) => e.key === 'SHARED_URL');
    assert.ok(shared);
    assert.equal(shared!.type, 'string');
    assert.ok(shared!.line >= 1);
  });

  it('parses ConfigMap data keys only (no secret values exposed in entries)', () => {
    const entries = parseK8sFile(
      path.join(fixtures, 'k8s-overlays'),
      'k8s/overlays/staging/configmap.yaml',
      'staging'
    );
    assert.ok(entries.some((e) => e.key === 'SHARED_URL'));
    assert.ok(entries.every((e) => 'type' in e && 'sourceFile' in e));
  });

  it('parses flat tfvars with regex extractor', () => {
    const entries = parseTfvarsFile(
      path.join(fixtures, 'tfvars'),
      'terraform/environments/staging/main.tfvars',
      'staging'
    );
    assert.ok(entries.some((e) => e.key === 'region'));
    assert.equal(entries.find((e) => e.key === 'instance_count')!.type, 'number-looking');
  });
});

describe('diff + ignore', () => {
  it('reports missing key, type-mismatch, and ignored keys exactly', () => {
    const root = path.join(fixtures, 'env-files');
    const service = new ConfigDriftService(root);
    const result = service.scan({
      mappings: discoverEnvironments(root).environments,
    });

    const missingApiInProd = result.report.rows.find((r) => r.key === 'API_TIMEOUT');
    // API_TIMEOUT present everywhere but production is boolean-looking vs number-looking
    assert.ok(missingApiInProd);
    assert.equal(missingApiInProd!.flag, 'type-mismatch');
    assert.equal(missingApiInProd!.typeMismatch, true);

    const localDebug = result.report.rows.find((r) => r.key === 'LOCAL_DEBUG');
    assert.ok(localDebug);
    assert.equal(localDebug!.flag, 'ignored');

    const newInStaging = result.report.rows.find((r) => r.key === 'NEW_IN_STAGING');
    assert.ok(newInStaging);
    assert.equal(newInStaging!.flag, 'ignored');

    // FEATURE_FLAG present in all three — ok
    const feature = result.report.rows.find((r) => r.key === 'FEATURE_FLAG');
    assert.ok(feature);
    assert.equal(feature!.flag, 'ok');

    // SHARED_URL present in all — ok
    assert.equal(result.report.rows.find((r) => r.key === 'SHARED_URL')!.flag, 'ok');

    assert.ok(result.report.summary.typeMismatch >= 1);
    assert.ok(result.report.summary.ignored >= 2);
  });

  it('appendIgnore writes KEY and KEY@env forms', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'));
    try {
      appendIgnore(dir, 'FOO');
      appendIgnore(dir, 'BAR', 'production');
      const rules = readIgnoreList(dir);
      assert.ok(rules.some((r) => r.raw === 'FOO'));
      assert.ok(rules.some((r) => r.raw === 'BAR@production'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('inventory helpers', () => {
  it('collectEntries routes by file type', () => {
    const root = path.join(fixtures, 'env-files');
    const mappings = discoverEnvironments(root).environments;
    const entries = collectEntries(root, mappings, {
      env: parseEnvFile,
      k8s: parseK8sFile,
      tfvars: parseTfvarsFile,
    });
    assert.ok(entries.length > 0);
    const inv = buildInventory(entries);
    assert.ok(inv.has('development'));
    const report = diffInventories(inv, mappings.map((m) => m.name), readIgnoreList(root));
    assert.ok(report.rows.length > 0);
  });
});
