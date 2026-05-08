import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('CORS middleware', () => {
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

  beforeEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  });

  it('allows requests with no Origin header (curl, server-to-server)', async () => {
    const app = createApp();
    const res = await request(app).get('/api/info');
    expect(res.status).toBe(200);
  });

  it('allows browser requests where Origin matches X-Forwarded-Host (same-origin via reverse proxy)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/info')
      .set('Origin', 'http://dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Host', 'dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Proto', 'http');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://dev.liliput.crgarcia.com.ar');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows POST /api/auth/register from same origin via reverse proxy (regression: was 500 before fix)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'http://dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Host', 'dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Proto', 'http')
      .send({ username: 'corsuser', password: 'securepass123' });
    expect(res.status).toBe(201);
  });

  it('allows configured ALLOWED_ORIGINS values', async () => {
    process.env.ALLOWED_ORIGINS = 'https://example.com,https://app.example.com';
    const app = createApp();
    const res = await request(app).get('/api/info').set('Origin', 'https://example.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
  });

  it('rejects cross-origin requests with 403 (not 500) when origin is not allowed', async () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    const app = createApp();
    const res = await request(app)
      .get('/api/info')
      .set('Origin', 'http://evil.example.com')
      .set('X-Forwarded-Host', 'dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Proto', 'http');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: expect.stringMatching(/not allowed by CORS/i),
    });
  });

  it('honours X-Forwarded-Scheme=https when X-Forwarded-Proto is http (AKS nginx-ingress quirk)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/info')
      .set('Origin', 'https://dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Host', 'dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Proto', 'http')
      .set('X-Forwarded-Scheme', 'https')
      .set('X-Forwarded-Port', '443');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://dev.liliput.crgarcia.com.ar');
  });

  it('upgrades to https when X-Forwarded-Proto=http but X-Forwarded-Port=443 (no X-Forwarded-Scheme)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/info')
      .set('Origin', 'https://dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Host', 'dev.liliput.crgarcia.com.ar')
      .set('X-Forwarded-Proto', 'http')
      .set('X-Forwarded-Port', '443');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://dev.liliput.crgarcia.com.ar');
  });

  it('falls back to Host header when X-Forwarded-Host is absent (local dev)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/info')
      .set('Host', 'localhost:8080')
      .set('Origin', 'http://localhost:8080');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8080');
  });
});
