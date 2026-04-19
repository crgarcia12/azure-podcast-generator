import { clearStartedState, didStartAspire, ensureDotnetToolsOnPath, stopAspire } from './aspire-lifecycle';

export default async function globalTeardown(): Promise<void> {
  ensureDotnetToolsOnPath();

  if (process.env.PLAYWRIGHT_BASE_URL || !didStartAspire()) {
    clearStartedState();
    return;
  }

  try {
    stopAspire();
  } finally {
    clearStartedState();
  }
}
