import { type Express, type Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { getUserByUsername, addUser, getUserById, getUsers } from '../models/user-store.js';
import { authMiddleware } from '../middleware/auth.js';

const getSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
};

const LOCAL_HOST_REGEX = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

const getRequestHostname = (req: Request): string | undefined =>
  req.get('x-forwarded-host')?.split(',')[0]?.trim().split(':')[0] ?? req.get('host')?.split(':')[0];

const shouldUseSecureCookies = (req: Request): boolean => {
  if (process.env.COOKIE_SECURE === 'true') {
    return true;
  }

  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  return !forwardedHost || !LOCAL_HOST_REGEX.test(forwardedHost);
};

const getLegacyLocalCookieDomain = (req: Request): string | undefined =>
  /^localhost$/i.test(getRequestHostname(req) ?? '') ? 'localhost' : undefined;

const getAuthCookieOptions = (req: Request, maxAge: number) => ({
  httpOnly: true,
  secure: shouldUseSecureCookies(req),
  sameSite: 'strict' as const,
  path: '/',
  maxAge,
});

const getAuthClearCookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: shouldUseSecureCookies(req),
  sameSite: 'strict' as const,
  path: '/',
});

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

function isRegistrationEnabled(): boolean {
  const value = process.env.REGISTRATION_ENABLED?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

export function mapAuthEndpoints(app: Express): void {
  app.get('/api/auth/registration-status', (_req, res) => {
    res.json({ enabled: isRegistrationEnabled() });
  });

  app.post('/api/auth/register', async (req, res) => {
    if (!isRegistrationEnabled()) {
      res.status(403).json({ error: 'Registration is currently closed. Please contact an administrator.' });
      return;
    }

    const { username, password } = req.body as { username?: string; password?: string };

    // Validate username first
    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      res.status(400).json({ error: 'Username must be between 3 and 30 characters and contain only letters, numbers, and underscores' });
      return;
    }

    // Validate password
    if (!password) {
      res.status(400).json({ error: 'Password is required' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check uniqueness
    if (getUserByUsername(username)) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const role = getUsers().size === 0 ? 'admin' : 'user';

    const userId = crypto.randomUUID();
    addUser({
      id: userId,
      username,
      passwordHash,
      role,
      createdAt: new Date(),
    });

    const token = jwt.sign(
      { sub: userId, username, role },
      getSecret(),
      { expiresIn: '24h' },
    );

    res.cookie('token', token, getAuthCookieOptions(req, 86400 * 1000));

    res.status(201).json({ message: 'Registration successful', role });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = getUserByUsername(username);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      getSecret(),
      { expiresIn: '24h' },
    );

    res.cookie('token', token, getAuthCookieOptions(req, 86400 * 1000));

    res.status(200).json({ message: 'Login successful' });
  });

  app.post('/api/auth/logout', (req, res) => {
    const clearOptions = getAuthClearCookieOptions(req);
    const legacyCookieDomain = getLegacyLocalCookieDomain(req);

    res.cookie('token', '', {
      ...clearOptions,
      expires: new Date(0),
      maxAge: 0,
    });
    if (legacyCookieDomain) {
      res.cookie('token', '', {
        ...clearOptions,
        domain: legacyCookieDomain,
        expires: new Date(0),
        maxAge: 0,
      });
    }

    res.status(200).json({ message: 'Logged out successfully' });
  });

  app.get('/api/auth/me', authMiddleware, (req, res) => {
    const user = getUserById(req.user!.sub);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    res.status(200).json({
      username: user.username,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    });
  });
}
