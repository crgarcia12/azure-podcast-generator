import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyRuntimeDefaults } from '../../src/config/runtime-defaults.js';

describe('applyRuntimeDefaults', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalRegistrationEnabled = process.env.REGISTRATION_ENABLED;
  const originalSeedAdminPassword = process.env.SEED_ADMIN_PASSWORD;

  beforeEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.REGISTRATION_ENABLED;
    delete process.env.SEED_ADMIN_PASSWORD;
  });

  afterEach(() => {
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }
    if (originalRegistrationEnabled === undefined) {
      delete process.env.REGISTRATION_ENABLED;
    } else {
      process.env.REGISTRATION_ENABLED = originalRegistrationEnabled;
    }
    if (originalSeedAdminPassword === undefined) {
      delete process.env.SEED_ADMIN_PASSWORD;
    } else {
      process.env.SEED_ADMIN_PASSWORD = originalSeedAdminPassword;
    }
  });

  it('generates JWT_SECRET when not set', () => {
    applyRuntimeDefaults();
    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.JWT_SECRET!.length).toBeGreaterThanOrEqual(32);
  });

  it('preserves explicit JWT_SECRET', () => {
    process.env.JWT_SECRET = 'explicit-secret-value';
    applyRuntimeDefaults();
    expect(process.env.JWT_SECRET).toBe('explicit-secret-value');
  });

  it('defaults REGISTRATION_ENABLED to "true" when no SEED_ADMIN_PASSWORD is set', () => {
    applyRuntimeDefaults();
    expect(process.env.REGISTRATION_ENABLED).toBe('true');
  });

  it('defaults REGISTRATION_ENABLED to "false" when SEED_ADMIN_PASSWORD is set', () => {
    process.env.SEED_ADMIN_PASSWORD = 'admin-secret';
    applyRuntimeDefaults();
    expect(process.env.REGISTRATION_ENABLED).toBe('false');
  });

  it('preserves explicit REGISTRATION_ENABLED even when SEED_ADMIN_PASSWORD is set', () => {
    process.env.REGISTRATION_ENABLED = 'true';
    process.env.SEED_ADMIN_PASSWORD = 'admin-secret';
    applyRuntimeDefaults();
    expect(process.env.REGISTRATION_ENABLED).toBe('true');
  });

  it('preserves explicit REGISTRATION_ENABLED=false', () => {
    process.env.REGISTRATION_ENABLED = 'false';
    applyRuntimeDefaults();
    expect(process.env.REGISTRATION_ENABLED).toBe('false');
  });
});
