import { createApp } from './app.js';
import { logger } from './logger.js';
import { bootstrapAzureSecretEnv } from './services/azure-secret-bootstrap.js';

const port = parseInt(process.env.PORT || '5001', 10);

// Pull AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / endpoints
// out of the in-cluster `liliput-azure-sp` Kubernetes Secret BEFORE we build
// the app, so the cast service's createAzureBeatProviderFromEnv() factory
// sees the credentials when it runs. Best-effort — if the bootstrap fails
// we still start the API (it'll just degrade to the mock provider until
// the env is repaired).
async function main(): Promise<void> {
  try {
    await bootstrapAzureSecretEnv();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'azure-secret-bootstrap threw; continuing without K8s-projected credentials',
    );
  }

  const app = createApp();

  app.listen(port, () => {
    logger.info(`API server listening on http://localhost:${port}`);
  });
}

void main();
