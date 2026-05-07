import { Given, When, Then } from '@cucumber/cucumber';
import { CustomWorld } from '../support/world';
import assert from 'assert';

interface SegmentTurn {
  id: string;
  speaker: 'host' | 'guest';
  speakerLabel: 'Host' | 'Guest';
  text: string;
}

interface SteeredSegmentBody {
  segment?: {
    segmentId?: string;
    episodeId?: string;
    audioUrl?: string;
    durationSeconds?: number;
    transcript?: SegmentTurn[];
  };
  error?: string;
}

interface PodcastEpisodeBody {
  episode?: { id: string; transcript: SegmentTurn[] };
  error?: string;
}

declare module '../support/world' {
  interface CustomWorld {
    askEpisodeId?: string;
    askSegmentId?: string;
  }
}

// ── Generic helpers (some duplicate the auth-steps phrasing but use unique grammar) ─

When(
  'I send a POST request to {string} with json body:',
  async function (this: CustomWorld, path: string, body: string) {
    const parsed = JSON.parse(body);
    await this.apiRequest('POST', path, parsed);
  },
);

Given(
  'a user {string} exists with password {string}',
  async function (this: CustomWorld, username: string, password: string) {
    this.storedPasswords[username] = password;
    await this.apiRequest('POST', '/api/auth/register', { username, password });
  },
);

Given('the user {string} is signed in', async function (this: CustomWorld, username: string) {
  const password = this.storedPasswords[username];
  assert.ok(password, `No stored password for user "${username}"`);
  await this.apiRequest('POST', '/api/auth/login', { username, password });
  await this.syncCookiesToBrowser();
});

Given(
  'alex has generated an episode on the topic {string}',
  async function (this: CustomWorld, topic: string) {
    await this.apiRequest('POST', '/api/podcasts', { topic });
    const body = this.response?.body as PodcastEpisodeBody | null;
    assert.equal(this.response?.status, 201, 'Expected episode creation to return 201');
    assert.ok(body?.episode?.id, 'Expected episode id in response');
    this.askEpisodeId = body!.episode!.id;
  },
);

When(
  'alex submits the question {string} at {int} seconds',
  async function (this: CustomWorld, question: string, position: number) {
    assert.ok(this.askEpisodeId, 'Episode must be created first');
    await this.apiRequest(
      'POST',
      `/api/podcasts/${this.askEpisodeId}/questions`,
      { question, playbackPositionSeconds: position },
    );
    const body = this.response?.body as SteeredSegmentBody | null;
    if (this.response?.status === 200 && body?.segment?.segmentId) {
      this.askSegmentId = body.segment.segmentId;
    }
  },
);

Given(
  'alex has asked {string} at {int} seconds',
  async function (this: CustomWorld, question: string, position: number) {
    assert.ok(this.askEpisodeId, 'Episode must be created first');
    await this.apiRequest(
      'POST',
      `/api/podcasts/${this.askEpisodeId}/questions`,
      { question, playbackPositionSeconds: position },
    );
    const body = this.response?.body as SteeredSegmentBody | null;
    assert.equal(this.response?.status, 200, 'Expected question to be answered with 200');
    assert.ok(body?.segment?.segmentId, 'Expected a segmentId in response');
    this.askSegmentId = body!.segment!.segmentId!;
  },
);

When('alex requests the steered segment audio', async function (this: CustomWorld) {
  assert.ok(this.askEpisodeId && this.askSegmentId, 'Episode and segment must be set');
  const headers: Record<string, string> = {};
  if (this.cookies.length) headers['Cookie'] = this.cookies.join('; ');
  const res = await fetch(
    `${this.apiBaseUrl}/api/podcasts/${this.askEpisodeId}/segments/${this.askSegmentId}/audio`,
    { method: 'GET', headers },
  );
  this.response = { status: res.status, body: null, headers: res.headers };
});

// ── Assertions on the response — segment-specific phrasing ─────────

Then(
  'the steered segment response has a {string} string',
  function (this: CustomWorld, key: string) {
    const body = this.response?.body as SteeredSegmentBody | null;
    const segment = body?.segment as Record<string, unknown> | undefined;
    const value = segment?.[key];
    assert.equal(typeof value, 'string', `Expected segment.${key} to be a string`);
    assert.ok((value as string).length > 0, `Expected segment.${key} to be non-empty`);
  },
);

Then(
  'steered segment turn {int} speaker equals {string}',
  function (this: CustomWorld, oneBasedIndex: number, expected: string) {
    const body = this.response?.body as SteeredSegmentBody | null;
    const turn = body?.segment?.transcript?.[oneBasedIndex - 1];
    assert.ok(turn, `Expected a turn at index ${oneBasedIndex}`);
    assert.equal(turn.speaker, expected);
  },
);

Then(
  'the last steered segment turn speaker equals {string}',
  function (this: CustomWorld, expected: string) {
    const body = this.response?.body as SteeredSegmentBody | null;
    const turns = body?.segment?.transcript ?? [];
    assert.ok(turns.length > 0, 'Expected transcript turns');
    assert.equal(turns[turns.length - 1].speaker, expected);
  },
);

Then(
  'steered segment turn {int} text contains {string}',
  function (this: CustomWorld, oneBasedIndex: number, needle: string) {
    const body = this.response?.body as SteeredSegmentBody | null;
    const turn = body?.segment?.transcript?.[oneBasedIndex - 1];
    assert.ok(turn, `Expected a turn at index ${oneBasedIndex}`);
    assert.ok(
      turn.text.toLowerCase().includes(needle.toLowerCase()),
      `Expected turn ${oneBasedIndex} to contain "${needle}", got: ${turn.text}`,
    );
  },
);

Then(
  'the response content type starts with {string}',
  function (this: CustomWorld, prefix: string) {
    const ct = this.response?.headers.get('content-type') ?? '';
    assert.ok(ct.startsWith(prefix), `Expected content-type to start with "${prefix}", got: ${ct}`);
  },
);
