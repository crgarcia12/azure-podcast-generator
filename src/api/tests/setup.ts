import { beforeEach } from 'vitest';
import { clearUsers } from '../src/models/user-store.js';
import { clearPodcastEpisodes } from '../src/models/podcast-store.js';

beforeEach(() => {
  clearUsers();
  clearPodcastEpisodes();
});
