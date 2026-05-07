import express from 'express';
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

function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins?.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
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
  const allowedOrigins = new Set(getAllowedOrigins());

  seedConfiguredAdminUser();

  // Middleware
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS'));
    },
  }));
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
