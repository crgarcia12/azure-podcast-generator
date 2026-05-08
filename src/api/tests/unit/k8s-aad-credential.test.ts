import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { K8sFederatedAadCredential } from '../../src/services/k8s-aad-credential.js';

describe('K8sFederatedAadCredential', () => {
  let tmpDir: string;
  let saTokenPath: string;
  let saCaPath: string;
  let saNsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'k8s-aad-test-'));
    saTokenPath = join(tmpDir, 'token');
    saCaPath = join(tmpDir, 'ca.crt');
    saNsPath = join(tmpDir, 'namespace');
    writeFileSync(saTokenPath, 'pod-sa-token-xyz');
    writeFileSync(saCaPath, '-----FAKE CA-----');
    writeFileSync(saNsPath, 'test-ns');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeFakeFetch(reply: Record<string, unknown>, status = 200): {
    fetch: typeof fetch;
    calls: Array<{ url: string; init: RequestInit | undefined }>;
  } {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: input.toString(), init });
      return new Response(JSON.stringify(reply), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { fetch: fakeFetch, calls };
  }

  it('drives K8s → AAD federation and returns the access token', async () => {
    const requesterCalls: Array<{
      namespace: string;
      serviceAccountName: string;
      saBearerToken: string;
      audience: string;
    }> = [];
    const k8sTokenRequester = vi.fn(async (input: {
      namespace: string;
      serviceAccountName: string;
      saBearerToken: string;
      caCert: string;
      audience: string;
    }) => {
      requesterCalls.push({
        namespace: input.namespace,
        serviceAccountName: input.serviceAccountName,
        saBearerToken: input.saBearerToken,
        audience: input.audience,
      });
      return 'k8s-federated-jwt-assertion';
    });

    const { fetch, calls } = makeFakeFetch({
      access_token: 'aad-access-token',
      expires_in: 3600,
    });

    const credential = new K8sFederatedAadCredential({
      tenantId: 'tenant-uuid',
      clientId: 'client-uuid',
      paths: { saTokenPath, saCaPath, saNamespacePath: saNsPath },
      k8sTokenRequester,
      fetchImpl: fetch,
    });

    const tok = await credential.getToken('https://cognitiveservices.azure.com/.default');
    expect(tok.token).toBe('aad-access-token');
    expect(tok.expiresOnTimestamp).toBeGreaterThan(Date.now());

    // Verify the K8s side received what we expect.
    expect(requesterCalls).toHaveLength(1);
    expect(requesterCalls[0]).toMatchObject({
      namespace: 'test-ns',
      serviceAccountName: 'default',
      saBearerToken: 'pod-sa-token-xyz',
      audience: 'api://AzureADTokenExchange',
    });

    // Verify the AAD call.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://login.microsoftonline.com/tenant-uuid/oauth2/v2.0/token',
    );
    const body = String((calls[0]!.init as RequestInit).body);
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('client-uuid');
    expect(params.get('client_assertion')).toBe('k8s-federated-jwt-assertion');
    expect(params.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    expect(params.get('scope')).toBe('https://cognitiveservices.azure.com/.default');
  });

  it('caches the access token across calls until refresh skew', async () => {
    const k8sTokenRequester = vi.fn(async () => 'jwt-assert');
    let aadCalls = 0;
    const fakeFetch = (async () => {
      aadCalls++;
      return new Response(
        JSON.stringify({ access_token: `aad-${aadCalls}`, expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const credential = new K8sFederatedAadCredential({
      tenantId: 't',
      clientId: 'c',
      paths: { saTokenPath, saCaPath, saNamespacePath: saNsPath },
      k8sTokenRequester,
      fetchImpl: fakeFetch,
    });

    const a = await credential.getToken('scope-1');
    const b = await credential.getToken('scope-1');
    expect(a.token).toBe('aad-1');
    expect(b.token).toBe('aad-1');
    expect(aadCalls).toBe(1);
    expect(k8sTokenRequester).toHaveBeenCalledOnce();
  });

  it('de-duplicates concurrent fetches for the same scope', async () => {
    let aadCalls = 0;
    const k8sTokenRequester = vi.fn(async () => 'jwt-assert');
    const fakeFetch = (async () => {
      aadCalls++;
      // Add a microtask delay so concurrent callers race the cache.
      await new Promise((resolve) => setImmediate(resolve));
      return new Response(
        JSON.stringify({ access_token: `aad-${aadCalls}`, expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const credential = new K8sFederatedAadCredential({
      tenantId: 't',
      clientId: 'c',
      paths: { saTokenPath, saCaPath, saNamespacePath: saNsPath },
      k8sTokenRequester,
      fetchImpl: fakeFetch,
    });

    const [a, b, c] = await Promise.all([
      credential.getToken('scope-x'),
      credential.getToken('scope-x'),
      credential.getToken('scope-x'),
    ]);
    expect(a.token).toBe('aad-1');
    expect(b.token).toBe('aad-1');
    expect(c.token).toBe('aad-1');
    expect(aadCalls).toBe(1);
  });

  it('surfaces AAD errors with the status code in the message', async () => {
    const k8sTokenRequester = vi.fn(async () => 'jwt-assert');
    const { fetch } = makeFakeFetch(
      { error: 'invalid_request', error_description: 'bad assertion' },
      400,
    );
    const credential = new K8sFederatedAadCredential({
      tenantId: 't',
      clientId: 'c',
      paths: { saTokenPath, saCaPath, saNamespacePath: saNsPath },
      k8sTokenRequester,
      fetchImpl: fetch,
    });
    await expect(credential.getToken('scope')).rejects.toThrow(
      /AAD token exchange failed \(400\)/,
    );
  });

  it('surfaces missing-token AAD responses', async () => {
    const k8sTokenRequester = vi.fn(async () => 'jwt-assert');
    const { fetch } = makeFakeFetch({ token_type: 'Bearer', expires_in: 3600 });
    const credential = new K8sFederatedAadCredential({
      tenantId: 't',
      clientId: 'c',
      paths: { saTokenPath, saCaPath, saNamespacePath: saNsPath },
      k8sTokenRequester,
      fetchImpl: fetch,
    });
    await expect(credential.getToken('scope')).rejects.toThrow(/no access_token/);
  });

  it('honours a custom serviceAccountName', async () => {
    const captured: Array<{ serviceAccountName: string }> = [];
    const k8sTokenRequester = vi.fn(async (input: { serviceAccountName: string }) => {
      captured.push({ serviceAccountName: input.serviceAccountName });
      return 'jwt';
    });
    const { fetch } = makeFakeFetch({ access_token: 't', expires_in: 3600 });
    const credential = new K8sFederatedAadCredential({
      tenantId: 't',
      clientId: 'c',
      serviceAccountName: 'cast-runtime-sa',
      paths: { saTokenPath, saCaPath, saNamespacePath: saNsPath },
      k8sTokenRequester,
      fetchImpl: fetch,
    });
    await credential.getToken('scope');
    expect(captured[0]!.serviceAccountName).toBe('cast-runtime-sa');
  });
});
