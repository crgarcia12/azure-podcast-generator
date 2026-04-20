import type { BrowserContext, Page } from '@playwright/test';

const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:5001';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function getBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001';
}

export function isRemoteEnvironment(): boolean {
  const hostname = new URL(getBaseUrl()).hostname.toLowerCase();
  return !LOCAL_HOSTS.has(hostname);
}

export function getApiBaseUrl(): string {
  const configuredApiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL?.trim().replace(/\/$/, '');
  if (configuredApiBaseUrl) {
    return configuredApiBaseUrl;
  }

  if (!isRemoteEnvironment()) {
    return DEFAULT_LOCAL_API_BASE_URL;
  }

  return getBaseUrl().replace(/\/$/, '');
}

export async function resetAppState(context: BrowserContext): Promise<void> {
  if (!isRemoteEnvironment()) {
    const response = await context.request.post(`${getApiBaseUrl()}/api/test/reset`);
    if (!response.ok()) {
      throw new Error(`Failed to reset test state (${response.status()})`);
    }
  }

  await context.clearCookies();
}

export async function registerUser(page: Page, username: string, password: string): Promise<void> {
  const response = await page.request.post(`${getApiBaseUrl()}/api/auth/register`, {
    data: { username, password },
  });

  if (!response.ok()) {
    throw new Error(`Failed to register user ${username} (${response.status()})`);
  }
}

export async function loginUser(page: Page, username: string, password: string): Promise<void> {
  const response = await page.request.post(`${getApiBaseUrl()}/api/auth/login`, {
    data: { username, password },
  });

  if (!response.ok()) {
    throw new Error(`Failed to log in user ${username} (${response.status()})`);
  }
}

export function uniqueUser(prefix = 'user'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getAdminCredentials(): { username: string; password: string } {
  const username = process.env.E2E_ADMIN_USERNAME?.trim();
  const password = process.env.E2E_ADMIN_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error('E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required for remote admin tests.');
  }

  return { username, password };
}
