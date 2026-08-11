import { Before, After, AfterStep, BeforeAll, AfterAll, setDefaultTimeout } from '@cucumber/cucumber';
import { CustomWorld } from './world';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';

setDefaultTimeout(30_000);

const DOTNET_TOOLS_PATH = path.join(os.homedir(), '.dotnet', 'tools');
if (!process.env.PATH?.split(path.delimiter).includes(DOTNET_TOOLS_PATH)) {
  process.env.PATH = process.env.PATH
    ? `${process.env.PATH}${path.delimiter}${DOTNET_TOOLS_PATH}`
    : DOTNET_TOOLS_PATH;
}

const SCREENSHOT_BASE_DIR = path.resolve(process.cwd(), 'docs', 'screenshots');
const GENERATE_SCREENSHOTS = process.env.GENERATE_SCREENSHOTS === 'true';
const WEB_URL = process.env.WEB_URL || 'http://localhost:3001';
const API_URL = process.env.API_URL || 'http://localhost:5001';
const APPHOST_PATH = path.resolve(process.cwd(), 'apphost.cs');

let aspireStarted = false;
const standaloneProcesses: ChildProcess[] = [];

async function isServerRunning(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

function isAspireRunning(): boolean {
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

function isAspireAvailable(): boolean {
  try {
    execSync('aspire --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerRunning(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startStandaloneServices(): void {
  const apiPort = new URL(API_URL).port || '5001';
  const webPort = new URL(WEB_URL).port || '3000';
  const detached = process.platform !== 'win32';

  standaloneProcesses.push(
    spawn('npm', ['run', 'dev:api'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      detached,
      env: {
        ...process.env,
        PORT: apiPort,
        DB_PATH: ':memory:',
        JWT_SECRET: process.env.JWT_SECRET || 'cucumber-test-secret',
        PODCAST_PROVIDER: 'mock',
      },
    }),
    spawn('npm', ['run', 'dev'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      detached,
      env: {
        ...process.env,
        PORT: webPort,
        NEXT_PUBLIC_API_URL: API_URL,
      },
    }),
  );
}

function stopStandaloneProcess(child: ChildProcess): void {
  if (child.killed || child.pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

BeforeAll(async function () {
  fs.mkdirSync(SCREENSHOT_BASE_DIR, { recursive: true });

  if (!(await isServerRunning(`${API_URL}/health`))) {
    if (!isAspireAvailable()) {
      console.log('Aspire CLI not found; starting API and Web directly...');
      startStandaloneServices();
      await Promise.all([
        waitForServer(`${API_URL}/health`),
        waitForServer(WEB_URL),
      ]);
      return;
    }

    if (!isAspireRunning()) {
      console.log('Starting Aspire AppHost...');
      execSync(`aspire start --apphost "${APPHOST_PATH}" --nologo`, {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 60000,
      });
      aspireStarted = true;
    }

    // Wait for API to be healthy
    console.log('Waiting for API to be healthy...');
    execSync(`aspire wait api --apphost "${APPHOST_PATH}" --status healthy --timeout 60 --nologo`, {
      stdio: 'inherit',
      timeout: 70000,
    });

    // Wait for Web to be healthy when generating screenshots or running @ui tests
    if (GENERATE_SCREENSHOTS) {
      console.log('Waiting for Web to be healthy...');
      execSync(`aspire wait web --apphost "${APPHOST_PATH}" --status healthy --timeout 60 --nologo`, {
        stdio: 'inherit',
        timeout: 70000,
      });
    }
  }
});

Before(async function (this: CustomWorld, { pickle, gherkinDocument }) {
  // Reset stores for test isolation
  try {
    await fetch(`${API_URL}/api/test/reset`, { method: 'POST' });
  } catch { /* server may not be ready yet */ }

  this.featureName = gherkinDocument?.feature?.name || 'unknown-feature';
  this.scenarioName = pickle.name || 'unknown-scenario';
  this.stepIndex = 0;

  await this.openBrowser();
  // Navigate to the actual app so screenshots aren't blank
  if (this.page) {
    try {
      await this.page.goto(WEB_URL, { waitUntil: 'networkidle', timeout: 15000 });
    } catch {
      // App may not be fully loaded yet — still take screenshots
      try { await this.page.goto(WEB_URL, { waitUntil: 'domcontentloaded', timeout: 10000 }); } catch { /* best effort */ }
    }
  }
});

AfterStep(async function (this: CustomWorld, { pickleStep, result }) {
  this.stepIndex++;
  if (this.page && GENERATE_SCREENSHOTS) {
    const stepText = pickleStep?.text || `step-${this.stepIndex}`;
    // Extract Gherkin keyword from the step text (Given/When/Then/And)
    const keyword = (pickleStep as any)?.keyword?.trim() ||
      (stepText.match(/^(Given|When|Then|And|But)\b/)?.[1] ?? 'Step');
    const status = result?.status?.toString() || 'PASSED';
    // Inject visual overlay showing current step context
    await this.injectStepOverlay(keyword, stepText, status);
    await this.takeStepScreenshot(stepText);
  }
});

After(async function (this: CustomWorld, { result }) {
  if (this.page) {
    // Only mark as failure for actually FAILED tests — not pending or skipped
    let status: string;
    switch (result?.status) {
      case 'PASSED':
        status = 'final';
        break;
      case 'FAILED':
        status = 'failure';
        break;
      case 'PENDING':
      case 'SKIPPED':
      case 'UNDEFINED':
        status = 'skipped';
        break;
      default:
        status = 'final';
    }
    const dir = this.screenshotDir;
    fs.mkdirSync(dir, { recursive: true });
    try {
      await this.page.screenshot({
        path: path.join(dir, `999-${status}.png`),
        fullPage: true,
      });
    } catch { /* Browser may already be closed */ }
  }
  await this.closeBrowser();
});

AfterAll(async function () {
  if (aspireStarted) {
    try {
      execSync(`aspire stop --apphost "${APPHOST_PATH}" --nologo`, {
        stdio: 'inherit',
        timeout: 15000,
      });
    } catch { /* already stopped */ }
    aspireStarted = false;
  }

  for (const child of standaloneProcesses) {
    stopStandaloneProcess(child);
  }
  standaloneProcesses.length = 0;
});
