import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  TELEMETRY_ALLOWED_FIELDS,
  emitTelemetry,
  startTimer,
  type TelemetryEvent,
} from '../../src/services/telemetry.js';

// Spy on the logger to capture telemetry log calls
vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function getLoggerMock() {
  const { logger } = await import('../../src/logger.js');
  return logger as { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

describe('TELEMETRY_ALLOWED_FIELDS allow-list', () => {
  it('contains exactly the required fields', () => {
    expect(TELEMETRY_ALLOWED_FIELDS.has('stage')).toBe(true);
    expect(TELEMETRY_ALLOWED_FIELDS.has('durationMs')).toBe(true);
    expect(TELEMETRY_ALLOWED_FIELDS.has('provider')).toBe(true);
    expect(TELEMETRY_ALLOWED_FIELDS.has('success')).toBe(true);
    expect(TELEMETRY_ALLOWED_FIELDS.has('correlationId')).toBe(true);
    expect(TELEMETRY_ALLOWED_FIELDS.has('errorCode')).toBe(true);
  });

  it('does NOT contain sensitive fields', () => {
    const forbidden = [
      'topic', 'transcript', 'question', 'text', 'content',
      'body', 'request', 'response', 'audio', 'credential',
      'apiKey', 'token', 'password', 'secret', 'error', 'stack',
    ];
    for (const field of forbidden) {
      expect(TELEMETRY_ALLOWED_FIELDS.has(field)).toBe(false);
    }
  });
});

describe('emitTelemetry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emits only allow-listed fields', async () => {
    const loggerMock = await getLoggerMock();
    const event: TelemetryEvent = {
      stage: 'script_generation',
      durationMs: 123,
      provider: 'mock',
      success: true,
      correlationId: 'test-corr-id',
    };

    emitTelemetry(event);

    expect(loggerMock.info).toHaveBeenCalledOnce();
    const call = (loggerMock.info as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = call[0] as { telemetry: Record<string, unknown> };
    expect(payload.telemetry).toBeDefined();
    const emitted = Object.keys(payload.telemetry);
    for (const key of emitted) {
      expect(TELEMETRY_ALLOWED_FIELDS.has(key)).toBe(true);
    }
  });

  it('includes all required fields from the event', async () => {
    const loggerMock = await getLoggerMock();
    const event: TelemetryEvent = {
      stage: 'answer_readiness',
      durationMs: 456,
      provider: 'azure',
      success: false,
      correlationId: 'corr-abc',
      errorCode: 'SYNTHESIS_FAILED',
    };

    emitTelemetry(event);

    const call = (loggerMock.info as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = call[0] as { telemetry: Record<string, unknown> };
    expect(payload.telemetry.stage).toBe('answer_readiness');
    expect(payload.telemetry.durationMs).toBe(456);
    expect(payload.telemetry.provider).toBe('azure');
    expect(payload.telemetry.success).toBe(false);
    expect(payload.telemetry.correlationId).toBe('corr-abc');
    expect(payload.telemetry.errorCode).toBe('SYNTHESIS_FAILED');
  });

  it('omits undefined optional fields', async () => {
    const loggerMock = await getLoggerMock();
    const event: TelemetryEvent = {
      stage: 'initial_audio_readiness',
      durationMs: 100,
      provider: 'mock',
      success: true,
      correlationId: 'corr-xyz',
    };

    emitTelemetry(event);

    const call = (loggerMock.info as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = call[0] as { telemetry: Record<string, unknown> };
    expect(payload.telemetry.errorCode).toBeUndefined();
  });

  it('uses "telemetry_event" as the log message', async () => {
    const loggerMock = await getLoggerMock();
    emitTelemetry({
      stage: 'question_acknowledgement',
      durationMs: 0,
      provider: 'mock',
      success: true,
      correlationId: 'c1',
    });

    const call = (loggerMock.info as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe('telemetry_event');
  });

  it('supports all TelemetryStage values', async () => {
    const loggerMock = await getLoggerMock();
    const stages = [
      'script_generation',
      'initial_audio_readiness',
      'question_acknowledgement',
      'answer_readiness',
      'episode_resumption',
    ] as const;

    for (const stage of stages) {
      emitTelemetry({ stage, durationMs: 0, provider: 'mock', success: true, correlationId: 'c' });
    }

    expect(loggerMock.info).toHaveBeenCalledTimes(stages.length);
  });
});

describe('startTimer', () => {
  it('returns a function that measures elapsed time', async () => {
    const elapsed = startTimer();
    await new Promise((r) => setTimeout(r, 10));
    const ms = elapsed();
    expect(ms).toBeGreaterThanOrEqual(5);
    expect(typeof ms).toBe('number');
  });
});
