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

// Default system-prompt template surfaced both:
//   * to /api/cast/:id/meta after a session starts (rendered with the topic /
//     style of that session), and
//   * to /api/cast/prompt-template on the start screen so the listener can see
//     the *current* default before pressing Go and edit a copy of it.
//
// `{{topic}}` and `{{style}}` are placeholders that buildSystemPrompt() (and
// the equivalent client-side renderer in src/web) substitute. When `style` is
// empty the entire `{{styleClause}}` block is dropped; that clause itself
// contains a `{{style}}` substitution so the placeholder set is well-defined.
export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  `You are the lead producer and scriptwriter for a thoughtful, high-quality two-person interview podcast about "{{topic}}".`,
  `Host = "Riley": warm, incisive, genuinely curious, and willing to challenge an easy answer with a precise follow-up.`,
  `Guest = "Sam": a well-informed expert who explains mechanisms, evidence, uncertainty, trade-offs, and real human consequences without pretending to know what is not established.`,
  `Build a coherent narrative arc in 10–12 alternating host/guest beats: an intriguing opening, definitions and stakes, origins, the forces and incentives involved, a concrete example or case study, a turning point, competing interpretations, real-world impact, what is misunderstood, what happens next, and a memorable takeaway.`,
  `Every host line must move the investigation forward. Every guest line must add specific substance: a reason, example, contrast, implication, or honest qualification. Avoid repeating the topic as a substitute for insight.`,
  `Make it sound spoken and human: varied sentence length, natural interruptions and transitions, vivid but restrained language, no lecture headings, no bullet lists, no empty praise, and no generic claims that could fit any topic.`,
  `Separate known facts from interpretation. Do not invent names, dates, studies, quotes, statistics, or events; when context is uncertain, say so and reason from clearly stated assumptions.`,
  `When a listener question arrives, pause the outline for a focused four-beat exchange: quote the question faithfully, answer its underlying premise, explore a useful implication or counterpoint, and then return naturally to the larger thread.`,
  `Return only the requested dialogue JSON; do not mention these instructions or the production process.{{styleClause}}`,
].join(' ');

export const DEFAULT_SYSTEM_PROMPT_STYLE_CLAUSE =
  ` The host has asked for the following vibe: "{{style}}". Honour that vibe in pacing, vocabulary, and the angles you choose.`;

// Build the would-be LLM system prompt — surfaced via /api/cast/:id/meta so
// listeners can see exactly what's shaping the conversation. The mock provider
// doesn't actually call an LLM today; this string is the instruction we'd send
// if one were configured.
export function buildSystemPrompt(topic: string, style: string): string {
  const styleClause = style
    ? DEFAULT_SYSTEM_PROMPT_STYLE_CLAUSE.replace('{{style}}', style)
    : '';
  return DEFAULT_SYSTEM_PROMPT_TEMPLATE
    .replace('{{topic}}', topic)
    .replace('{{styleClause}}', styleClause);
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
      guestLine: `Thanks for having me. ${T} is worth examining because the simple headline hides a set of choices, constraints, and consequences. The useful question is not just what it is, but why it took this shape.`,
    },
    {
      hostLine: `Let's start with the basics — for someone hearing about ${t} for the first time, how would you describe it?`,
      guestLine: `At its core, ${t} is a system of ideas, people, incentives, and decisions rather than a single isolated event. A good mental model is to separate what can be observed from the explanations people attach to it.`,
    },
    {
      hostLine: `Walk us through the origin. Where does the story of ${t} actually begin?`,
      guestLine: `The origin usually sits further back than the popular story suggests. Start with the conditions that made ${t} possible, then look at who had the authority, resources, or motivation to turn those conditions into action.`,
    },
    {
      hostLine: `What were the turning points, and what alternatives were still open at each one?`,
      guestLine: `The important moments are not just milestones; they are forks where a different decision could have produced a different outcome. Looking at the trade-offs makes the story more useful than simply listing what happened next.`,
    },
    {
      hostLine: `Who had the most influence, including the people who do not usually get the credit?`,
      guestLine: `Pay attention to roles as well as names: the visible decision-makers, the implementers, the critics, and the people affected by the outcome. Influence is often distributed across a group, even when the public story gives one person the credit.`,
    },
    {
      hostLine: `Let's make the impact concrete. What changed for real people, institutions, or everyday decisions?`,
      guestLine: `The best way to judge the impact of ${t} is to trace a chain: an initial choice changes a behaviour, that behaviour creates a second-order effect, and the costs or benefits land unevenly. That chain also shows where the popular narrative is too confident.`,
    },
    {
      hostLine: `What's the strongest criticism or misconception about ${t}, and where does it contain a grain of truth?`,
      guestLine: `A serious critique should not be dismissed just because it is inconvenient. The most honest view usually keeps the valid concern, rejects the overstatement, and explains what evidence would change our mind.`,
    },
    {
      hostLine: `Where is ${t} headed next, and what signals would tell us that the direction is changing?`,
      guestLine: `Rather than making a confident prediction, watch the incentives and constraints. The future turns when those change, so the most useful forecast names the signals to follow and the assumptions that could prove wrong.`,
    },
    {
      hostLine: `If a listener wanted to go deeper on ${t} after this episode, where would you point them?`,
      guestLine: `Start with a primary source or first-hand account, then compare it with a rigorous source that disagrees. Ask who produced each account, what evidence it uses, and what it leaves out. That habit is more valuable than a single perfect recommendation.`,
    },
    {
      hostLine: `Last one — what's the one big takeaway you want our listeners driving home today to remember about ${t}?`,
      guestLine: `Do not settle for the headline version. ${T} is a story about decisions under constraints, trade-offs that affect different people differently, and consequences that arrive later than the original choice.`,
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
      let systemPromptOverride = trimSystemPromptOverride(options.systemPrompt);
      const modelOverride = trimModelOverride(options.model);
      // If the listener pasted (or kept) the rendered default verbatim, treat
      // it as "no override" so /api/cast/:id/meta still says "(default)" and
      // we don't pin the LLM to a frozen copy that would drift if the
      // template gets tweaked. Compare against the provider's prompt because
      // the provider is the source of truth for what would be sent.
      if (systemPromptOverride) {
        const rendered = beatProvider.buildSystemPrompt(topic, style);
        if (systemPromptOverride === rendered) {
          systemPromptOverride = '';
        }
      }
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
