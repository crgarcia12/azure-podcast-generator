// Boot-time loader that copies the credentials in the Kubernetes Secret
// `liliput-azure-sp` into process.env so DefaultAzureCredential /
// ClientSecretCredential / our cast provider all see them.
//
// Liliput's deployer overwrites the Deployment manifest on every redeploy,
// so the user-supplied `envFrom: secretRef: name: liliput-azure-sp` cannot
// be persisted as part of the pod spec. To work around that without
// abandoning the standard env-var contract that DefaultAzureCredential
// expects, we read the Secret here at process startup using the pod's
// in-cluster ServiceAccount token (which has been granted `get` on this
// specific Secret via a Role/RoleBinding in the dev namespace).
//
// Keys we look for in the Secret data (all base64-encoded by Kubernetes):
//   AZURE_TENANT_ID
//   AZURE_CLIENT_ID
//   AZURE_CLIENT_SECRET
//   AZURE_OPENAI_ENDPOINT
//   AZURE_AI_FOUNDRY_ENDPOINT
//
// Behaviour:
//   * If the Secret can't be read (ENOENT, 403, 404, etc.) we log a warn
//     and return — the app keeps working with whatever env vars are
//     already set (e.g. local dev where you set them manually).
//   * env vars that are ALREADY set in the process environment win — the
//     operator can always override what's in the Secret by setting an
//     explicit env var.

import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { logger } from '../logger.js';

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
const SA_TOKEN_PATH = `${SA_DIR}/token`;
const SA_CA_PATH = `${SA_DIR}/ca.crt`;
const SA_NAMESPACE_PATH = `${SA_DIR}/namespace`;

const DEFAULT_SECRET_NAME = 'liliput-azure-sp';
// Keys we project from the Secret into process.env. Any key in this list
// that doesn't already have a value in env gets pulled from the Secret.
const PROJECTED_KEYS = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_AI_FOUNDRY_ENDPOINT',
] as const;

interface BootstrapOptions {
  secretName?: string;
  // Path overrides for tests.
  paths?: {
    saTokenPath?: string;
    saCaPath?: string;
    saNamespacePath?: string;
  };
  // Override the K8s API host for tests.
  kubernetesApiHost?: string;
  // Test seam — supply the raw decoded Secret data dictionary directly
  // so the unit test doesn't have to spin up an HTTPS server.
  fetchSecretData?: (input: {
    namespace: string;
    name: string;
  }) => Promise<Record<string, string> | null>;
}

interface BootstrapResult {
  loaded: boolean;
  source: 'env' | 'k8s-secret' | 'unavailable';
  appliedKeys: string[];
  reason?: string;
}

function alreadyHaveAllKeys(): boolean {
  return PROJECTED_KEYS.every((k) => Boolean(process.env[k]?.trim()));
}

async function fetchSecretViaK8sApi(input: {
  namespace: string;
  name: string;
  saBearerToken: string;
  caCert: string;
  apiHost: string;
}): Promise<Record<string, string> | null> {
  const { namespace, name, saBearerToken, caCert, apiHost } = input;
  const [host, port = '443'] = apiHost.split(':');
  const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        host,
        port: Number.parseInt(port, 10),
        path,
        ca: caCert,
        headers: {
          Authorization: `Bearer ${saBearerToken}`,
          Accept: 'application/json',
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
          if (status === 404) {
            resolve(null);
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new Error(`K8s GET secret failed (${status}): ${data.slice(0, 400)}`));
            return;
          }
          try {
            const parsed = JSON.parse(data) as { data?: Record<string, string> };
            const raw = parsed.data ?? {};
            const decoded: Record<string, string> = {};
            for (const [k, v] of Object.entries(raw)) {
              if (typeof v !== 'string') continue;
              try {
                decoded[k] = Buffer.from(v, 'base64').toString('utf-8');
              } catch {
                // skip malformed entries
              }
            }
            resolve(decoded);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
    );

    req.on('error', reject);
    req.end();
  });
}

export async function bootstrapAzureSecretEnv(
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  if (alreadyHaveAllKeys()) {
    return { loaded: true, source: 'env', appliedKeys: [] };
  }

  const secretName = options.secretName ?? DEFAULT_SECRET_NAME;
  const saTokenPath = options.paths?.saTokenPath ?? SA_TOKEN_PATH;
  const saCaPath = options.paths?.saCaPath ?? SA_CA_PATH;
  const saNamespacePath = options.paths?.saNamespacePath ?? SA_NAMESPACE_PATH;
  const apiHost = options.kubernetesApiHost ?? 'kubernetes.default.svc:443';

  let secretData: Record<string, string> | null = null;
  try {
    if (options.fetchSecretData) {
      const namespace = await readFile(saNamespacePath, 'utf-8').catch(() => 'default');
      secretData = await options.fetchSecretData({
        namespace: namespace.trim(),
        name: secretName,
      });
    } else {
      const [token, namespaceRaw, caCert] = await Promise.all([
        readFile(saTokenPath, 'utf-8'),
        readFile(saNamespacePath, 'utf-8'),
        readFile(saCaPath, 'utf-8'),
      ]);
      secretData = await fetchSecretViaK8sApi({
        namespace: namespaceRaw.trim(),
        name: secretName,
        saBearerToken: token.trim(),
        caCert,
        apiHost,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, secretName }, 'azure-secret-bootstrap: could not read K8s Secret — falling back to env');
    return { loaded: false, source: 'unavailable', appliedKeys: [], reason: message };
  }

  if (!secretData) {
    logger.warn({ secretName }, 'azure-secret-bootstrap: K8s Secret not found — falling back to env');
    return { loaded: false, source: 'unavailable', appliedKeys: [], reason: 'secret-not-found' };
  }

  const applied: string[] = [];
  for (const key of PROJECTED_KEYS) {
    if (process.env[key]?.trim()) continue;
    const value = secretData[key];
    if (typeof value === 'string' && value.trim()) {
      process.env[key] = value.trim();
      applied.push(key);
    }
  }

  // If we got a real client secret, force LLM_PROVIDER=azure unless the
  // operator explicitly turned it off. The Dockerfile sets this too, but
  // belt-and-braces in case the env was scrubbed.
  if (process.env.AZURE_CLIENT_SECRET?.trim() && !process.env.LLM_PROVIDER?.trim()) {
    process.env.LLM_PROVIDER = 'azure';
  }

  logger.info(
    {
      secretName,
      appliedKeys: applied,
      hasTenant: Boolean(process.env.AZURE_TENANT_ID),
      hasClient: Boolean(process.env.AZURE_CLIENT_ID),
      hasSecret: Boolean(process.env.AZURE_CLIENT_SECRET),
      openaiEndpoint: process.env.AZURE_OPENAI_ENDPOINT ?? null,
    },
    'azure-secret-bootstrap: projected K8s Secret into process.env',
  );

  return { loaded: applied.length > 0, source: 'k8s-secret', appliedKeys: applied };
}

export const __testing = {
  PROJECTED_KEYS,
};
