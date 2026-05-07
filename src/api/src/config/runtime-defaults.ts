import crypto from 'node:crypto';
import { logger } from '../logger.js';

/**
 * Apply dev-preview-safe defaults for runtime environment variables.
 *
 * These defaults make the app usable out-of-the-box in environments where
 * configuration is not explicitly provided (e.g. ephemeral preview deploys
 * such as Liliput). They are NOT applied when the operator has supplied
 * an explicit value, so production deployments remain in full control.
 *
 * Conventions mirrored from .github/workflows/deploy.yml:
 *   - REGISTRATION_ENABLED defaults to "true" UNLESS SEED_ADMIN_PASSWORD
 *     is set (then it defaults to "false", because admin manages users).
 *   - JWT_SECRET, when missing, is generated at boot with a warning.
 *     Tokens become invalid on restart, which is fine for dev previews.
 */
export function applyRuntimeDefaults(): void {
  applyJwtSecretDefault();
  applyRegistrationEnabledDefault();
}

function applyJwtSecretDefault(): void {
  if (process.env.JWT_SECRET?.trim()) {
    return;
  }

  const generated = crypto.randomBytes(48).toString('base64url');
  process.env.JWT_SECRET = generated;
  logger.warn(
    'JWT_SECRET was not set; generated a random secret for this process. ' +
      'Tokens will be invalidated on restart. Set JWT_SECRET explicitly for stable sessions.',
  );
}

function applyRegistrationEnabledDefault(): void {
  if (process.env.REGISTRATION_ENABLED?.trim()) {
    return;
  }

  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
  const defaultValue = seedAdminPassword ? 'false' : 'true';
  process.env.REGISTRATION_ENABLED = defaultValue;
  logger.info(
    { REGISTRATION_ENABLED: defaultValue, reason: seedAdminPassword ? 'SEED_ADMIN_PASSWORD set' : 'no SEED_ADMIN_PASSWORD' },
    'REGISTRATION_ENABLED was not set; applied default.',
  );
}
