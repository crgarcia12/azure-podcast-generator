import { beforeEach } from 'vitest';
import { getDatabase } from '../src/models/database.js';
import { clearUsers } from '../src/models/user-store.js';
import { clearPodcastEpisodes } from '../src/models/podcast-store.js';
import { clearSessions } from '../src/models/session-store.js';
import { clearAllAudio } from '../src/models/audio-store.js';

// Initialize in-memory DB for tests (singleton — all subsequent getDatabase() calls reuse this)
getDatabase(':memory:');

beforeEach(() => {
  clearUsers();
  clearPodcastEpisodes();
  clearSessions();
  clearAllAudio();
});
