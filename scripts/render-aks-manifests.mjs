import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function renderTemplate(templatePath, outputPath, values) {
  const template = readFileSync(templatePath, 'utf8');
  const rendered = template.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
    const value = values[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Missing required manifest value: ${key}`);
    }

    return value;
  });

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered, 'utf8');
}

if (process.env.SERVICE_API_IMAGE_NAME) {
  renderTemplate(
    path.join(rootDir, 'src', 'api', 'manifests', 'api.yaml'),
    path.join(rootDir, 'src', 'api', 'manifests-generated', 'api.yaml'),
    {
      API_MANAGED_IDENTITY_CLIENT_ID: process.env.API_MANAGED_IDENTITY_CLIENT_ID,
      SERVICE_API_IMAGE_NAME: process.env.SERVICE_API_IMAGE_NAME
    }
  );
}

if (process.env.SERVICE_WEB_IMAGE_NAME) {
  renderTemplate(
    path.join(rootDir, 'src', 'web', 'manifests', 'web.yaml'),
    path.join(rootDir, 'src', 'web', 'manifests-generated', 'web.yaml'),
    {
      SERVICE_WEB_IMAGE_NAME: process.env.SERVICE_WEB_IMAGE_NAME
    }
  );
}
