import crypto from 'node:crypto';
import { DefaultAzureCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/core-auth';
import {
  createSession,
  getOwnedSession,
  getSessionSummariesByUser,
  deleteSession,
  beginInterrupt,
  completeInterrupt,
  failInterrupt,
  createIntervention,
  updateIntervention,
  getIntervention,
  cancelIntervention,
  assertSessionCapacity,
  type PodcastSession,
  type PodcastSegment,
  type PodcastSessionSummary,
  type InterruptResult,
  type PodcastIntervention,
  type PodcastGenerationControls,
} from '../models/session-store.js';
import {
  getSegmentAudio,
  setSegmentAudio,
} from '../models/audio-store.js';
import { getDatabase } from '../models/database.js';
import {
  validateTranscript,
  countWords,
  CANONICAL_WPM,
  MAX_WORDS_PER_TURN,
  type TranscriptTurn,
} from './transcript-validator.js';
import {
  emitTelemetry,
  startTimer,
} from './telemetry.js';
import { createK8sFederatedAadCredentialFromEnv } from './k8s-aad-credential.js';

// ─── Types ───────────────────────────────────────────────────────────

export type PodcastAudienceLevel = 'beginner' | 'intermediate' | 'expert';
export type PodcastDurationMinutes = 5 | 10 | 15;
export type PodcastConversationStyle = 'conversational' | 'educational' | 'debate';

export interface InterventionResult {
  intervention: PodcastIntervention;
}

export interface InteractiveSessionService {
  createSession(input: {
    userId: string;
    topic: string;
    controls: PodcastGenerationControls;
  }): Promise<PodcastSession>;
  getSession(input: { sessionId: string; userId: string }): PodcastSession | undefined;
  listSessions(input: { userId: string }): PodcastSessionSummary[];
  deleteSession(input: { sessionId: string; userId: string }): boolean;
  getSegmentAudio(input: {
    sessionId: string;
    segmentId: string;
    userId: string;
  }): Promise<Buffer | null>;
  processInterrupt(input: {
    sessionId: string;
    userId: string;
    questionText: string;
    inputMethod: 'voice' | 'text';
    afterSegmentId: string;
    clientRequestId: string;
  }): Promise<InterruptResult>;
  processIntervention(input: {
    sessionId: string;
    userId: string;
    questionText: string;
    afterSegmentId: string;
    clientRequestId: string;
    playbackPositionSeconds: number;
  }): Promise<InterventionResult>;
  getInterventionAudio(input: {
    sessionId: string;
    interventionId: string;
    userId: string;
  }): Promise<Buffer | null>;
  cancelIntervention(input: {
    sessionId: string;
    interventionId: string;
    userId: string;
  }): Promise<boolean>;
}

// ─── Errors ──────────────────────────────────────────────────────────

export class SessionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionNotFoundError';
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderGenerationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ProviderGenerationError';
  }
}

// ─── Tone WAV Buffer ─────────────────────────────────────────────────

function createToneWaveBuffer(durationMs: number): Buffer {
  const sampleRate = 16000;
  const totalSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < totalSamples; i++) {
    const freq = i % (sampleRate / 2) < sampleRate / 4 ? 440 : 660;
    const amp = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.18;
    buffer.writeInt16LE(Math.floor(amp * 32767), 44 + i * 2);
  }

  return buffer;
}

// ─── Mock Transcript Templates ────────────────────────────────────────

// Template function: generates turn text weaving in the topic.
// Host turns target ~35-45 words; guest turns target ~60-75 words.
// All are verified to be ≤80 words.

function hLine(tpl: string, topic: string): string {
  return tpl.replace(/\{T\}/g, topic);
}

function hostIntro(topic: string, level: PodcastAudienceLevel, style: PodcastConversationStyle): string {
  if (style === 'debate') {
    return hLine(
      'Welcome back. Today we are tackling {T}, a subject where reasonable people genuinely disagree. I want to start by putting the strongest counterargument on the table right away. What is the best case against the conventional wisdom on {T}?',
      topic,
    );
  }
  if (level === 'beginner') {
    return hLine(
      'Welcome to the show. Today we are covering {T}, and I want to make this accessible to everyone. Whether you have never heard of {T} before or you are just starting to explore it, this conversation is for you. Let us begin with the basics: what exactly is {T}?',
      topic,
    );
  }
  if (level === 'expert') {
    return hLine(
      'Welcome back. Today we are going deep on {T} with someone who has spent years working in this space. We are going to skip the introductions and get straight into the technical details. I want to start by asking about the most underappreciated challenge in {T}.',
      topic,
    );
  }
  return hLine(
    'Welcome to today\'s episode. Our subject is {T}, and I think even people who are familiar with the name often miss the deeper story. So let us start at the beginning: how would you actually describe {T} to someone who asks you at a dinner party?',
    topic,
  );
}

function guestIntro(topic: string, level: PodcastAudienceLevel, style: PodcastConversationStyle): string {
  if (style === 'debate') {
    return hLine(
      'The best counterargument to the conventional wisdom on {T} is that the assumptions underlying it are often context-dependent and not universally applicable. Critics would say we overfit our models to historical data and draw conclusions that simply do not hold in edge cases. That tension is what makes {T} genuinely interesting — it forces you to interrogate your priors and be honest about the limits of what we know.',
      topic,
    );
  }
  if (level === 'beginner') {
    return hLine(
      'Great question. {T} is really about understanding a set of interconnected ideas that build on each other. Think of it as a ladder: each rung gives you access to the next. The first rung is just recognizing that {T} is a systematic way of thinking, not a collection of isolated facts. Once you have that framing, everything else starts to make much more sense and fit together naturally.',
      topic,
    );
  }
  if (level === 'expert') {
    return hLine(
      'The most underappreciated challenge in {T} is the gap between theoretical guarantees and empirical performance. You can have a method that is optimal in expectation but performs poorly in practice because the distributional assumptions do not hold. Practitioners in {T} are constantly navigating that gap, and the ones who do it well tend to have deep intuitions built from years of working directly with real-world data and constraints.',
      topic,
    );
  }
  return hLine(
    '{T} sits at an interesting intersection of several disciplines. The short version is that it is a principled approach to understanding complex phenomena by combining rigorous analysis with practical intuition. What makes it compelling is that the same core ideas keep showing up in completely different domains — which tells you something fundamental about the underlying structure.',
    topic,
  );
}

// Core question-answer pairs, indexed by slot number. Topic is substituted.
const CORE_HOST_LINES: Array<(topic: string, style: PodcastConversationStyle) => string> = [
  (t, s) => s === 'debate'
    ? hLine('Let me push back on that. Some practitioners would argue that {T} has been fundamentally oversold and that the real-world results simply do not match the theoretical promises. How do you respond to that criticism?', t)
    : hLine('Let us talk about origins. There tends to be a founding moment in every field. What is the origin story of {T}, and who were the early pioneers who made it possible?', t),

  (t, s) => s === 'educational'
    ? hLine('For listeners who want to understand {T} more deeply, what are the three or four key concepts they absolutely need to grasp before they can make sense of anything else in this area?', t)
    : hLine('You mentioned that the ideas transfer across domains. Can you give listeners a concrete example of where {T} showed up somewhere they would not expect, and what the impact was?', t),

  (t, _s) => hLine('What are the common misconceptions that people bring to {T}? What do most people get wrong when they first encounter it?', t),

  (t, s) => s === 'debate'
    ? hLine('Let us steelman the other side one more time. If someone were making the strongest possible argument that {T} is heading in the wrong direction, what would that argument look like?', t)
    : hLine('Talk us through the key milestones. What were the moments that changed how we think about {T}, and why did each one matter?', t),

  (t, _s) => hLine('Where does {T} intersect with other fields? I am curious about the cross-pollination — what ideas from outside {T} have had the biggest influence on how practitioners think?', t),

  (t, s) => s === 'educational'
    ? hLine('If a listener wanted to get started learning {T} seriously, what is the recommended path? Are there foundational resources or frameworks they should prioritize first?', t)
    : hLine('What does the research frontier look like right now? What are the open problems that the best minds in {T} are actively working on?', t),

  (t, _s) => hLine('Let us talk about practical applications. Where is {T} making the biggest difference in the real world right now, and who are the primary beneficiaries of that progress?', t),

  (t, s) => s === 'debate'
    ? hLine('I want to challenge you on the economic side. Critics argue that the costs of investing in {T} consistently outweigh the returns. Is there data that either supports or refutes that?', t)
    : hLine('What about failure modes? Every field has patterns of things going wrong. What are the most common ways that {T} gets applied incorrectly, and what are the consequences?', t),

  (t, _s) => hLine('You mentioned earlier a specific aspect of {T} that I want to come back to. How has the community\'s understanding of that evolved over the last decade, and what drove the shift?', t),

  (t, _s) => hLine('How does the international landscape look? Are there countries or communities that have developed significantly different approaches to {T}, and what can others learn from them?', t),

  (t, s) => s === 'educational'
    ? hLine('What mental models do experts in {T} use to reason through hard problems? Are there particular frameworks or heuristics that separate the practitioners who consistently get results?', t)
    : hLine('Let us talk about the people. What kind of personality or background tends to do well in {T}? And conversely, what assumptions do smart people bring in that hurt them?', t),

  (t, _s) => hLine('I want to zoom out for a moment. Where does {T} fit in the broader intellectual landscape of this decade? Is it a mature field, an emerging one, or something in between?', t),

  (t, s) => s === 'debate'
    ? hLine('Here is a harder question: if the critics turned out to be right about {T}, what would the evidence look like, and are we seeing any early warning signs of that right now?', t)
    : hLine('What surprised you most as you went deeper into {T}? Something that contradicted what you expected when you first started?', t),

  (t, _s) => hLine('Talk me through a specific case study — a situation where the principles of {T} were applied well, and what made the difference between success and a mediocre outcome?', t),

  (t, _s) => hLine('Let us talk about tools and infrastructure. What does the technology stack look like for someone working seriously in {T}, and how has that changed in the last few years?', t),

  (t, s) => s === 'educational'
    ? hLine('What are the most important papers, books, or talks that shaped the current state of {T}? If someone had limited time, what should they read first?', t)
    : hLine('If you had to identify the single biggest unsolved problem in {T} right now, the one that keeps smart people up at night, what would it be?', t),

  (t, _s) => hLine('How do you measure success in {T}? What are the metrics or signals that tell you whether an approach is actually working or just producing the appearance of progress?', t),

  (t, s) => s === 'debate'
    ? hLine('Last challenge: if you were advising someone who was deeply skeptical of {T} — someone who had seen hype cycles come and go — what would you say to honestly address their concerns?', t)
    : hLine('What is the next big shift? If you are projecting five or ten years out, what do you think the landscape of {T} looks like, and what would have to happen for that to come true?', t),
];

const CORE_GUEST_LINES: Array<(topic: string, style: PodcastConversationStyle) => string> = [
  (t, s) => s === 'debate'
    ? hLine('That criticism has real teeth, and I want to take it seriously. The gap between promises and results in {T} is real, and it comes from a combination of unrealistic expectations, poor evaluation practices, and selection bias in what gets published. But the solution is not to abandon {T} — it is to apply it with more rigor and intellectual honesty about where and when it actually works.', t)
    : hLine('The origin story of {T} is genuinely fascinating. Most practitioners trace the formal beginning to a small group of thinkers who decided to apply systematic analysis to what had been treated as intuition or folklore. Once that shift happened, progress came quickly because the methods turned out to be powerful, transferable, and surprisingly general. Understanding that history helps you appreciate why the current debates in the field take the shape they do.', t),

  (t, s) => s === 'educational'
    ? hLine('The four concepts you absolutely need before anything else in {T} are: first, the core abstraction that the field was built on; second, the formal language used to describe problems; third, the key trade-offs that every practitioner encounters; and fourth, the dominant evaluation framework. Get those four things solid and the rest of the field becomes much more legible and you stop feeling like you are missing context.', t)
    : hLine('My favorite example involves a domain that seems completely unrelated to {T} at first glance. It turned out that the core problem being solved there was structurally identical to something that had already been thoroughly studied in {T}. The cross-pollination saved years of work and produced insights that neither community would have reached on its own. That kind of serendipitous connection is one of the reasons I love working in this area.', t),

  (t, _s) => hLine('The biggest misconception is that {T} is simpler than it looks — that the hard parts are just technical details you can delegate. In reality, the deepest challenges in {T} are conceptual and require careful thinking about what you are actually trying to achieve and what evidence would change your mind. People who dismiss those conceptual layers tend to make confident mistakes that take a long time to unwind and can be very costly.', t),

  (t, s) => s === 'debate'
    ? hLine('The strongest argument that {T} is heading in the wrong direction would focus on the incentive structures that have grown up around it. When a field is dominated by metrics that are easy to measure but imperfectly correlated with what actually matters, you get a lot of optimization of the proxy rather than the underlying goal. Whether that is happening in {T} is an empirical question, and I think the honest answer is: somewhat, in some subfields, and it is worth naming.', t)
    : hLine('The key milestones in {T} tend to share a common structure: someone notices a persistent anomaly, builds a framework to explain it, and then that framework reveals entirely new problems that were invisible before. Each shift expands the map and shows you how much territory you did not know you were missing. Looking at {T} through that lens makes the history feel less like a sequence of inventions and more like a series of increasing resolution on the same underlying reality.', t),

  (t, _s) => hLine('{T} has been most productively influenced by ideas from adjacent fields that share similar mathematical or structural foundations. The transfer usually happens when someone realizes that a solved problem in one domain is isomorphic to an open problem in {T}. The challenge is that the language and notation differ enough that the connection is not obvious until someone takes the time to build the translation layer. That translation work is often undervalued but critically important.', t),

  (t, s) => s === 'educational'
    ? hLine('The path I recommend for getting serious about {T} starts with building strong foundations rather than jumping directly to the most exciting applications. Spend time with the canonical introductory materials, even if they feel slow. Then find a project where you are motivated by the problem, not just the technique. The combination of strong foundations and genuine stakes produces the kind of learning that actually sticks and transfers when the specifics change.', t)
    : hLine('The research frontier in {T} right now is defined by a handful of problems that have resisted solution for a long time. What has changed recently is that we have better computational tools and better data, which means we can now empirically test ideas that used to be purely theoretical. That experimental turn is accelerating progress in some areas while also revealing that some cherished theoretical results do not hold as cleanly in practice as we hoped.', t),

  (t, _s) => hLine('The practical applications of {T} that are making the biggest difference right now tend to share a few characteristics: they operate in domains where data is abundant, the cost of errors is measurable, and iteration is fast. When those conditions are met, {T} can produce compounding improvements that are hard to achieve through other means. The challenge is that many high-stakes domains have exactly the opposite characteristics, which is where the field still has a lot of room to grow.', t),

  (t, s) => s === 'debate'
    ? hLine('The economic critique of {T} is worth engaging with carefully because it is not monolithic. For some applications, the return on investment is clearly positive and well-documented. For others, the costs are real and the benefits are diffuse or delayed. The honest answer is that we need better evaluation frameworks — ones that account for opportunity cost, the full cost of implementation, and the distribution of benefits and risks across different stakeholders in the system.', t)
    : hLine('The failure modes in {T} are well-documented but underappreciated in practice. The most common one is applying a technique in a context where its core assumptions do not hold, without noticing that the assumptions are being violated. The second is optimizing for a metric that imperfectly represents the actual goal. Both failures compound over time in ways that can be hard to detect until the consequences become obvious and costly to unwind.', t),

  (t, _s) => hLine('The shift in understanding you are asking about reflects a broader maturation of {T} as a field. Early on, there was a lot of optimism about simple models and clean theoretical guarantees. Over time, sustained engagement with real-world complexity revealed that the interesting action is in the messy middle — where theory gives you guidance but cannot substitute for empirical judgment. The field is better for having gone through that humbling process, even if it took longer than expected.', t),

  (t, _s) => hLine('The international variation in approaches to {T} is larger than most people realize and often reflects different institutional structures, data availability, and cultural attitudes toward risk. Some communities have developed significant advantages by focusing on domains where they have natural data advantages. Others have made theoretical contributions that the rest of the world was slow to appreciate. The field is genuinely global in a way that it was not twenty years ago, and that diversity of approaches is one of its strengths.', t),

  (t, s) => s === 'educational'
    ? hLine('The mental models that distinguish excellent practitioners in {T} tend to be about managing uncertainty and knowing when to trust your model versus when to override it with domain knowledge. The best people I know have a clear internal picture of what their approach assumes and can quickly identify when those assumptions are being stretched. That metacognitive layer — being able to reason about the limits of your own reasoning — is what separates consistently good judgment from occasional insight.', t)
    : hLine('People who thrive in {T} tend to combine genuine curiosity about the underlying phenomena with a high tolerance for ambiguity and a willingness to change their minds based on evidence. The assumptions that hurt smart people when they first enter the field are usually about how clean the problems are and how quickly progress should happen. Real work in {T} involves a lot of time where you do not know if you are making progress, and learning to stay productive in that state is a skill in itself.', t),

  (t, _s) => hLine('{T} occupies an interesting position right now — mature enough to have established methods and a professional community, but active enough that important open questions remain and the landscape is still shifting. That combination creates both opportunities and risks. The opportunity is that the bar to make a genuine contribution is lower than in fully mature fields. The risk is that the rapid pace of development makes it hard to distinguish lasting advances from techniques that work temporarily in narrow contexts.', t),

  (t, s) => s === 'debate'
    ? hLine('If critics turned out to be right about {T}, I would expect to see consistent failure of the main techniques in real-world deployment, growing documentation of unintended consequences, and increasing skepticism from domain practitioners who have tried to apply the methods. Some of those signals are already present in specific subfields, which I think is healthy — it forces more careful thinking. The appropriate response is not defensiveness but rigorous honest evaluation.', t)
    : hLine('The biggest surprise for me was how often the most important work in {T} turns out to be understanding something that failed, rather than celebrating something that worked. The failures are richer in information, and the practitioners who systematically study their failures tend to make faster progress than those who focus primarily on replicating success. That attitude toward failure as information is something I wish the field communicated more clearly to newcomers.', t),

  (t, _s) => hLine('The case study I keep coming back to involves a team that had strong domain knowledge, mediocre technique, and excellent evaluation practices. They consistently outperformed teams with stronger technical skills but weaker domain knowledge and evaluation discipline. The lesson I draw from that is that in {T}, the meta-skills — knowing what question to ask, how to measure success, and when results are trustworthy — matter at least as much as mastery of specific methods.', t),

  (t, _s) => hLine('The tools and infrastructure for {T} have improved dramatically and continue to improve. The practical consequence is that the time from idea to experiment has collapsed for most research questions. That acceleration is mostly positive but it has a subtle downside: it is now easy to run a lot of experiments quickly without understanding any of them deeply. The practitioners who navigate this well combine the ability to move fast with the discipline to understand what they are actually doing and why it works or does not.', t),

  (t, s) => s === 'educational'
    ? hLine('The resources that shaped the current state of {T} most profoundly tend to be a mix of foundational papers that introduced key ideas, textbooks that organized the knowledge into a teachable structure, and practitioner accounts that documented what working with the methods actually looks like. I would prioritize in that order: conceptual foundations first, then organized knowledge, then practical accounts. Rushing to practical application without foundations tends to produce brittle understanding.', t)
    : hLine('The biggest unsolved problem in {T} right now is the gap between what we can demonstrate in controlled settings and what reliably generalizes to new domains and distributions. Progress on that problem requires better theory about when and why methods work, better evaluation practices, and better communication between theorists and practitioners. It is a hard problem because it requires collaboration across groups that often have different incentives, languages, and metrics of success.', t),

  (t, _s) => hLine('Measuring success in {T} is harder than it looks because the naive metrics are often easy to game and imperfectly correlated with what actually matters. The field has been working on this for a long time, and the emerging consensus is that good evaluation requires a portfolio of metrics that probe different aspects of performance, combined with validation in the actual deployment context rather than just in controlled benchmarks. That combination is expensive to do well, which is part of why poor evaluation persists.', t),

  (t, s) => s === 'debate'
    ? hLine('For a deeply skeptical person, I would acknowledge the legitimacy of their skepticism and then try to show them the specific cases where the evidence is strongest. I would not try to sell them on {T} as a whole — that is exactly the kind of sweeping claim that invites backlash. Instead I would say: here are three narrow domains where the effects are well-documented, here is how we measured them, and here is what would change my mind. That kind of epistemic honesty is more persuasive to a sophisticated skeptic than enthusiasm.', t)
    : hLine('Looking five to ten years out in {T}, I expect the biggest changes to come from sustained engagement with the hardest real-world problems rather than from purely technical advances. The techniques are good enough that the limiting factor in most applications is now the quality of problem formulation, evaluation, and deployment infrastructure. The field that learns to do those things well will see compounding returns in impact even without dramatic algorithmic breakthroughs.', t),
];

function buildOutroHost(topic: string): string {
  return hLine(
    'This has been a genuinely illuminating conversation about {T}. Before we close, what is the one thing you most want listeners to take with them — the insight that would change how they think about {T}?',
    topic,
  );
}

function buildOutroGuest(topic: string, level: PodcastAudienceLevel): string {
  if (level === 'beginner') {
    return hLine(
      'The insight I most want listeners to carry away is that {T} is learnable. The concepts are not inaccessible to a motivated person without a technical background. What matters is patience with the early stages, willingness to sit with confusion long enough for things to click, and the practice of connecting what you learn to something you already care about. Start there and the rest follows.',
      topic,
    );
  }
  if (level === 'expert') {
    return hLine(
      'The insight for practitioners is to invest in evaluation infrastructure at least as much as in new methods. The field advances fastest when we can reliably tell what is actually working and why. That requires careful experiment design, honest reporting of failures, and willingness to challenge results that seem too clean. The work is unglamorous but it is what separates durable progress from temporary fashion.',
      topic,
    );
  }
  return hLine(
    'The insight I keep returning to is that {T} rewards sustained attention more than raw intelligence. The people who build genuine depth are not necessarily the ones who found it easiest at the start — they are the ones who stayed curious when things got hard, kept asking why the things that worked actually worked, and accumulated understanding over years rather than trying to shortcut to expertise. That compounding is the real secret.',
    topic,
  );
}

// ─── Mock Transcript Generator ───────────────────────────────────────

function trimToMaxWords(text: string, max: number = MAX_WORDS_PER_TURN - 2): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text;
  // Trim to max words, ending at a sentence boundary if possible
  const truncated = words.slice(0, max).join(' ');
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > truncated.length / 2) return truncated.slice(0, lastPeriod + 1);
  return truncated + '.';
}

function buildMockTranscript(
  topic: string,
  controls: PodcastGenerationControls,
): TranscriptTurn[] {
  const { audienceLevel, durationMinutes, conversationStyle } = controls;
  const targetWords = durationMinutes * CANONICAL_WPM;

  // Host turns avg ~40 words, guest turns avg ~70 words → ~110 words/pair
  const PAIR_AVG = 110;
  const numPairsNeeded = Math.max(2, Math.round(targetWords / PAIR_AVG));

  const turns: TranscriptTurn[] = [];

  // Always add intro pair (trimmed to max)
  turns.push({ speaker: 'host', text: trimToMaxWords(hostIntro(topic, audienceLevel, conversationStyle)) });
  turns.push({ speaker: 'guest', text: trimToMaxWords(guestIntro(topic, audienceLevel, conversationStyle)) });

  // Add core pairs, cycling through templates if needed
  const numCorePairs = numPairsNeeded - 2; // subtract intro + outro
  for (let i = 0; i < numCorePairs; i++) {
    const idx = i % CORE_HOST_LINES.length;
    turns.push({ speaker: 'host', text: trimToMaxWords(CORE_HOST_LINES[idx](topic, conversationStyle)) });
    turns.push({ speaker: 'guest', text: trimToMaxWords(CORE_GUEST_LINES[idx](topic, conversationStyle)) });
  }

  // Add outro pair
  turns.push({ speaker: 'host', text: trimToMaxWords(buildOutroHost(topic)) });
  turns.push({ speaker: 'guest', text: trimToMaxWords(buildOutroGuest(topic, audienceLevel)) });

  return turns;
}

// ─── Mock Provider ───────────────────────────────────────────────────

const INTERVENTION_ANSWER_TEMPLATE = (questionText: string, topic: string): string => {
  // Must be 45-120 words. Template hits ~80 words.
  const shortQ = questionText.length > 60 ? questionText.slice(0, 57) + '...' : questionText;
  return `That is a really sharp question about ${topic}. The key insight here is that ${shortQ.charAt(0).toLowerCase() + shortQ.slice(1)} connects directly to one of the core tensions we have been exploring throughout this conversation. The short answer is that context matters enormously — what works in one setting often needs significant adaptation in another. The practical implication for our listeners is to focus on first principles rather than copying specific implementations. That principle holds whether you are encountering ${topic} for the first time or have been working with it for years.`;
};

function createMockInteractiveService(): InteractiveSessionService {
  return {
    async createSession({ userId, topic, controls }) {
      const elapsedScript = startTimer();
      const turns = buildMockTranscript(topic, controls);

      // Validate (should always pass for mock)
      const validation = validateTranscript(turns, controls.durationMinutes);
      if (!validation.valid) {
        throw new Error(`Mock transcript validation failed: ${validation.errors.join('; ')}`);
      }

      emitTelemetry({
        stage: 'script_generation',
        durationMs: elapsedScript(),
        provider: 'mock',
        success: true,
        correlationId: crypto.randomUUID(),
      });

      const title = `${toTitleCase(topic)} in Conversation`;
      const summary = `An interview-style podcast exploring ${topic} for ${controls.durationMinutes} minutes.`;

      // Group turns into segments (2 per segment = 1 host + 1 guest pair)
      const segments: Array<{ hostLine: string; guestLine: string; status?: 'ready' | 'pending' }> = [];
      for (let i = 0; i < turns.length - 1; i += 2) {
        const isFirst = i === 0;
        segments.push({
          hostLine: turns[i].text,
          guestLine: turns[i + 1].text,
          status: isFirst ? 'ready' : 'pending',
        });
      }

      const elapsedAudio = startTimer();
      const session = createSession({
        userId,
        topic,
        title,
        summary,
        controls,
        generationState: segments.length > 1 ? 'preparing-audio' : 'ready',
        estimatedDurationMinutes: controls.durationMinutes,
        segments,
      });

      // Pre-generate audio for the first segment
      if (session.segments.length > 0) {
        const firstSeg = session.segments[0];
        const wc = countWords(firstSeg.hostLine) + countWords(firstSeg.guestLine);
        const durationMs = Math.max(1500, Math.round((wc / CANONICAL_WPM) * 60 * 1000));
        const audio = createToneWaveBuffer(Math.min(8000, durationMs));
        setSegmentAudio(session.id, firstSeg.id, audio);
      }

      emitTelemetry({
        stage: 'initial_audio_readiness',
        durationMs: elapsedAudio(),
        provider: 'mock',
        success: true,
        correlationId: crypto.randomUUID(),
      });

      return session;
    },

    getSession({ sessionId, userId }) {
      return getOwnedSession(sessionId, userId);
    },

    listSessions({ userId }) {
      return getSessionSummariesByUser(userId);
    },

    deleteSession({ sessionId, userId }) {
      return deleteSession(sessionId, userId);
    },

    async getSegmentAudio({ sessionId, segmentId, userId }) {
      const session = getOwnedSession(sessionId, userId);
      if (!session) return null;

      const segment = session.segments.find((s) => s.id === segmentId);
      if (!segment || segment.status === 'stale') return null;

      // Check cache first
      const cached = getSegmentAudio(segmentId, sessionId);
      if (cached) return cached;

      // Generate on-demand for pending segments
      const wc = countWords(segment.hostLine) + countWords(segment.guestLine);
      const durationMs = Math.max(1500, Math.round((wc / CANONICAL_WPM) * 60 * 1000));
      const audio = createToneWaveBuffer(Math.min(8000, durationMs));
      setSegmentAudio(session.id, segmentId, audio);

      // Update segment status to ready
      updateSegmentStatus(session, segment, 'ready');

      return audio;
    },

    async processInterrupt({ sessionId, userId, questionText, inputMethod, afterSegmentId, clientRequestId }) {
      const session = getOwnedSession(sessionId, userId);
      if (!session) throw new SessionNotFoundError('Session not found');

      const interrupt = beginInterrupt(session, {
        clientRequestId,
        afterSegmentId,
        questionText,
        inputMethod,
      });

      if (session.pendingInterruptId !== interrupt.id) {
        return { session, newSegments: [] };
      }

      try {
        const newSegmentData = buildMockInterruptSegments(questionText, session.topic);
        return completeInterrupt(session, interrupt.id, newSegmentData);
      } catch (error) {
        failInterrupt(session);
        throw error;
      }
    },

    async processIntervention({ sessionId, userId, questionText, afterSegmentId, clientRequestId, playbackPositionSeconds }) {
      const session = getOwnedSession(sessionId, userId);
      if (!session) throw new SessionNotFoundError('Session not found');

      // Verify segment exists
      const afterSeg = session.segments.find((s) => s.id === afterSegmentId && s.status !== 'stale');
      if (!afterSeg) throw new SessionNotFoundError('Segment not found');

      const elapsedQ = startTimer();
      const intervention = createIntervention({
        sessionId,
        clientRequestId,
        afterSegmentId,
        questionText,
        capturedPositionSeconds: playbackPositionSeconds,
      });

      // If already processed (idempotent), return existing
      if (intervention.state === 'ready' || intervention.state === 'failed' || intervention.state === 'cancelled') {
        return { intervention };
      }

      emitTelemetry({
        stage: 'question_acknowledgement',
        durationMs: elapsedQ(),
        provider: 'mock',
        success: true,
        correlationId: intervention.id,
      });

      const elapsedA = startTimer();
      if (process.env.NODE_ENV !== 'production' && process.env.MOCK_INTERVENTION_FAILURE === 'true') {
        const failed = updateIntervention(intervention.id, { state: 'failed' })
          ?? { ...intervention, state: 'failed' as const };
        emitTelemetry({
          stage: 'answer_readiness',
          durationMs: elapsedA(),
          provider: 'mock',
          success: false,
          correlationId: intervention.id,
          errorCode: 'MOCK_INTERVENTION_FAILED',
        });
        return { intervention: failed };
      }

      // Generate answer (45-120 words)
      const answerText = INTERVENTION_ANSWER_TEMPLATE(questionText, session.topic);

      // Synthesize answer audio (store with intervention-prefixed key)
      const wc = countWords(answerText);
      const durationMs = Math.max(2000, Math.round((wc / CANONICAL_WPM) * 60 * 1000));
      const audio = createToneWaveBuffer(Math.min(6000, durationMs));
      setSegmentAudio(session.id, `intervention-${intervention.id}`, audio);

      const updated = updateIntervention(intervention.id, { state: 'ready', answerText });

      emitTelemetry({
        stage: 'answer_readiness',
        durationMs: elapsedA(),
        provider: 'mock',
        success: true,
        correlationId: intervention.id,
      });

      return { intervention: updated ?? { ...intervention, state: 'ready', answerText } };
    },

    async getInterventionAudio({ sessionId, interventionId, userId }) {
      const session = getOwnedSession(sessionId, userId);
      if (!session) return null;

      const intervention = getIntervention(interventionId, sessionId);
      if (!intervention || intervention.state !== 'ready') return null;

      return getSegmentAudio(`intervention-${interventionId}`, sessionId) ?? null;
    },

    async cancelIntervention({ sessionId, interventionId, userId }) {
      return cancelIntervention(interventionId, sessionId, userId);
    },
  };
}

// ─── Unavailable Service (production guard) ──────────────────────────

function createUnavailableService(
  message = 'Interactive session service requires PODCAST_PROVIDER=azure in production. Configure Azure OpenAI and Azure Speech to use this feature.',
): InteractiveSessionService {
  const unavailable = (): never => {
    throw new ProviderUnavailableError(message);
  };

  return {
    createSession: () => unavailable(),
    getSession: ({ sessionId, userId }) => getOwnedSession(sessionId, userId),
    listSessions: ({ userId }) => getSessionSummariesByUser(userId),
    deleteSession: ({ sessionId, userId }) => deleteSession(sessionId, userId),
    getSegmentAudio: () => unavailable(),
    processInterrupt: () => unavailable(),
    processIntervention: () => unavailable(),
    getInterventionAudio: () => unavailable(),
    cancelIntervention: () => Promise.resolve(false),
  };
}

// ─── Azure Provider ──────────────────────────────────────────────────

const AZURE_SCOPE = 'https://cognitiveservices.azure.com/.default';
const DEFAULT_OPENAI_API_VERSION = '2024-10-21';
const DEFAULT_HOST_VOICE = 'en-US-JennyNeural';
const DEFAULT_GUEST_VOICE = 'en-US-GuyNeural';

interface AzureInteractiveConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  speechRegion: string;
  speechResourceId?: string;
  openAiApiKey?: string;
  speechKey?: string;
  hostVoice: string;
  guestVoice: string;
  credential?: TokenCredential;
}

interface AzureScript {
  title: string;
  summary: string;
  turns: TranscriptTurn[];
}

function readAzureInteractiveConfig(): AzureInteractiveConfig {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim().replace(/\/$/, '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME?.trim();
  const speechRegion = process.env.AZURE_SPEECH_REGION?.trim();
  const openAiApiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  const speechKey = process.env.AZURE_SPEECH_KEY?.trim();
  const speechResourceId = process.env.AZURE_SPEECH_RESOURCE_ID?.trim();
  const credential = createK8sFederatedAadCredentialFromEnv() ?? new DefaultAzureCredential();

  if (!endpoint || !deployment || !speechRegion) {
    throw new ProviderUnavailableError(
      'Azure podcast generation requires AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT_NAME, and AZURE_SPEECH_REGION.',
    );
  }
  if ((!openAiApiKey || !speechKey) && !speechResourceId) {
    throw new ProviderUnavailableError(
      'Azure podcast generation requires matching API keys or AZURE_SPEECH_RESOURCE_ID for managed identity.',
    );
  }

  return {
    endpoint,
    deployment,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim() || DEFAULT_OPENAI_API_VERSION,
    speechRegion,
    speechResourceId,
    openAiApiKey,
    speechKey,
    hostVoice: process.env.PODCAST_HOST_VOICE?.trim() || DEFAULT_HOST_VOICE,
    guestVoice: process.env.PODCAST_GUEST_VOICE?.trim() || DEFAULT_GUEST_VOICE,
    credential,
  };
}

async function getAzureToken(config: AzureInteractiveConfig): Promise<string> {
  const token = await config.credential?.getToken(AZURE_SCOPE);
  if (!token?.token) {
    throw new ProviderUnavailableError('Managed identity did not return an Azure AI access token.');
  }
  return token.token;
}

async function azureOpenAiHeaders(config: AzureInteractiveConfig): Promise<Record<string, string>> {
  if (config.openAiApiKey) {
    return { 'Content-Type': 'application/json', 'api-key': config.openAiApiKey };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await getAzureToken(config)}`,
  };
}

async function azureSpeechHeaders(config: AzureInteractiveConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/ssml+xml',
    'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm',
    'User-Agent': 'azure-podcast-generator',
  };
  if (config.speechKey) {
    headers['Ocp-Apim-Subscription-Key'] = config.speechKey;
  } else {
    const token = await getAzureToken(config);
    headers.Authorization = `Bearer aad#${config.speechResourceId}#${token}`;
  }
  return headers;
}

function audienceGuidance(level: PodcastAudienceLevel): string {
  if (level === 'beginner') return 'Use plain language, define unavoidable terms, and build from first principles.';
  if (level === 'expert') return 'Assume domain fluency and use precise technical terminology, trade-offs, and evidence.';
  return 'Assume general familiarity, explain specialized terms briefly, and balance clarity with substantive detail.';
}

function styleGuidance(style: PodcastConversationStyle): string {
  if (style === 'educational') return 'Teach progressively, use concrete examples, and recap key ideas naturally.';
  if (style === 'debate') return 'Present strong competing views, challenge assumptions respectfully, and resolve disagreements honestly.';
  return 'Keep the exchange warm and conversational with brief acknowledgements and natural follow-up questions.';
}

async function callAzureJson(
  config: AzureInteractiveConfig,
  system: string,
  user: string,
  schemaName: string,
  schema: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion)}`,
    {
      method: 'POST',
      headers: await azureOpenAiHeaders(config),
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.72,
        max_tokens: 6500,
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema },
        },
      }),
    },
  );
  if (!response.ok) {
    throw new ProviderGenerationError(
      `Azure OpenAI generation failed with status ${response.status}.`,
      'AZURE_OPENAI_FAILED',
    );
  }
  const envelope = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = envelope.choices?.[0]?.message?.content;
  if (!content) {
    throw new ProviderGenerationError('Azure OpenAI returned an empty response.', 'AZURE_OPENAI_EMPTY');
  }
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new ProviderGenerationError('Azure OpenAI returned invalid structured output.', 'AZURE_OPENAI_INVALID');
  }
}

async function generateAzureScript(
  config: AzureInteractiveConfig,
  topic: string,
  controls: PodcastGenerationControls,
): Promise<AzureScript> {
  const targetWords = controls.durationMinutes * CANONICAL_WPM;
  const system = [
    'Write a genuine interview-style podcast between a host and expert guest.',
    `Target approximately ${targetWords} spoken words for ${controls.durationMinutes} minutes, within plus or minus 20 percent.`,
    audienceGuidance(controls.audienceLevel),
    styleGuidance(controls.conversationStyle),
    'Use short strictly alternating host and guest turns. Every turn must contain 1 to 80 words.',
    'Include natural transitions and occasional acknowledgements, avoid repetition, and keep every claim relevant to the topic.',
  ].join(' ');
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      turns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            speaker: { type: 'string', enum: ['host', 'guest'] },
            text: { type: 'string' },
          },
          required: ['speaker', 'text'],
        },
      },
    },
    required: ['title', 'summary', 'turns'],
  };

  let validationMessage = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = await callAzureJson(
      config,
      system,
      attempt === 0
        ? `Create the episode about: ${topic}`
        : `Regenerate the episode about: ${topic}. The previous result was invalid: ${validationMessage}`,
      'podcast_episode',
      schema,
    );
    const turns = Array.isArray(parsed.turns)
      ? parsed.turns.flatMap((value): TranscriptTurn[] => {
          if (!value || typeof value !== 'object') return [];
          const turn = value as Record<string, unknown>;
          if ((turn.speaker !== 'host' && turn.speaker !== 'guest') || typeof turn.text !== 'string') return [];
          return [{ speaker: turn.speaker, text: turn.text.trim() }];
        })
      : [];
    const validation = validateTranscript(turns, controls.durationMinutes);
    if (validation.valid) {
      return {
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : `${toTitleCase(topic)} in Conversation`,
        summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : `An expert conversation about ${topic}.`,
        turns,
      };
    }
    validationMessage = validation.errors.join('; ');
  }
  throw new ProviderGenerationError(
    'Azure OpenAI could not produce a valid podcast transcript after one regeneration attempt.',
    'INVALID_TRANSCRIPT',
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function synthesizeAzureTurns(
  config: AzureInteractiveConfig,
  turns: TranscriptTurn[],
): Promise<Buffer> {
  const voices = turns.map((turn) => {
    const voice = turn.speaker === 'host' ? config.hostVoice : config.guestVoice;
    return `<voice name="${escapeXml(voice)}">${escapeXml(turn.text)}</voice>`;
  }).join('<break time="250ms"/>');
  const response = await fetch(
    `https://${encodeURIComponent(config.speechRegion)}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: await azureSpeechHeaders(config),
      body: `<speak version="1.0" xml:lang="en-US">${voices}</speak>`,
    },
  );
  if (!response.ok) {
    throw new ProviderGenerationError(
      `Azure Speech synthesis failed with status ${response.status}.`,
      'AZURE_SPEECH_FAILED',
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function segmentTurns(segment: PodcastSegment): TranscriptTurn[] {
  return [
    { speaker: 'host', text: segment.hostLine },
    { speaker: 'guest', text: segment.guestLine },
  ];
}

async function generateAzureAnswer(
  config: AzureInteractiveConfig,
  session: PodcastSession,
  questionText: string,
): Promise<string> {
  const recent = session.segments.slice(-5).flatMap(segmentTurns);
  const parsed = await callAzureJson(
    config,
    'Answer a listener question during a podcast. Give one concise, self-contained answer of 45 to 120 words (about 20 to 45 seconds). Do not repeat or quote the question. Return only the structured answer.',
    `Recent conversation:\n${recent.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n')}\nListener question: ${questionText}`,
    'podcast_intervention',
    {
      type: 'object',
      additionalProperties: false,
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
  );
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  const words = countWords(answer);
  if (words < 45 || words > 120) {
    throw new ProviderGenerationError(
      'Azure OpenAI returned an intervention answer outside the 20 to 45 second target.',
      'INVALID_INTERVENTION_ANSWER',
    );
  }
  return answer;
}

function createAzureInteractiveService(): InteractiveSessionService {
  const config = readAzureInteractiveConfig();

  return {
    async createSession({ userId, topic, controls }) {
      assertSessionCapacity(userId);
      const timer = startTimer();
      const correlationId = crypto.randomUUID();
      try {
        const script = await generateAzureScript(config, topic, controls);
        emitTelemetry({ stage: 'script_generation', durationMs: timer(), provider: 'azure', success: true, correlationId });
        const segments = [];
        for (let i = 0; i < script.turns.length; i += 2) {
          segments.push({
            hostLine: script.turns[i].text,
            guestLine: script.turns[i + 1].text,
            status: i === 0 ? 'ready' as const : 'pending' as const,
          });
        }
        const session = createSession({
          userId,
          topic,
          title: script.title,
          summary: script.summary,
          controls,
          generationState: segments.length > 1 ? 'preparing-audio' : 'ready',
          estimatedDurationMinutes: controls.durationMinutes,
          segments,
        });
        const audioTimer = startTimer();
        const first = session.segments[0];
        let firstAudio: Buffer;
        try {
          firstAudio = await synthesizeAzureTurns(config, segmentTurns(first));
        } catch (error) {
          deleteSession(session.id, userId);
          emitTelemetry({
            stage: 'initial_audio_readiness',
            durationMs: audioTimer(),
            provider: 'azure',
            success: false,
            correlationId: session.id,
            errorCode: error instanceof ProviderGenerationError ? error.code : 'AZURE_SPEECH_FAILED',
          });
          throw error;
        }
        setSegmentAudio(session.id, first.id, firstAudio);
        emitTelemetry({ stage: 'initial_audio_readiness', durationMs: audioTimer(), provider: 'azure', success: true, correlationId: session.id });
        return session;
      } catch (error) {
        emitTelemetry({
          stage: 'script_generation',
          durationMs: timer(),
          provider: 'azure',
          success: false,
          correlationId,
          errorCode: error instanceof ProviderGenerationError ? error.code : 'AZURE_PROVIDER_FAILED',
        });
        throw error;
      }
    },
    getSession: ({ sessionId, userId }) => getOwnedSession(sessionId, userId),
    listSessions: ({ userId }) => getSessionSummariesByUser(userId),
    deleteSession: ({ sessionId, userId }) => deleteSession(sessionId, userId),
    async getSegmentAudio({ sessionId, segmentId, userId }) {
      const session = getOwnedSession(sessionId, userId);
      if (!session) return null;
      const segment = session.segments.find((value) => value.id === segmentId && value.status !== 'stale');
      if (!segment) return null;
      const cached = getSegmentAudio(segmentId, sessionId);
      if (cached) return cached;
      try {
        const audio = await synthesizeAzureTurns(config, segmentTurns(segment));
        setSegmentAudio(sessionId, segmentId, audio);
        updateSegmentStatus(session, segment, 'ready');
        return audio;
      } catch (error) {
        updateSegmentStatus(session, segment, 'failed');
        throw error;
      }
    },
    async processInterrupt(input) {
      const result = await this.processIntervention({
        ...input,
        playbackPositionSeconds: 0,
      });
      const session = getOwnedSession(input.sessionId, input.userId);
      if (!session) throw new SessionNotFoundError('Session not found');
      return { session, newSegments: result.intervention.state === 'ready' ? [] : [] };
    },
    async processIntervention({ sessionId, userId, questionText, afterSegmentId, clientRequestId, playbackPositionSeconds }) {
      const session = getOwnedSession(sessionId, userId);
      if (!session) throw new SessionNotFoundError('Session not found');
      if (!session.segments.some((segment) => segment.id === afterSegmentId && segment.status !== 'stale')) {
        throw new SessionNotFoundError('Segment not found');
      }
      const acknowledgementTimer = startTimer();
      const intervention = createIntervention({
        sessionId,
        clientRequestId,
        afterSegmentId,
        questionText,
        capturedPositionSeconds: playbackPositionSeconds,
      });
      if (intervention.state === 'ready' || intervention.state === 'failed' || intervention.state === 'cancelled') {
        return { intervention };
      }
      emitTelemetry({ stage: 'question_acknowledgement', durationMs: acknowledgementTimer(), provider: 'azure', success: true, correlationId: intervention.id });
      const answerTimer = startTimer();
      try {
        updateIntervention(intervention.id, { state: 'answering' });
        const answerText = await generateAzureAnswer(config, session, questionText);
        const audio = await synthesizeAzureTurns(config, [{ speaker: 'guest', text: answerText }]);
        const current = getIntervention(intervention.id, sessionId);
        if (current?.state === 'cancelled') {
          return { intervention: current };
        }
        setSegmentAudio(session.id, `intervention-${intervention.id}`, audio);
        const updated = updateIntervention(intervention.id, { state: 'ready', answerText }) ?? { ...intervention, state: 'ready' as const, answerText };
        emitTelemetry({ stage: 'answer_readiness', durationMs: answerTimer(), provider: 'azure', success: true, correlationId: intervention.id });
        return { intervention: updated };
      } catch (error) {
        const errorCode = error instanceof ProviderGenerationError ? error.code : 'INTERVENTION_FAILED';
        const failed = updateIntervention(intervention.id, { state: 'failed' }) ?? { ...intervention, state: 'failed' as const };
        emitTelemetry({ stage: 'answer_readiness', durationMs: answerTimer(), provider: 'azure', success: false, correlationId: intervention.id, errorCode });
        return { intervention: failed };
      }
    },
    async getInterventionAudio({ sessionId, interventionId, userId }) {
      const session = getOwnedSession(sessionId, userId);
      if (!session) return null;
      const intervention = getIntervention(interventionId, sessionId);
      if (!intervention || intervention.state !== 'ready') return null;
      return getSegmentAudio(`intervention-${interventionId}`, sessionId) ?? null;
    },
    async cancelIntervention({ sessionId, interventionId, userId }) {
      return cancelIntervention(interventionId, sessionId, userId);
    },
  };
}

// ─── Shared Helpers ──────────────────────────────────────────────────

function updateSegmentStatus(session: PodcastSession, segment: PodcastSegment, status: 'ready' | 'failed'): void {
  segment.status = status;
  session.updatedAt = new Date().toISOString();
  if (status === 'ready' && session.segments.every((value) => value.status === 'ready' || value.status === 'stale')) {
    session.generationState = 'ready';
  }
  getDatabase().prepare('UPDATE segments SET status = ? WHERE id = ?').run(status, segment.id);
  getDatabase().prepare('UPDATE sessions SET generation_state = ?, updated_at = ? WHERE id = ?')
    .run(session.generationState, session.updatedAt, session.id);
}

function buildMockInterruptSegments(questionText: string, topic: string): Array<{ hostLine: string; guestLine: string }> {
  return [
    {
      hostLine: `Great question from our listener about ${topic}: "${questionText.slice(0, 80)}" — let me put that to our guest.`,
      guestLine: `That is an interesting angle on ${topic}. ${questionText.toLowerCase().includes('why') ? 'The reason behind this goes back to the foundational decisions made early on in the field.' : 'There are several perspectives worth exploring here, each of which illuminates a different aspect of what we have been discussing.'} When you look at it carefully, you start to see how the surface question opens up deeper issues about how we understand ${topic} and what it means in practice.`,
    },
    {
      hostLine: `That opens up a whole new dimension. Where does this insight about ${topic} take us next?`,
      guestLine: `Building on that question, the most important thing to understand is how this connects to the broader narrative we have been tracing throughout this conversation. The specific example you asked about is actually a microcosm of the bigger pattern: context shapes outcomes in ways that general principles alone cannot fully predict. That is true in ${topic} and it is true more broadly.`,
    },
  ];
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createInteractiveSessionService(): InteractiveSessionService {
  const isProduction = process.env.NODE_ENV === 'production';
  const configuredProvider = process.env.PODCAST_PROVIDER?.trim().toLowerCase();

  // In production, absence of explicit PODCAST_PROVIDER=azure is an error.
  if (isProduction && configuredProvider !== 'azure') {
    return createUnavailableService();
  }

  if (configuredProvider === 'azure') {
    try {
      return createAzureInteractiveService();
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        return createUnavailableService(error.message);
      }
      throw error;
    }
  }

  return createMockInteractiveService();
}

// ─── Utils ───────────────────────────────────────────────────────────

function toTitleCase(value: string): string {
  return value.trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
