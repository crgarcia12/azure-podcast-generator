import fs from 'node:fs';
import path from 'node:path';

// ─── Configuration ──────────────────────────────────────────────────

const isTest = process.env.NODE_ENV === 'test';
const configuredDir = process.env.AUDIO_DIR;

// In test mode without explicit AUDIO_DIR, use memory-only storage
const memoryOnly = isTest && !configuredDir;
const audioDir = configuredDir ?? './data/audio';

// ─── LRU Memory Cache ───────────────────────────────────────────────

const LRU_MAX = 20;
const cache = new Map<string, Buffer>();
const lruKeys: string[] = [];

function cacheKey(sessionId: string, segmentId: string): string {
  return `${sessionId}/${segmentId}`;
}

function lruPut(key: string, value: Buffer): void {
  const idx = lruKeys.indexOf(key);
  if (idx !== -1) {
    lruKeys.splice(idx, 1);
  }
  lruKeys.push(key);
  cache.set(key, value);

  while (lruKeys.length > LRU_MAX) {
    const evicted = lruKeys.shift();
    if (evicted) {
      cache.delete(evicted);
    }
  }
}

function lruGet(key: string): Buffer | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    // Refresh position
    const idx = lruKeys.indexOf(key);
    if (idx !== -1) {
      lruKeys.splice(idx, 1);
    }
    lruKeys.push(key);
  }
  return value;
}

// ─── Disk Helpers ───────────────────────────────────────────────────

function segmentPath(sessionId: string, segmentId: string): string {
  return path.join(audioDir, sessionId, `${segmentId}.wav`);
}

function sessionDir(sessionId: string): string {
  return path.join(audioDir, sessionId);
}

// ─── Public API ─────────────────────────────────────────────────────

export function getSegmentAudio(segmentId: string, sessionId: string): Buffer | undefined {
  const key = cacheKey(sessionId, segmentId);

  // Check memory cache first
  const cached = lruGet(key);
  if (cached) {
    return cached;
  }

  if (memoryOnly) {
    return undefined;
  }

  // Try reading from disk
  const filePath = segmentPath(sessionId, segmentId);
  try {
    const data = fs.readFileSync(filePath);
    lruPut(key, data);
    return data;
  } catch {
    return undefined;
  }
}

export function setSegmentAudio(sessionId: string, segmentId: string, audio: Buffer): void {
  const key = cacheKey(sessionId, segmentId);
  lruPut(key, audio);

  if (memoryOnly) {
    return;
  }

  // Write to disk
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(segmentPath(sessionId, segmentId), audio);
}

export function deleteSessionAudio(sessionId: string): void {
  // Evict from memory cache
  const prefix = `${sessionId}/`;
  for (let i = lruKeys.length - 1; i >= 0; i--) {
    if (lruKeys[i].startsWith(prefix)) {
      cache.delete(lruKeys[i]);
      lruKeys.splice(i, 1);
    }
  }

  if (memoryOnly) {
    return;
  }

  // Remove directory from disk
  const dir = sessionDir(sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Directory may not exist — ignore
  }
}

export function clearAllAudio(): void {
  cache.clear();
  lruKeys.length = 0;

  if (memoryOnly) {
    return;
  }

  try {
    fs.rmSync(audioDir, { recursive: true, force: true });
  } catch {
    // May not exist — ignore
  }
}
