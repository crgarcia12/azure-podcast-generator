import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dotnetToolsPath = path.join(os.homedir(), '.dotnet', 'tools');
const appHostPath = path.join(process.cwd(), 'apphost.cs');
const stateFileSuffix = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);

export const playwrightAspireStatePath = path.join(os.tmpdir(), `playwright-aspire-${stateFileSuffix}.json`);

export function ensureDotnetToolsOnPath(): void {
  if (!process.env.PATH?.split(path.delimiter).includes(dotnetToolsPath)) {
    process.env.PATH = process.env.PATH
      ? `${process.env.PATH}${path.delimiter}${dotnetToolsPath}`
      : dotnetToolsPath;
  }
}

export async function isServerRunning(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

export function isAspireRunning(): boolean {
  try {
    const output = execSync('aspire ps --format Json --nologo', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export function startAspireAndWaitForWeb(): void {
  execSync(`aspire start --apphost "${appHostPath}" --nologo`, {
    cwd: process.cwd(),
    stdio: 'inherit',
    timeout: 120000,
  });

  execSync(`aspire wait web --apphost "${appHostPath}" --status healthy --timeout 90 --nologo`, {
    cwd: process.cwd(),
    stdio: 'inherit',
    timeout: 100000,
  });
}

export function waitForWeb(): void {
  execSync(`aspire wait web --apphost "${appHostPath}" --status healthy --timeout 90 --nologo`, {
    cwd: process.cwd(),
    stdio: 'inherit',
    timeout: 100000,
  });
}

export function stopAspire(): void {
  execSync(`aspire stop --apphost "${appHostPath}" --nologo`, {
    cwd: process.cwd(),
    stdio: 'inherit',
    timeout: 20000,
  });
}

export function writeStartedState(): void {
  fs.writeFileSync(playwrightAspireStatePath, JSON.stringify({ startedAspire: true }));
}

export function didStartAspire(): boolean {
  try {
    const raw = fs.readFileSync(playwrightAspireStatePath, 'utf-8');
    const parsed = JSON.parse(raw) as { startedAspire?: boolean };
    return parsed.startedAspire === true;
  } catch {
    return false;
  }
}

export function clearStartedState(): void {
  fs.rmSync(playwrightAspireStatePath, { force: true });
}
