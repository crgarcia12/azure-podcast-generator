import crypto from 'node:crypto';
import { getDatabase } from './database.js';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  interruptId?: string;
  createdAt: string;
}

export function addChatMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  interruptId?: string;
}): ChatMessage {
  const db = getDatabase();
  const msg: ChatMessage = {
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    role: params.role,
    content: params.content,
    interruptId: params.interruptId,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    'INSERT INTO chat_messages (id, session_id, role, content, interrupt_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(msg.id, msg.sessionId, msg.role, msg.content, msg.interruptId ?? null, msg.createdAt);
  return msg;
}

export function getChatMessages(sessionId: string): ChatMessage[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT id, session_id, role, content, interrupt_id, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as Array<{
    id: string;
    session_id: string;
    role: string;
    content: string;
    interrupt_id: string | null;
    created_at: string;
  }>;
  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    interruptId: row.interrupt_id ?? undefined,
    createdAt: row.created_at,
  }));
}

export function clearChatMessages(): void {
  getDatabase().prepare('DELETE FROM chat_messages').run();
}
