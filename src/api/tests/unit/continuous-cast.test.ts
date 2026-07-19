import { describe, expect, it } from 'vitest';
import {
  createCastService,
  normalizeQuestion,
  type BeatProvider,
  type CastBatchRequest,
  type CastSegment,
} from '../../src/services/cast-service.js';

process.env.CAST_SEGMENT_PACE_MS = '0';

function makeProvider(wordCountPerAnswer = 40): {
  provider: BeatProvider;
  requests: CastBatchRequest[];
} {
  const requests: CastBatchRequest[] = [];
  const provider: BeatProvider = {
    providerName: 'test',
    modelDisplayName: 'test',
    buildSystemPrompt: () => 'test',
    buildOutline: async () => [],
    async buildBatch(request) {
      requests.push(request);
      return Array.from({ length: 5 }, (_, index) => ({
        hostLine: `What is angle ${request.sequence}-${index} of ${request.topic}?`,
        guestLine: Array.from(
          { length: wordCountPerAnswer },
          (__, wordIndex) => `answer-${request.sequence}-${index}-${wordIndex}`,
        ).join(' '),
      }));
    },
    buildAnswerBeats: async () => [],
  };
  return { provider, requests };
}

async function drain(
  service: ReturnType<typeof createCastService>,
  sessionId: string,
): Promise<CastSegment[]> {
  const segments: CastSegment[] = [];
  const abort = new AbortController();
  for await (const segment of service.generateStream(sessionId, abort.signal)) {
    segments.push(segment);
  }
  return segments;
}

describe('continuous cast generation', () => {
  it('requests ordered multi-exchange batches until the duration target is reached', async () => {
    const { provider, requests } = makeProvider(40);
    const service = createCastService(provider, { wordsPerMinute: 150 });
    const session = service.startSession('History of Boeing', { targetDurationMinutes: 3 });

    const segments = await drain(service, session.id);
    const progress = service.getProgress(session.id);

    expect(requests.length).toBeGreaterThan(1);
    expect(segments).toHaveLength(requests.length * 10);
    expect(progress?.generatedDurationMinutes).toBeGreaterThanOrEqual(3);
    expect(progress?.state).toBe('complete');
    expect(progress?.completionReason).toBe('target-reached');
  });

  it('passes covered host questions to every provider call after the first', async () => {
    const { provider, requests } = makeProvider();
    const service = createCastService(provider);
    const session = service.startSession('History of Boeing', { targetDurationMinutes: 3 });

    await drain(service, session.id);

    expect(requests[0]?.coveredQuestions).toEqual([]);
    expect(requests[1]?.coveredQuestions.length).toBeGreaterThanOrEqual(5);
    expect(requests[1]?.coveredQuestions).toContain('What is angle 1-1 of History of Boeing?');
  });

  it('normalizes punctuation and case when rejecting repeated host questions', async () => {
    let sequence = 0;
    const provider: BeatProvider = {
      providerName: 'duplicate-test',
      modelDisplayName: 'duplicate-test',
      buildSystemPrompt: () => 'test',
      buildOutline: async () => [],
      async buildBatch() {
        sequence += 1;
        return Array.from({ length: 5 }, (_, index) => ({
          hostLine:
            sequence === 2 && index === 0
              ? '  WHAT is angle 1-0 of History of Boeing!!! '
              : `What is angle ${sequence}-${index} of History of Boeing?`,
          guestLine: Array.from({ length: 40 }, (__, i) => `word-${sequence}-${index}-${i}`).join(' '),
        }));
      },
      buildAnswerBeats: async () => [],
    };
    const service = createCastService(provider);
    const session = service.startSession('History of Boeing', { targetDurationMinutes: 0.5 });

    const segments = await drain(service, session.id);
    const questions = segments.filter((segment) => segment.speaker === 'host').map((segment) => segment.text);
    const normalized = questions.map(normalizeQuestion);

    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it('stops without requesting another provider batch', async () => {
    const { provider, requests } = makeProvider();
    const service = createCastService(provider);
    const session = service.startSession('History of Boeing');

    service.stopSession(session.id);
    await drain(service, session.id);

    expect(requests).toHaveLength(0);
    expect(service.getProgress(session.id)?.state).toBe('stopped');
  });

  it('ends at the provider-call limit when the duration target is not reached', async () => {
    const { provider, requests } = makeProvider(1);
    const service = createCastService(provider, { maxProviderCalls: 3 });
    const session = service.startSession('History of Boeing', { targetDurationMinutes: 60 });

    await drain(service, session.id);

    expect(requests).toHaveLength(3);
    expect(service.getProgress(session.id)).toMatchObject({
      state: 'limit-reached',
      completionReason: 'provider-limit',
      providerCallCount: 3,
    });
  });

  it('retries a failed sequence without replacing completed batches', async () => {
    const requests: CastBatchRequest[] = [];
    let failedOnce = false;
    const provider: BeatProvider = {
      providerName: 'retry-test',
      modelDisplayName: 'retry-test',
      buildSystemPrompt: () => 'test',
      buildOutline: async () => [],
      async buildBatch(request) {
        requests.push(request);
        if (request.sequence === 3 && !failedOnce) {
          failedOnce = true;
          throw new Error('temporary provider failure');
        }
        return Array.from({ length: 5 }, (_, index) => ({
          hostLine: `Question ${request.sequence}-${index}?`,
          guestLine: Array.from({ length: 20 }, (__, word) => `word-${request.sequence}-${index}-${word}`).join(' '),
        }));
      },
      buildAnswerBeats: async () => [],
    };
    const service = createCastService(provider);
    const session = service.startSession('History of Boeing', { targetDurationMinutes: 4 });

    await drain(service, session.id);
    const batchOne = service.getBatch(session.id, 1);
    const batchTwo = service.getBatch(session.id, 2);
    expect(service.getProgress(session.id)).toMatchObject({ state: 'failed', failedSequence: 3 });

    service.retrySession(session.id);
    await drain(service, session.id);

    expect(service.getBatch(session.id, 1)).toEqual(batchOne);
    expect(service.getBatch(session.id, 2)).toEqual(batchTwo);
    expect(requests.filter((request) => request.sequence === 1)).toHaveLength(1);
    expect(requests.filter((request) => request.sequence === 2)).toHaveLength(1);
    expect(requests.filter((request) => request.sequence === 3)).toHaveLength(2);
    expect(service.getProgress(session.id)?.state).toBe('complete');
  });
});
