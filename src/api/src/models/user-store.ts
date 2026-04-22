import { getDatabase } from './database.js';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'user' | 'admin';
  createdAt: Date;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role as 'user' | 'admin',
    createdAt: new Date(row.created_at),
  };
}

export function getUsers(): Map<string, User> {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM users').all() as UserRow[];
  const map = new Map<string, User>();
  for (const row of rows) {
    map.set(row.id, rowToUser(row));
  }
  return map;
}

export function getUserByUsername(username: string): User | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export function getUserById(id: string): User | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export function addUser(user: User): void {
  const db = getDatabase();
  db.prepare(
    'INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(user.id, user.username, user.passwordHash, user.role, user.createdAt.toISOString());
}

export function clearUsers(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM users').run();
}

export function deleteUser(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function getAllUsers(): User[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM users').all() as UserRow[];
  return rows.map(rowToUser);
}
