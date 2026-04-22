import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('POST /api/auth/change-password', () => {
  const app = createApp();

  async function registerAndLogin(username: string, password: string) {
    await request(app)
      .post('/api/auth/register')
      .send({ username, password });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username, password });

    const cookies = loginRes.headers['set-cookie'];
    return Array.isArray(cookies) ? cookies.join('; ') : cookies;
  }

  it('should return 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'oldpass123', newPassword: 'newpass123' });
    expect(res.status).toBe(401);
  });

  it('should return 400 when currentPassword is missing', async () => {
    const cookie = await registerAndLogin('cpuser1', 'securepass123');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ newPassword: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Current password and new password are required');
  });

  it('should return 400 when newPassword is missing', async () => {
    const cookie = await registerAndLogin('cpuser2', 'securepass123');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'securepass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Current password and new password are required');
  });

  it('should return 400 when newPassword is too short', async () => {
    const cookie = await registerAndLogin('cpuser3', 'securepass123');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'securepass123', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('New password must be at least 8 characters');
  });

  it('should return 400 when newPassword equals currentPassword', async () => {
    const cookie = await registerAndLogin('cpuser4', 'securepass123');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'securepass123', newPassword: 'securepass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('New password must be different from current password');
  });

  it('should return 401 when currentPassword is incorrect', async () => {
    const cookie = await registerAndLogin('cpuser5', 'securepass123');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'wrongpassword', newPassword: 'newpass12345' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Current password is incorrect');
  });

  it('should return 200 and change password successfully', async () => {
    const cookie = await registerAndLogin('cpuser6', 'securepass123');
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'securepass123', newPassword: 'newsecurepass456' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password changed successfully');

    // Verify old password no longer works
    const oldLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cpuser6', password: 'securepass123' });
    expect(oldLoginRes.status).toBe(401);

    // Verify new password works
    const newLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'cpuser6', password: 'newsecurepass456' });
    expect(newLoginRes.status).toBe(200);
  });
});
