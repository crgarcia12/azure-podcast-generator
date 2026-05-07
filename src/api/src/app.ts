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
import { clearUsers, addUser, getUserByUsername, deleteUser } from './models/user-store.js';
import { clearPodcastEpisodes } from './models/podcast-store.js';
import { clearSessions } from './models/session-store.js';
import { createPodcastService, type PodcastService } from './services/podcast-service.js';
import { createInteractiveSessionService, type InteractiveSessionService } from './services/interactive-session-service.js';
import { applyRuntimeDefaults } from './config/runtime-defaults.js';

interface AppDependencies {
  podcastService?: PodcastService;
  interactiveSessionService?: InteractiveSessionService;
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
// Returns null when neither is present.
function getRequestSameOrigin(req: Request): string | null {
  const forwardedHost = req.headers['x-forwarded-host'];
  const rawHost =
    (typeof forwardedHost === 'string' ? forwardedHost : forwardedHost?.[0]) ?? req.headers.host ?? '';
  const host = String(rawHost).split(',')[0]?.trim();
  if (!host) {
    return null;
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  const rawProto =
    (typeof forwardedProto === 'string' ? forwardedProto : forwardedProto?.[0]) ??
    (req.secure ? 'https' : 'http');
  const proto = String(rawProto).split(',')[0]?.trim().toLowerCase() || 'http';
  return `${proto}://${host}`;
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
