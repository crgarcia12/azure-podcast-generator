import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export type Speaker = 'host' | 'guest';

export interface CastSegment {
  index: number;
  speaker: Speaker;
  text: string;
}

interface PlannedBeat {
  // The host's intro line for the next outline point.
  hostLine: string;
  // The guest's elaboration line.
  guestLine: string;
}

interface QueuedQuestion {
  id: string;
  text: string;
}

export interface CastSession {
  id: string;
  topic: string;
  createdAt: string;
  segments: CastSegment[];
  outline: PlannedBeat[];
  outlineCursor: number;
  pendingQuestions: QueuedQuestion[];
  finished: boolean;
  // Internal: a promise that resolves whenever the session state changes
  // (new question, generator unblocked, etc.). Replaced after each settle.
  signal: { promise: Promise<void>; resolve: () => void };
}

const MIN_TOPIC_LENGTH = 2;
const MAX_TOPIC_LENGTH = 200;
const MIN_QUESTION_LENGTH = 1;
const MAX_QUESTION_LENGTH = 400;

// Mid-segment pacing — gives the browser time to actually speak each segment
// before the next one queues up, and lets a listener interrupt naturally
// between beats. Tunable via env for tests.
const SEGMENT_PACE_MS = Number(process.env.CAST_SEGMENT_PACE_MS ?? '2500');

export class CastValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CastValidationError';
  }
}

export class CastNotFoundError extends Error {
  constructor() {
    super('Cast session not found');
    this.name = 'CastNotFoundError';
  }
}

function makeSignal(): CastSession['signal'] {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function trimTopic(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new CastValidationError('Topic is required');
  }
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length < MIN_TOPIC_LENGTH) {
    throw new CastValidationError('Topic is required');
  }
  if (trimmed.length > MAX_TOPIC_LENGTH) {
    throw new CastValidationError(`Topic must be at most ${MAX_TOPIC_LENGTH} characters`);
  }
  return trimmed;
}

function trimQuestion(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new CastValidationError('Question is required');
  }
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length < MIN_QUESTION_LENGTH) {
    throw new CastValidationError('Question is required');
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw new CastValidationError(`Question must be at most ${MAX_QUESTION_LENGTH} characters`);
  }
  return trimmed;
}

// Templated outline. The mock provider is intentionally simple but produces
// more than enough material for an in-car listen — ~10 beats × 2 lines.
function buildOutline(topic: string): PlannedBeat[] {
  const t = topic;
  const T = topic.charAt(0).toUpperCase() + topic.slice(1);

  return [
    {
      hostLine: `Welcome back to the show. Today's episode is all about ${t}, and I think this one's going to be a great drive companion.`,
      guestLine: `Thanks for having me. ${T} is one of those topics where the more you peel back the layers, the more interesting it gets.`,
    },
    {
      hostLine: `Let's start with the basics — for someone hearing about ${t} for the first time, how would you describe it?`,
      guestLine: `At its core, ${t} is about the intersection of ideas, people, and decisions. It didn't appear out of nowhere — there's a real story behind how it took shape.`,
    },
    {
      hostLine: `Walk us through the origin. Where does the story of ${t} actually begin?`,
      guestLine: `It starts further back than most people realise. The early conditions and the people in the room shaped almost everything that came afterwards.`,
    },
    {
      hostLine: `What were the turning points along the way?`,
      guestLine: `There are usually two or three key moments where the trajectory could have gone in a totally different direction. Those moments are where the personalities really matter.`,
    },
    {
      hostLine: `Who are the people listeners should know about when it comes to ${t}?`,
      guestLine: `A handful of figures stand out — some celebrated, some controversial, and a few quiet contributors who made it all possible behind the scenes.`,
    },
    {
      hostLine: `Let's talk about the impact. How has ${t} changed the world around it?`,
      guestLine: `The ripple effects are everywhere once you know what to look for — in the way we work, the products we use, even the stories we tell ourselves about progress.`,
    },
    {
      hostLine: `What's a common misconception about ${t} that you'd love to clear up?`,
      guestLine: `People assume the obvious narrative is the whole story. But the reality is more nuanced — the most interesting parts are usually the ones that don't fit neatly on a slide.`,
    },
    {
      hostLine: `Where is ${t} headed next? What should we be watching?`,
      guestLine: `The next chapter is being written right now. The pace has accelerated, the players have multiplied, and the questions we're asking are getting sharper.`,
    },
    {
      hostLine: `If a listener wanted to go deeper on ${t} after this episode, where would you point them?`,
      guestLine: `Start with the primary sources — the original interviews, papers, or memoirs. Then triangulate with a couple of strong secondary takes. Avoid the takes that promise easy answers.`,
    },
    {
      hostLine: `Last one — what's the one big takeaway you want our listeners driving home today to remember about ${t}?`,
      guestLine: `Don't accept the headline version. ${T} is a story about decisions, trade-offs, and long-term consequences — and that's exactly what makes it worth your attention.`,
    },
    {
      hostLine: `Beautifully put. Thanks so much for joining us today — that was a fantastic deep-dive on ${t}.`,
      guestLine: `My pleasure. Thanks for having me, and safe travels to everyone listening.`,
    },
  ];
}

function buildAnswerBeat(topic: string, question: string): PlannedBeat {
  const trimmed = question.replace(/[?.!]+$/, '');
  return {
    hostLine: `Hold on — we just got a great question from a listener: "${trimmed}". Let's pause the thread and hear your take on that.`,
    guestLine: `Really good question. When it comes to ${topic}, the honest answer is that it depends on what you focus on, but a useful frame is to look at intent, context, and consequences. ${trimmed.toLowerCase().startsWith('why') ? 'The reasons trace back to the early decisions we talked about.' : trimmed.toLowerCase().startsWith('how') ? 'The mechanism is more interesting than most people realise.' : 'It connects directly to the broader thread we were just on.'} Then we can pick up where we left off.`,
  };
}

export interface CastService {
  startSession(topic: string): CastSession;
  getSession(id: string): CastSession | undefined;
  addQuestion(id: string, question: string): { questionId: string };
  // Async generator that yields one segment at a time, awaiting between
  // segments to emulate natural pacing and to give listeners time to ask.
  // Resolves when the session is finished or when `signal` aborts.
  generateStream(id: string, abort: AbortSignal): AsyncGenerator<CastSegment, void, void>;
}

export function createCastService(): CastService {
  const sessions = new Map<string, CastSession>();

  function notify(session: CastSession): void {
    const old = session.signal;
    session.signal = makeSignal();
    old.resolve();
  }

  function nextSegmentsForBeat(session: CastSession, beat: PlannedBeat): CastSegment[] {
    const baseIndex = session.segments.length;
    return [
      { index: baseIndex, speaker: 'host', text: beat.hostLine },
      { index: baseIndex + 1, speaker: 'guest', text: beat.guestLine },
    ];
  }

  return {
    startSession(rawTopic: string): CastSession {
      const topic = trimTopic(rawTopic);
      const session: CastSession = {
        id: randomUUID(),
        topic,
        createdAt: new Date().toISOString(),
        segments: [],
        outline: buildOutline(topic),
        outlineCursor: 0,
        pendingQuestions: [],
        finished: false,
        signal: makeSignal(),
      };
      sessions.set(session.id, session);
      return session;
    },

    getSession(id: string): CastSession | undefined {
      return sessions.get(id);
    },

    addQuestion(id: string, rawQuestion: string): { questionId: string } {
      const session = sessions.get(id);
      if (!session) {
        throw new CastNotFoundError();
      }
      const question = trimQuestion(rawQuestion);
      const questionId = randomUUID();
      session.pendingQuestions.push({ id: questionId, text: question });
      notify(session);
      return { questionId };
    },

    async *generateStream(id: string, abort: AbortSignal): AsyncGenerator<CastSegment, void, void> {
      const session = sessions.get(id);
      if (!session) {
        throw new CastNotFoundError();
      }

      // Replay any segments already produced (for late-joining clients).
      for (const segment of session.segments) {
        if (abort.aborted) return;
        yield segment;
      }

      while (!abort.aborted && !session.finished) {
        // A pending question always wins — we interrupt the planned outline
        // and queue an answer beat next.
        const pendingQuestion = session.pendingQuestions.shift();
        if (pendingQuestion) {
          const beat = buildAnswerBeat(session.topic, pendingQuestion.text);
          const newSegments = nextSegmentsForBeat(session, beat);
          for (const seg of newSegments) {
            session.segments.push(seg);
            if (abort.aborted) return;
            yield seg;
            if (abort.aborted) return;
            await pace(abort);
            if (abort.aborted) return;
          }
          continue;
        }

        // Otherwise advance the outline.
        if (session.outlineCursor >= session.outline.length) {
          session.finished = true;
          break;
        }
        const beat = session.outline[session.outlineCursor++];
        if (!beat) {
          session.finished = true;
          break;
        }
        const newSegments = nextSegmentsForBeat(session, beat);
        for (const seg of newSegments) {
          session.segments.push(seg);
          if (abort.aborted) return;
          yield seg;
          if (abort.aborted) return;
          await pace(abort);
          if (abort.aborted) return;
        }
      }
    },
  };
}

async function pace(abort: AbortSignal): Promise<void> {
  if (SEGMENT_PACE_MS <= 0) return;
  try {
    await delay(SEGMENT_PACE_MS, undefined, { signal: abort });
  } catch {
    // Aborted — caller checks abort.aborted and returns cleanly.
  }
}

export const __testing = { trimTopic, trimQuestion };
