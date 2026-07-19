import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { hashSync } from 'bcryptjs';
import { logger } from './logger.js';
import { mapHealthEndpoints } from './routes/health.js';
import { mapChatEndpoints } from './routes/chat.js';
import { mapAuthEndpoints } from './routes/auth.js';
import { mapAdminEndpoints } from './routes/admin.js';
import { mapPodcastEndpoints } from './routes/podcasts.js';
import { mapSessionEndpoints } from './routes/sessions.js';
import { mapCastEndpoints } from './routes/cast.js';
import { clearUsers, addUser, getUserByUsername, deleteUser } from './models/user-store.js';
import { clearPodcastEpisodes } from './models/podcast-store.js';
import { clearSessions } from './models/session-store.js';
import { createPodcastService, type PodcastService } from './services/podcast-service.js';
import { createInteractiveSessionService, type InteractiveSessionService } from './services/interactive-session-service.js';
import { createCastService, type CastService } from './services/cast-service.js';
import { createAzureBeatProviderFromEnv } from './services/cast-service-azure.js';
import { applyRuntimeDefaults } from './config/runtime-defaults.js';

interface AppDependencies {
  podcastService?: PodcastService;
  interactiveSessionService?: InteractiveSessionService;
  castService?: CastService;
}

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:3001'];

function getConfiguredAllowedOrigins(): string[] {
  const configuredOrigins = process.env.ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins?.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
}

// Reconstruct the same-origin URL the browser sees, using the first hop's
// X-Forwarded-Host / X-Forwarded-Proto headers that the reverse proxy sets.
// Falls back to the Host header when running locally without a proxy.
//
// Some ingress controllers (notably nginx-ingress in front of AKS) populate
// `X-Forwarded-Proto` with the scheme of the *internal* hop (often `http`)
// while exposing the original public scheme on `X-Forwarded-Scheme` /
// `X-Scheme`, with `X-Forwarded-Port` reflecting the real public port.
// Honour those alternates so that the same-origin check still matches the
// browser's `Origin: https://...` when the public URL was HTTPS.
//
// Returns null when neither host source is present.
function getRequestSameOrigin(req: Request): string | null {
  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost =
    (typeof forwardedHost === 'string' ? forwardedHost : forwardedHost?.[0]) ?? req.headers.host ?? '';
  const host = String(rawHost).split(',')[0]?.trim();
  if (!host) {
    return null;
  }
  const proto = resolveForwardedProto(req);
  return `${proto}://${host}`;
}

function pickHeaderValue(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  const value = typeof raw === 'string' ? raw : raw?.[0];
  return value ? String(value).split(',')[0]?.trim() : undefined;
}

// Pick the proto the *browser* used to reach the edge. Prefer headers that
// reflect the public scheme over X-Forwarded-Proto, which some proxies fill
// with the (internal) request scheme to the next hop.
function resolveForwardedProto(req: Request): string {
  for (const header of ['x-forwarded-scheme', 'x-scheme', 'x-forwarded-proto']) {
    const value = pickHeaderValue(req, header)?.toLowerCase();
    if (value === 'https' || value === 'http') {
      // X-Forwarded-Port wins when X-Forwarded-Proto disagrees with it: a
      // public 443 with proto=http is the smoking gun of the AKS nginx-ingress
      // bug that bites browsers behind https.
      if (header === 'x-forwarded-proto' && value === 'http') {
        const port = pickHeaderValue(req, 'x-forwarded-port');
        if (port === '443') {
          return 'https';
        }
      }
      return value;
    }
  }
  return req.secure ? 'https' : 'http';
}

function seedConfiguredAdminUser(): void {
  const username = process.env.SEED_ADMIN_USERNAME?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD?.trim();

  if (!username || !password || getUserByUsername(username)) {
    return;
  }

  addUser({
    id: randomUUID(),
    username,
    passwordHash: hashSync(password, 10),
    role: 'admin',
    createdAt: new Date(),
  });
}

export function createApp(dependencies: AppDependencies = {}): express.Express {
  applyRuntimeDefaults();

  const app = express();
  const podcastService = dependencies.podcastService ?? createPodcastService();
  const interactiveSessionService = dependencies.interactiveSessionService ?? createInteractiveSessionService();
  const castService = dependencies.castService ?? createCastService(createAzureBeatProviderFromEnv() ?? undefined);
  const configuredAllowedOrigins = new Set(getConfiguredAllowedOrigins());

  seedConfiguredAdminUser();

  // Middleware
  app.use(helmet());
  app.use(
    cors((req, callback) => {
      const sameOrigin = getRequestSameOrigin(req as Request);
      callback(null, {
        credentials: true,
        origin(origin, originCallback) {
          // No Origin header (server-to-server, curl) — always allow.
          if (!origin) {
            originCallback(null, true);
            return;
          }
          // Explicitly configured allow-list match.
          if (configuredAllowedOrigins.has(origin)) {
            originCallback(null, true);
            return;
          }
          // Same-origin request through a reverse proxy: the browser's Origin
          // matches the URL it used to reach us. This makes the app work behind
          // any proxy (Liliput, Container Apps, etc.) without per-environment
          // ALLOWED_ORIGINS config.
          if (sameOrigin && origin === sameOrigin) {
            originCallback(null, true);
            return;
          }
          originCallback(new Error(`Origin ${origin} not allowed by CORS`));
        },
      });
    }),
  );

  // Convert CORS rejections from a generic 500 into a clear 403 so callers
  // get an actionable response instead of an opaque internal error.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof Error && /not allowed by CORS/i.test(err.message)) {
      res.status(403).json({ error: err.message });
      return;
    }
    next(err);
  });

  app.use(express.json());
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  // Routes
  mapHealthEndpoints(app);
  mapChatEndpoints(app);
  mapAuthEndpoints(app);
  mapAdminEndpoints(app);
  mapPodcastEndpoints(app, podcastService);
  mapSessionEndpoints(app, interactiveSessionService);
  mapCastEndpoints(app, castService);

  // Test-only: reset endpoint for e2e test isolation
  if (process.env.NODE_ENV !== 'production') {
    app.post('/api/test/reset', (_req, res) => {
      clearUsers();
      clearPodcastEpisodes();
      clearSessions();
      res.json({ message: 'Store cleared' });
    });

    app.post('/api/test/create-user', async (req, res) => {
      const { username, password, role, createdAt } = req.body;
      const bcrypt = await import('bcryptjs');
      const crypto = await import('node:crypto');
      const passwordHash = await bcrypt.default.hash(password, 10);
      addUser({
        id: crypto.randomUUID(),
        username,
        passwordHash,
        role: role || 'user',
        createdAt: createdAt ? new Date(createdAt) : new Date(),
      });
      res.json({ message: 'User created' });
    });

    app.get('/api/test/user-hash/:username', (req, res) => {
      const user = getUserByUsername(req.params.username);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({ passwordHash: user.passwordHash });
    });

    app.delete('/api/test/users/:username', (req, res) => {
      const user = getUserByUsername(req.params.username);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      deleteUser(user.id);
      res.json({ message: 'User deleted' });
    });
  }

  return app;
}
