// Token credential that bridges a Kubernetes pod's projected service-account
// token to an Azure AD access token via federated identity (workload-identity-
// style flow), without depending on the AKS workload-identity webhook.
//
// Why this exists: in a Liliput dev preview the pod's Deployment template is
// auto-generated and we cannot add the workload-identity labels/annotations
// nor mount a custom projected token volume. The webhook therefore never
// runs and `WorkloadIdentityCredential` from `@azure/identity` cannot be
// configured. To still get an Azure access token without baking secrets into
// source code or shipping API keys, we drive the federation by hand:
//
//   1. Read the pod's existing SA token (audience kubernetes.default.svc) and
//      use it to call the K8s TokenRequest API for the same SA, asking for
//      audience `api://AzureADTokenExchange`. (Requires an RBAC RoleBinding
//      granting `create` on `serviceaccounts/token` for the SA.)
//   2. Use that JWT as a `client_assertion` against Azure AD's token
//      endpoint, naming a user-assigned managed identity that has a
//      federated credential pointing at the same K8s SA.
//   3. The resulting bearer token is what Azure OpenAI / Cognitive Services
//      accept as `Authorization: Bearer …`.
//
// The credential implements the `@azure/identity` `TokenCredential` interface
// so any Azure SDK client (or our raw fetch calls) can use it transparently.

import { readFile } from 'node:fs/promises';
import https from 'node:https';
import type { AccessToken, TokenCredential } from '@azure/core-auth';

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
const SA_TOKEN_PATH = `${SA_DIR}/token`;
const SA_CA_PATH = `${SA_DIR}/ca.crt`;
const SA_NAMESPACE_PATH = `${SA_DIR}/namespace`;

const AAD_AUDIENCE = 'api://AzureADTokenExchange';

interface K8sAadCredentialOptions {
  // The Azure AD tenant the user-assigned identity lives in.
  tenantId: string;
  // The clientId of the user-assigned managed identity to act as.
  clientId: string;
  // ServiceAccount name to mint a token for. Defaults to "default".
  serviceAccountName?: string;
  // Override paths for tests.
  paths?: {
    saTokenPath?: string;
    saCaPath?: string;
    saNamespacePath?: string;
  };
  // Override the K8s API endpoint (host:port). Defaults to
  // kubernetes.default.svc:443 from in-cluster service.
  kubernetesApiHost?: string;
  // Override the K8s TokenRequest call entirely — used by unit tests so
  // we don't need to spin up a self-signed HTTPS server.
  k8sTokenRequester?: (input: {
    namespace: string;
    serviceAccountName: string;
    saBearerToken: string;
    caCert: string;
    audience: string;
  }) => Promise<string>;
  // Override the global fetch — used by unit tests.
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  token: string;
  expiresOnTimestamp: number;
}

// Refresh AAD tokens this many seconds before their actual expiry to avoid
// using a token that's about to die mid-request.
const REFRESH_SKEW_SECONDS = 120;

export class K8sFederatedAadCredential implements TokenCredential {
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly serviceAccountName: string;
  private readonly saTokenPath: string;
  private readonly saCaPath: string;
  private readonly saNamespacePath: string;
  private readonly kubernetesApiHost: string;
  private readonly k8sTokenRequester?: K8sAadCredentialOptions['k8sTokenRequester'];
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, CachedToken>();
  // De-dupe in-flight fetches so concurrent requests for the same scope share
  // a single round-trip instead of stampeding the K8s + AAD endpoints.
  private readonly inflight = new Map<string, Promise<AccessToken>>();

  constructor(options: K8sAadCredentialOptions) {
    if (!options.tenantId) throw new Error('K8sFederatedAadCredential: tenantId is required');
    if (!options.clientId) throw new Error('K8sFederatedAadCredential: clientId is required');
    this.tenantId = options.tenantId;
    this.clientId = options.clientId;
    this.serviceAccountName = options.serviceAccountName ?? 'default';
    this.saTokenPath = options.paths?.saTokenPath ?? SA_TOKEN_PATH;
    this.saCaPath = options.paths?.saCaPath ?? SA_CA_PATH;
    this.saNamespacePath = options.paths?.saNamespacePath ?? SA_NAMESPACE_PATH;
    this.kubernetesApiHost = options.kubernetesApiHost ?? 'kubernetes.default.svc:443';
    this.k8sTokenRequester = options.k8sTokenRequester;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getToken(scopes: string | string[]): Promise<AccessToken> {
    const scopeList = Array.isArray(scopes) ? scopes : [scopes];
    const cacheKey = scopeList.slice().sort().join(' ');

    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresOnTimestamp - REFRESH_SKEW_SECONDS * 1000 > now) {
      return { token: cached.token, expiresOnTimestamp: cached.expiresOnTimestamp };
    }

    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const fetchPromise = this.fetchFreshToken(scopeList).then((tok) => {
      this.cache.set(cacheKey, { token: tok.token, expiresOnTimestamp: tok.expiresOnTimestamp });
      this.inflight.delete(cacheKey);
      return tok;
    }).catch((err) => {
      this.inflight.delete(cacheKey);
      throw err;
    });

    this.inflight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  private async fetchFreshToken(scopes: string[]): Promise<AccessToken> {
    const [saToken, namespaceRaw, caCert] = await Promise.all([
      readFile(this.saTokenPath, 'utf-8'),
      readFile(this.saNamespacePath, 'utf-8'),
      readFile(this.saCaPath, 'utf-8'),
    ]);
    const namespace = namespaceRaw.trim();

    const assertion = this.k8sTokenRequester
      ? await this.k8sTokenRequester({
          namespace,
          serviceAccountName: this.serviceAccountName,
          saBearerToken: saToken.trim(),
          caCert,
          audience: AAD_AUDIENCE,
        })
      : await this.requestK8sFederatedAssertion(saToken.trim(), namespace, caCert);
    return this.exchangeAssertionForAccessToken(assertion, scopes);
  }

  private requestK8sFederatedAssertion(
    saBearerToken: string,
    namespace: string,
    caCert: string,
  ): Promise<string> {
    const body = JSON.stringify({ spec: { audiences: [AAD_AUDIENCE] } });
    const [host, port = '443'] = this.kubernetesApiHost.split(':');
    const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/serviceaccounts/${encodeURIComponent(this.serviceAccountName)}/token`;

    return new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          method: 'POST',
          host,
          port: Number.parseInt(port, 10),
          path,
          ca: caCert,
          headers: {
            Authorization: `Bearer ${saBearerToken}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body).toString(),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf-8');
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(new Error(`K8s TokenRequest failed (${status}): ${data.slice(0, 400)}`));
              return;
            }
            try {
              const parsed = JSON.parse(data) as { status?: { token?: string } };
              const tok = parsed.status?.token;
              if (!tok) {
                reject(new Error('K8s TokenRequest returned no token'));
                return;
              }
              resolve(tok);
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        },
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private async exchangeAssertionForAccessToken(
    assertion: string,
    scopes: string[],
  ): Promise<AccessToken> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: scopes.join(' '),
    }).toString();

    const url = `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`AAD token exchange failed (${response.status}): ${text.slice(0, 400)}`);
    }

    const parsed = JSON.parse(text) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!parsed.access_token) {
      throw new Error('AAD token exchange returned no access_token');
    }
    const ttl = Number.isFinite(parsed.expires_in) ? Number(parsed.expires_in) : 3600;
    return {
      token: parsed.access_token,
      expiresOnTimestamp: Date.now() + ttl * 1000,
    };
  }
}

// Convenience factory: returns a credential when the env vars are configured,
// or `null` so callers can fall back to mock providers cleanly.
export function createK8sFederatedAadCredentialFromEnv(): K8sFederatedAadCredential | null {
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = (process.env.AZURE_OPENAI_CLIENT_ID || process.env.AZURE_CLIENT_ID)?.trim();
  if (!tenantId || !clientId) return null;
  return new K8sFederatedAadCredential({
    tenantId,
    clientId,
    serviceAccountName: process.env.AZURE_SERVICE_ACCOUNT?.trim() || 'default',
  });
}
