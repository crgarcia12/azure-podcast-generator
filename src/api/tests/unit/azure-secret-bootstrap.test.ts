import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bootstrapAzureSecretEnv, __testing } from '../../src/services/azure-secret-bootstrap.js';

// Snapshot/restore env for each test so one test mutating process.env can't
// poison the next.
const PROJECTED = __testing.PROJECTED_KEYS;

const ENV_SNAPSHOT_KEYS = [...PROJECTED, 'LLM_PROVIDER'] as const;

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_SNAPSHOT_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('azure-secret-bootstrap', () => {
  let envSnap: Record<string, string | undefined>;
  let tmpDir: string;
  let saTokenPath: string;
  let saCaPath: string;
  let saNamespacePath: string;

  beforeEach(() => {
    envSnap = snapshotEnv();
    for (const k of ENV_SNAPSHOT_KEYS) delete process.env[k];

    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'azure-bootstrap-test-'));
    saTokenPath = path.join(tmpDir, 'token');
    saCaPath = path.join(tmpDir, 'ca.crt');
    saNamespacePath = path.join(tmpDir, 'namespace');
    writeFileSync(saTokenPath, 'fake-bearer-token', 'utf-8');
    writeFileSync(saCaPath, '-----BEGIN CERT-----\nfake\n-----END CERT-----\n', 'utf-8');
    writeFileSync(saNamespacePath, 'devx-test\n', 'utf-8');
  });

  afterEach(() => {
    restoreEnv(envSnap);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips the K8s call when all projected env vars are already present', async () => {
    for (const k of PROJECTED) {
      process.env[k] = `pre-set-${k}`;
    }
    let called = false;
    const result = await bootstrapAzureSecretEnv({
      paths: { saTokenPath, saCaPath, saNamespacePath },
      fetchSecretData: async () => {
        called = true;
        return null;
      },
    });
    expect(called).toBe(false);
    expect(result.source).toBe('env');
    expect(result.appliedKeys).toEqual([]);
  });

  it('projects all keys from the K8s Secret into process.env', async () => {
    const fakeData = {
      AZURE_TENANT_ID: 'tenant-from-secret',
      AZURE_CLIENT_ID: 'client-from-secret',
      AZURE_CLIENT_SECRET: 'shhh-from-secret',
      AZURE_OPENAI_ENDPOINT: 'https://crgar-liliput-ai.openai.azure.com/',
      AZURE_AI_FOUNDRY_ENDPOINT: 'https://crgar-liliput-ai.services.ai.azure.com/',
    };
    const result = await bootstrapAzureSecretEnv({
      paths: { saTokenPath, saCaPath, saNamespacePath },
      fetchSecretData: async ({ namespace, name }) => {
        expect(namespace).toBe('devx-test');
        expect(name).toBe('liliput-azure-sp');
        return fakeData;
      },
    });
    expect(result.source).toBe('k8s-secret');
    expect(result.appliedKeys).toEqual(expect.arrayContaining(Array.from(PROJECTED)));
    for (const k of PROJECTED) {
      expect(process.env[k]).toBe(fakeData[k]);
    }
    // Side-effect: LLM_PROVIDER auto-set when AZURE_CLIENT_SECRET projected.
    expect(process.env.LLM_PROVIDER).toBe('azure');
  });

  it('does not overwrite env vars that are already set', async () => {
    process.env.AZURE_TENANT_ID = 'pre-existing-tenant';
    const result = await bootstrapAzureSecretEnv({
      paths: { saTokenPath, saCaPath, saNamespacePath },
      fetchSecretData: async () => ({
        AZURE_TENANT_ID: 'tenant-from-secret',
        AZURE_CLIENT_ID: 'client-from-secret',
        AZURE_CLIENT_SECRET: 'shhh',
        AZURE_OPENAI_ENDPOINT: 'https://endpoint/',
        AZURE_AI_FOUNDRY_ENDPOINT: 'https://foundry/',
      }),
    });
    expect(process.env.AZURE_TENANT_ID).toBe('pre-existing-tenant');
    expect(process.env.AZURE_CLIENT_ID).toBe('client-from-secret');
    expect(result.appliedKeys).not.toContain('AZURE_TENANT_ID');
    expect(result.appliedKeys).toContain('AZURE_CLIENT_ID');
  });

  it('returns unavailable when the Secret is missing', async () => {
    const result = await bootstrapAzureSecretEnv({
      paths: { saTokenPath, saCaPath, saNamespacePath },
      fetchSecretData: async () => null,
    });
    expect(result.source).toBe('unavailable');
    expect(result.appliedKeys).toEqual([]);
    expect(process.env.AZURE_CLIENT_SECRET).toBeUndefined();
  });

  it('returns unavailable when the K8s API throws', async () => {
    const result = await bootstrapAzureSecretEnv({
      paths: { saTokenPath, saCaPath, saNamespacePath },
      fetchSecretData: async () => {
        throw new Error('connection refused');
      },
    });
    expect(result.source).toBe('unavailable');
    expect(result.reason).toContain('connection refused');
  });
});
