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
export type { PlannedBeat };

interface QueuedQuestion {
  id: string;
  text: string;
}

export interface CastSession {
  id: string;
  topic: string;
  style: string; // user-provided "vibe" hint — empty string when not supplied
  // Optional per-session overrides set when the listener wants to tweak the
  // brain or steer the conversation before pressing Go. Empty string ===
  // "use the provider default".
  systemPromptOverride: string;
  modelOverride: string;
  createdAt: string;
  segments: CastSegment[];
  outline: PlannedBeat[];
  outlineCursor: number;
  // Resolves when the outline has been built. Mock provider resolves
  // immediately; LLM-backed providers resolve after the chat-completion
  // call returns. The streamer awaits this before pulling beats so the
  // generator never sees a half-built outline.
  outlineReady: Promise<void>;
  pendingQuestions: QueuedQuestion[];
  finished: boolean;
  // Internal: a promise that resolves whenever the session state changes
  // (new question, generator unblocked, etc.). Replaced after each settle.
  signal: { promise: Promise<void>; resolve: () => void };
}

export interface CastMeta {
  id: string;
  topic: string;
  style: string;
  createdAt: string;
  provider: string;
  modelDisplayName: string;
  // The full instruction string PodCraft would send to an LLM if one were
  // configured. Surfacing this gives listeners full transparency into what's
  // shaping the conversation and lets them iterate on the style.
  systemPrompt: string;
  // Whether the prompt and model above came from a per-session listener
  // override (true) or from the provider's defaults (false). Lets the UI
  // show "(custom)" badges so the listener knows their tweak took effect.
  systemPromptIsOverride: boolean;
  modelIsOverride: boolean;
}

const MIN_TOPIC_LENGTH = 2;
const MAX_TOPIC_LENGTH = 200;
const MIN_QUESTION_LENGTH = 1;
const MAX_QUESTION_LENGTH = 400;
const MAX_STYLE_LENGTH = 500;
// Generous but bounded — enough room for a full multi-paragraph instruction
// without letting a runaway client OOM the prompt-handling code path.
const MAX_SYSTEM_PROMPT_LENGTH = 4000;
const MAX_MODEL_NAME_LENGTH = 120;

// Mid-segment pacing — gives the browser time to actually speak each segment
// before the next one queues up, and lets a listener interrupt naturally
// between beats. Tunable via env for tests.
const SEGMENT_PACE_MS = Number(process.env.CAST_SEGMENT_PACE_MS ?? '2500');

const PROVIDER_NAME = 'mock-template';
const MODEL_DISPLAY_NAME = 'PodCraft mock outline v2';

// Pluggable beat-generation backend. The mock provider returns the static
// templates below; the Azure provider calls Azure OpenAI. The CastService
// uses the provider for outline + answer beats but handles all session,
// streaming, pacing, and queueing logic itself.
export interface BeatProvider {
  providerName: string;
  modelDisplayName: string;
  buildOutline(input: {
    topic: string;
    style: string;
    systemPromptOverride?: string;
    deploymentOverride?: string;
  }): Promise<PlannedBeat[]>;
  buildAnswerBeats(input: {
    topic: string;
    style: string;
    question: string;
    transcriptSoFar: CastSegment[];
    systemPromptOverride?: string;
    deploymentOverride?: string;
  }): Promise<PlannedBeat[]>;
  // The system prompt this provider would (or does) send to its underlying
  // LLM. Surfaced via /api/cast/:id/meta for transparency. Pure function of
  // (topic, style) — listener overrides are surfaced separately in CastMeta.
  buildSystemPrompt(topic: string, style: string): string;
}

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

function trimStyle(raw: unknown): string {
  // Style is optional — empty/missing is fine and just means "use defaults".
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new CastValidationError('Style must be a string');
  }
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length > MAX_STYLE_LENGTH) {
    throw new CastValidationError(`Style must be at most ${MAX_STYLE_LENGTH} characters`);
  }
  return trimmed;
}

// Optional listener-supplied system prompt. Preserves internal whitespace so
// multi-paragraph prompts survive the round-trip; only trims leading/trailing
// blanks. Empty/missing means "use the provider default".
function trimSystemPromptOverride(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new CastValidationError('systemPrompt must be a string');
  }
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_SYSTEM_PROMPT_LENGTH) {
    throw new CastValidationError(
      `System prompt must be at most ${MAX_SYSTEM_PROMPT_LENGTH} characters`,
    );
  }
  return trimmed;
}

// Optional listener-supplied model / deployment name. The Azure provider uses
// it to pick a different deployment for THIS session only (no global env
// mutation). Empty/missing means "use the deployment baked into the image".
function trimModelOverride(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    throw new CastValidationError('model must be a string');
  }
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_MODEL_NAME_LENGTH) {
    throw new CastValidationError(
      `Model must be at most ${MAX_MODEL_NAME_LENGTH} characters`,
    );
  }
  // Azure deployment names allow letters, digits, dashes, underscores, periods.
  // Reject anything with whitespace or path-like separators so the URL builder
  // never has to think about it.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new CastValidationError(
      'Model must only contain letters, digits, dashes, underscores, or periods',
    );
  }
  return trimmed;
}

// Build the would-be LLM system prompt — surfaced via /api/cast/:id/meta so
// listeners can see exactly what's shaping the conversation. The mock provider
// doesn't actually call an LLM today; this string is the instruction we'd send
// if one were configured.
export function buildSystemPrompt(topic: string, style: string): string {
  const stylePart = style
    ? ` The host has asked for the following vibe: "${style}". Honour that vibe in pacing, vocabulary, and the angles you choose.`
    : '';
  return [
    `You are scripting a two-person interview podcast about "${topic}".`,
    `Host = "Riley" (curious, warm, paces the conversation with short connective questions).`,
    `Guest = "Sam" (subject-matter expert, gives substantive 1–3 sentence answers).`,
    `Format: alternating host / guest lines, ~10 beats covering origin, turning points, key people, impact, misconceptions, what's next, and a takeaway.`,
    `When a listener question arrives, interrupt the outline with a 3-beat answer that quotes the question verbatim and pulls back into the thread afterwards.`,
    `Keep lines drivable — no jargon dumps, no filler.${stylePart}`,
  ].join(' ');
}

// Lightweight style fingerprint — a few buckets that shape templated phrasing
// without an LLM. The user's literal style string is also threaded into a few
// host lines so they can hear it took effect.
type StyleBucket = 'punchy' | 'cozy' | 'comedic' | 'analytical' | 'spicy' | 'storyteller' | 'default';

function classifyStyle(style: string): StyleBucket {
  if (!style) return 'default';
  const s = style.toLowerCase();
  if (/(punchy|fast|energetic|hype|pump|tight|snappy|short)/.test(s)) return 'punchy';
  if (/(cozy|calm|sleepy|bedtime|chill|mellow|gentle|relax)/.test(s)) return 'cozy';
  if (/(funny|comedy|comedic|joke|witty|playful|absurd|sarcas)/.test(s)) return 'comedic';
  if (/(analytical|deep|dense|technical|nerdy|rigorous|expert)/.test(s)) return 'analytical';
  if (/(spicy|contrarian|hot.?take|provoc|edgy|controv)/.test(s)) return 'spicy';
  if (/(story|narrative|cinematic|dramatic|epic)/.test(s)) return 'storyteller';
  return 'default';
}

function styleFlavor(bucket: StyleBucket, style: string): { intro: string; closer: string } {
  switch (bucket) {
    case 'punchy':
      return {
        intro: ` Quick warning: today is fast and tight. No fluff, just the good stuff.`,
        closer: ` That's the punchy version — onto the next.`,
      };
    case 'cozy':
      return {
        intro: ` Settle in — this one's a slower, gentler ride.`,
        closer: ` Take a breath, we'll keep ambling forward.`,
      };
    case 'comedic':
      return {
        intro: ` Heads up: we're going to enjoy ourselves with this one.`,
        closer: ` (Yes, that was a setup. Moving on.)`,
      };
    case 'analytical':
      return {
        intro: ` We're going deep on this one — bring your thinking cap.`,
        closer: ` Filing that under "things worth a second pass" — onward.`,
      };
    case 'spicy':
      return {
        intro: ` Fair warning: we've got some hot takes loaded for this one.`,
        closer: ` Yes, that'll annoy somebody. Good. Onward.`,
      };
    case 'storyteller':
      return {
        intro: ` We're telling this one as a story — characters, stakes, the whole arc.`,
        closer: ` And the next chapter is where it gets really interesting.`,
      };
    default:
      return style
        ? {
            intro: ` The vibe today, per the request: ${style}.`,
            closer: ``,
          }
        : { intro: '', closer: '' };
  }
}

// Templated outline. The mock provider is intentionally simple but produces
// more than enough material for an in-car listen — ~11 beats × 2 lines.
function buildOutline(topic: string, style: string): PlannedBeat[] {
  const t = topic;
  const T = topic.charAt(0).toUpperCase() + topic.slice(1);
  const bucket = classifyStyle(style);
  const flavor = styleFlavor(bucket, style);

  return [
    {
      hostLine: `Welcome back to the show. Today's episode is all about ${t}, and I think this one's going to be a great drive companion.${flavor.intro}`,
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
      hostLine: `Beautifully put. Thanks so much for joining us today — that was a fantastic deep-dive on ${t}.${flavor.closer}`,
      guestLine: `My pleasure. Thanks for having me, and safe travels to everyone listening.`,
    },
  ];
}

function classifyQuestion(lower: string): 'why' | 'how' | 'what' | 'when' | 'who' | 'where' | 'yesno' | 'open' {
  if (/^why\b/.test(lower)) return 'why';
  if (/^how\b/.test(lower)) return 'how';
  if (/^what\b/.test(lower)) return 'what';
  if (/^when\b/.test(lower)) return 'when';
  if (/^who\b/.test(lower)) return 'who';
  if (/^where\b/.test(lower)) return 'where';
  if (/^(is|are|was|were|do|does|did|can|could|should|would|will|has|have|had)\b/.test(lower)) return 'yesno';
  return 'open';
}

function buildAnswerBeats(topic: string, question: string, style: string): PlannedBeat[] {
  const trimmed = question.replace(/[?.!]+$/, '').trim();
  const lower = trimmed.toLowerCase();
  const kind = classifyQuestion(lower);
  const styleBucket = classifyStyle(style);
  const styleAside = (() => {
    switch (styleBucket) {
      case 'punchy':
        return ` Quick version, no fluff.`;
      case 'cozy':
        return ` Let's take it slowly.`;
      case 'comedic':
        return ` And I promise to keep this entertaining.`;
      case 'analytical':
        return ` We'll be precise about this.`;
      case 'spicy':
        return ` Buckle up — there's a real take coming.`;
      case 'storyteller':
        return ` Picture the scene with me.`;
      default:
        return ``;
    }
  })();

  const setupGuest = (() => {
    switch (kind) {
      case 'why':
        return `That cuts right to the heart of ${topic}. The "why" sits at the intersection of motivation, opportunity, and timing — and ignoring any of those misses the real story.`;
      case 'how':
        return `Great mechanics question. The "how" of ${topic} is where the abstract stuff hits the ground — there are concrete steps, decisions, and trade-offs that most takes skip over entirely.`;
      case 'what':
        return `Definitions matter here, especially with ${topic} — different camps mean different things by the same words, and that's where a surprising amount of the disagreement actually lives.`;
      case 'when':
        return `Chronology is more important here than people realise. The timing of ${topic} is part of why it had the impact it did.`;
      case 'who':
        return `The cast of characters around ${topic} is genuinely fascinating — there are obvious names, and then a few quiet protagonists most people have never heard of.`;
      case 'where':
        return `Geography matters more in ${topic} than people give it credit for — the place shapes the conditions, and the conditions shape what's possible.`;
      case 'yesno':
        return `Short answer is "it depends" — long answer is where ${topic} gets interesting. There's a yes-version and a no-version, and the difference between them tells you what the real question is.`;
      default:
        return `That's a really good angle on ${topic}. Most people don't ask it that way, and it cuts straight to the part of the story that's usually glossed over.`;
    }
  })();

  const meatGuest = (() => {
    switch (kind) {
      case 'why':
        return `The "why" comes down to two things: the conditions that made ${topic} possible at that particular moment, and the people who saw the opening. Strip away either and you don't get the same outcome.`;
      case 'how':
        return `Step one is recognising that ${topic} doesn't happen in a single move — it's a sequence. Step two: each step depends on the previous one in ways that aren't obvious until you're inside it. That's why the "how" gets misread so often.`;
      case 'what':
        return `Strip ${topic} down to its atomic elements and you get something simpler than the usual narrative suggests — but the simple version is the powerful one. Once you see it, you can't unsee how it shapes everything downstream.`;
      case 'when':
        return `The window mattered enormously. Earlier, ${topic} would have been impossible. Later, the moment would have passed. The timing wasn't accidental — it was the product of decades of pressure finally finding a release valve.`;
      case 'who':
        return `Three names you should know, and probably don't all of them. Each made a choice the others didn't see coming, and the combination of those choices is what made ${topic} what it became.`;
      case 'where':
        return `The setting did most of the heavy lifting people credit to the personalities. ${topic} couldn't have unfolded the same way anywhere else — the local conditions selected for exactly the kind of approach that ended up working.`;
      case 'yesno':
        return `Honest answer: yes and no, and the difference between yes and no is where ${topic} stops being a trivia question and starts being a genuinely useful framework. Most people stop at the headline; the real value is one layer down.`;
      default:
        return `The core of "${trimmed}" is something a lot of people get wrong about ${topic}. Conventional wisdom says one thing, but if you actually trace the evidence, you end up somewhere more nuanced — and frankly more useful.`;
    }
  })();

  return [
    {
      hostLine: `Hold on — we just got a great question from a listener. They're asking: "${trimmed}". Let's pause the thread and dig into that.${styleAside}`,
      guestLine: setupGuest,
    },
    {
      hostLine: `So unpack it for us — what's the honest answer to "${trimmed}"?`,
      guestLine: meatGuest,
    },
    {
      hostLine: `That's a much richer answer than the one-liner I was expecting. Anything you'd add for someone who really wants to sit with that question?`,
      guestLine: `Just that ${topic} rewards patience here — the deeper you go on "${trimmed}", the more the surface answer falls apart in interesting ways. And the listener who asked clearly already senses that.`,
    },
    {
      hostLine: `Beautifully said. Listener, thanks for that one — it pushed the conversation somewhere good. Now, picking up where we left off…`,
      guestLine: `Yes, let's get back to it.`,
    },
  ];
}

export interface StartSessionOptions {
  style?: string;
  // Listener-supplied per-session overrides — see trimSystemPromptOverride /
  // trimModelOverride for validation rules. Omit / empty string === "use
  // the provider default for this run".
  systemPrompt?: string;
  model?: string;
}

export interface CastService {
  startSession(topic: string, options?: StartSessionOptions): CastSession;
  getSession(id: string): CastSession | undefined;
  getMeta(id: string): CastMeta | undefined;
  addQuestion(id: string, question: string): { questionId: string };
  // Async generator that yields one segment at a time, awaiting between
  // segments to emulate natural pacing and to give listeners time to ask.
  // `since` skips already-heard segments when a client reconnects (e.g. after
  // submitting a question) — that prevents the show from replaying from the
  // start. Resolves when the session is finished or when `signal` aborts.
  generateStream(
    id: string,
    abort: AbortSignal,
    since?: number,
  ): AsyncGenerator<CastSegment, void, void>;
}

// Mock provider — returns the templated outline / answer beats synchronously.
// Used as the default and as a graceful fallback when the LLM provider errors.
export function createMockBeatProvider(): BeatProvider {
  return {
    providerName: PROVIDER_NAME,
    modelDisplayName: MODEL_DISPLAY_NAME,
    async buildOutline({ topic, style }): Promise<PlannedBeat[]> {
      // Mock provider ignores systemPromptOverride / deploymentOverride — it
      // doesn't talk to an LLM, so a custom prompt has nothing to act on.
      return buildOutline(topic, style);
    },
    async buildAnswerBeats({ topic, style, question }) {
      return buildAnswerBeats(topic, question, style);
    },
    buildSystemPrompt(topic: string, style: string): string {
      return buildSystemPrompt(topic, style);
    },
  };
}

export function createCastService(provider?: BeatProvider): CastService {
  const sessions = new Map<string, CastSession>();
  const beatProvider: BeatProvider = provider ?? createMockBeatProvider();

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
    startSession(rawTopic: string, options: StartSessionOptions = {}): CastSession {
      const topic = trimTopic(rawTopic);
      const style = trimStyle(options.style);
      const systemPromptOverride = trimSystemPromptOverride(options.systemPrompt);
      const modelOverride = trimModelOverride(options.model);
      const session: CastSession = {
        id: randomUUID(),
        topic,
        style,
        systemPromptOverride,
        modelOverride,
        createdAt: new Date().toISOString(),
        segments: [],
        outline: [],
        outlineCursor: 0,
        outlineReady: Promise.resolve(),
        pendingQuestions: [],
        finished: false,
        signal: makeSignal(),
      };
      // Kick off outline generation. For mock this resolves on the next tick;
      // for Azure this awaits a chat-completion call. Errors are caught and
      // fallback to the mock template so a transient LLM failure can never
      // break a session.
      session.outlineReady = (async () => {
        try {
          session.outline = await beatProvider.buildOutline({
            topic,
            style,
            systemPromptOverride: systemPromptOverride || undefined,
            deploymentOverride: modelOverride || undefined,
          });
        } catch (err) {
          console.error('[cast] outline generation failed; falling back to template', err);
          session.outline = buildOutline(topic, style);
        }
        notify(session);
      })();
      sessions.set(session.id, session);
      return session;
    },

    getSession(id: string): CastSession | undefined {
      return sessions.get(id);
    },

    getMeta(id: string): CastMeta | undefined {
      const session = sessions.get(id);
      if (!session) return undefined;
      const baseSystemPrompt = beatProvider.buildSystemPrompt(session.topic, session.style);
      // When the listener pinned a custom prompt or model for this session we
      // surface the OVERRIDE in the meta — that's what's actually being sent to
      // the LLM, and it's what the listener wants to see in "About this episode".
      const effectivePrompt = session.systemPromptOverride || baseSystemPrompt;
      const effectiveModel = session.modelOverride
        ? `${session.modelOverride} (override)`
        : beatProvider.modelDisplayName;
      return {
        id: session.id,
        topic: session.topic,
        style: session.style,
        createdAt: session.createdAt,
        provider: beatProvider.providerName,
        modelDisplayName: effectiveModel,
        systemPrompt: effectivePrompt,
        systemPromptIsOverride: Boolean(session.systemPromptOverride),
        modelIsOverride: Boolean(session.modelOverride),
      };
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

    async *generateStream(
      id: string,
      abort: AbortSignal,
      since = 0,
    ): AsyncGenerator<CastSegment, void, void> {
      const session = sessions.get(id);
      if (!session) {
        throw new CastNotFoundError();
      }

      // Replay only segments at or after `since` — clients pass the next
      // unheard index when reconnecting (e.g. after asking a question) so
      // the show doesn't restart from the beginning.
      for (const segment of session.segments) {
        if (abort.aborted) return;
        if (segment.index < since) continue;
        yield segment;
      }

      // Wait for the outline to be ready before pulling beats. With the mock
      // provider this is effectively instant; with the LLM provider it can
      // take a few seconds on the first stream of a new session.
      await session.outlineReady;
      if (abort.aborted) return;

      while (!abort.aborted) {
        // Resolve the next batch of beats in priority order:
        //   1. Pending listener question → multi-beat answer (interrupts)
        //   2. Outline next planned beat
        let beats: PlannedBeat[];
        if (session.pendingQuestions.length > 0) {
          const q = session.pendingQuestions.shift()!;
          // A question revives a wrapped show so the host can address it.
          session.finished = false;
          try {
            beats = await beatProvider.buildAnswerBeats({
              topic: session.topic,
              style: session.style,
              question: q.text,
              transcriptSoFar: session.segments.slice(),
              systemPromptOverride: session.systemPromptOverride || undefined,
              deploymentOverride: session.modelOverride || undefined,
            });
          } catch (err) {
            console.error('[cast] answer-beat generation failed; using template', err);
            beats = buildAnswerBeats(session.topic, q.text, session.style);
          }
          if (abort.aborted) return;
        } else if (session.outlineCursor < session.outline.length) {
          const beat = session.outline[session.outlineCursor++];
          if (!beat) continue;
          beats = [beat];
        } else {
          session.finished = true;
          break;
        }

        for (const beat of beats) {
          // A fresh listener question drops any remaining answer beats so the
          // new question can take over immediately.
          if (session.pendingQuestions.length > 0) break;
          const newSegments = nextSegmentsForBeat(session, beat);
          let interrupted = false;
          for (const seg of newSegments) {
            session.segments.push(seg);
            if (abort.aborted) return;
            yield seg;
            if (abort.aborted) return;
            await pace(abort);
            if (abort.aborted) return;
            if (session.pendingQuestions.length > 0) {
              interrupted = true;
              break;
            }
          }
          if (interrupted) break;
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

export const __testing = {
  trimTopic,
  trimQuestion,
  trimStyle,
  trimSystemPromptOverride,
  trimModelOverride,
  classifyStyle,
};
