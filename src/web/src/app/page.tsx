'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, toApiUrl } from './lib/api';
import { useSpeechRecognition } from './lib/use-speech-recognition';

type Speaker = 'host' | 'guest';

interface CastSegment {
  index: number;
  speaker: Speaker;
  text: string;
}

type Phase = 'idle' | 'starting' | 'playing' | 'asking' | 'error';

const HOST_NAME = 'Riley';
const GUEST_NAME = 'Sam';

// Default host (interviewer) voice — the user wants the interviewer to sound
// like Chrome's "Google español de Estados Unidos (es-US)" out of the box.
// Keep it as a substring + lang pair so we still match if a future Chrome
// build renames it slightly. Listeners can override from the voice picker.
const HOST_DEFAULT_VOICE_NAME = 'google español de estados unidos';
const HOST_DEFAULT_VOICE_LANG = 'es-us';

// Voice name hints in priority order. Lower-cased substrings — first match wins.
// Covers Apple (Safari/iOS), Microsoft Edge/Windows, Google Chrome, plus a
// generic gendered fallback so even unknown engines pick distinct voices.
// The interviewer (host) prefers a Spanish (es-US) voice; the guest stays
// English so the two speakers sound clearly different.
const HOST_VOICE_HINTS = [
  // Spanish (es-US) — preferred for the interviewer.
  'google español de estados unidos',
  'paulina',
  'monica',
  'jorge',
  // Microsoft Natural / Edge — Spanish fallbacks
  'dalia',
  'paloma',
  'jenny multilingual',
  // Microsoft Natural / Edge — English
  'aria',
  'jenny',
  'jessa',
  'libby',
  // Apple — English
  'samantha',
  'allison',
  'serena',
  'karen',
  'tessa',
  'victoria',
  'ava',
  'susan',
  'moira',
  'fiona',
  // Google
  'google us english female',
  'google uk english female',
  'google us english',
  // Generic gender hints (some engines report "Microsoft Zira - English (United States)" etc)
  'female',
  'woman',
  'zira',
];

const GUEST_VOICE_HINTS = [
  // Microsoft Natural / Edge
  'guy',
  'davis',
  'tony',
  'ryan',
  'andrew',
  'brian',
  // Apple
  'daniel',
  'fred',
  'alex',
  'tom',
  'oliver',
  'arthur',
  'lee',
  'bruce',
  'aaron',
  'rishi',
  // Google
  'google us english male',
  'google uk english male',
  // Generic gender hints
  'male',
  'man',
  'mark',
  'david',
];

// Pick a voice for the host. Prefers Chrome's "Google español de Estados
// Unidos" (es-US) when present, otherwise walks HOST_VOICE_HINTS across the
// English pool. Returns null when no voices are available yet.
function chooseHostVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  // First try the explicit es-US Google voice (substring + lang match) — this
  // is the in-car listener default.
  const preferred = voices.find(
    (v) =>
      v.name.toLowerCase().includes(HOST_DEFAULT_VOICE_NAME) &&
      v.lang.toLowerCase().startsWith(HOST_DEFAULT_VOICE_LANG),
  );
  if (preferred) return preferred;
  // Then try other Spanish (es-US) voices, since the listener asked for an
  // es-US interviewer specifically.
  const esUS = voices.find((v) => v.lang.toLowerCase().startsWith('es-us'));
  if (esUS) return esUS;
  // Finally fall back to the host hints (English pool).
  return chooseVoice(voices, HOST_VOICE_HINTS, null);
}

function chooseVoice(
  voices: SpeechSynthesisVoice[],
  hints: string[],
  avoid: SpeechSynthesisVoice | null,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = en.length ? en : voices;

  for (const hint of hints) {
    const found = pool.find(
      (v) => v.name.toLowerCase().includes(hint) && (!avoid || v.voiceURI !== avoid.voiceURI),
    );
    if (found) return found;
  }

  // Fallback: any voice that isn't `avoid`.
  const distinct = pool.find((v) => !avoid || v.voiceURI !== avoid.voiceURI);
  return distinct ?? pool[0] ?? null;
}

interface VoicePair {
  host: SpeechSynthesisVoice | null;
  guest: SpeechSynthesisVoice | null;
}

interface CastMeta {
  id: string;
  topic: string;
  style: string;
  createdAt: string;
  provider: string;
  modelDisplayName: string;
  systemPrompt: string;
  systemPromptIsOverride?: boolean;
  modelIsOverride?: boolean;
}

const SPEED_PRESETS = [0.85, 1.0, 1.15, 1.3, 1.5, 1.75] as const;
const DEFAULT_SPEED_INDEX = 1; // 1.0x
const SPEED_STORAGE_KEY = 'podcraft.playback.speed';
const STYLE_STORAGE_KEY = 'podcraft.style.preset';
const MODEL_STORAGE_KEY = 'podcraft.config.model';
const SYSTEM_PROMPT_STORAGE_KEY = 'podcraft.config.systemPrompt';
const CONFIG_OPEN_STORAGE_KEY = 'podcraft.config.open';
const HOST_VOICE_STORAGE_KEY = 'podcraft.voice.host';
const GUEST_VOICE_STORAGE_KEY = 'podcraft.voice.guest';
const HOST_PITCH_STORAGE_KEY = 'podcraft.pitch.host';
const GUEST_PITCH_STORAGE_KEY = 'podcraft.pitch.guest';
// Per-speaker pitch slider range. Most engines clamp pitch to [0, 2] with 1.0
// being neutral; we narrow that to a useful musical range so the slider feels
// responsive without anyone landing on a chipmunk preset by accident.
const PITCH_MIN = 0.5;
const PITCH_MAX = 1.6;
const DEFAULT_HOST_PITCH = 1.18;
const DEFAULT_GUEST_PITCH = 0.82;

function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return SPEED_PRESETS[DEFAULT_SPEED_INDEX];
  return Math.max(0.6, Math.min(2.0, n));
}

function clampPitch(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, n));
}

// Score a voice by how natural it's likely to sound. Engines that ship
// "neural", "natural", "online", or "premium" voices win over the legacy
// formant-synth ones. Used to push the best voices to the top of the picker.
function voiceQualityScore(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase();
  let score = 0;
  if (/(neural|natural)/i.test(name)) score += 100;
  if (/(online|cloud|premium|enhanced|hd)/i.test(name)) score += 60;
  if (/^google /i.test(name)) score += 40; // Chrome's online voices
  if (/^microsoft /i.test(name)) score += 30;
  if (v.localService === false) score += 25; // remote/online tend to be better
  if (v.lang.toLowerCase().startsWith('en')) score += 10;
  if (v.default) score += 5;
  return score;
}

// Sort voices: English first, then by quality score, then alphabetical.
function rankVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => {
    const aEn = a.lang.toLowerCase().startsWith('en') ? 0 : 1;
    const bEn = b.lang.toLowerCase().startsWith('en') ? 0 : 1;
    if (aEn !== bEn) return aEn - bEn;
    const aScore = voiceQualityScore(a);
    const bScore = voiceQualityScore(b);
    if (aScore !== bScore) return bScore - aScore;
    return a.name.localeCompare(b.name);
  });
}

function selectVoicePair(voices: SpeechSynthesisVoice[]): VoicePair {
  const host = chooseHostVoice(voices);
  const guest = chooseVoice(voices, GUEST_VOICE_HINTS, host);
  return { host, guest };
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [topic, setTopic] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [styleInput, setStyleInput] = useState('');
  // Listener-supplied LLM config. Empty string = use server defaults. We
  // surface these on the start screen so the listener can pin a different
  // deployment (e.g. gpt-4o-mini) or rewrite the host's persona prompt
  // before pressing Go. Persisted to localStorage so the override sticks
  // across sessions.
  const [modelInput, setModelInput] = useState('');
  const [systemPromptInput, setSystemPromptInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [questionInput, setQuestionInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentSegment, setCurrentSegment] = useState<CastSegment | null>(null);
  const [streamFinished, setStreamFinished] = useState(false);
  const [meta, setMeta] = useState<CastMeta | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  // Playback speed multiplier — applied on top of the per-speaker rate.
  // Restored from localStorage so the listener's preference sticks.
  const [speed, setSpeed] = useState<number>(SPEED_PRESETS[DEFAULT_SPEED_INDEX]);

  // Internal sub-mode of the asking phase: 'voice' uses the microphone,
  // 'text' uses the typed-input fallback. Default to voice when supported,
  // and let the listener flip to text from the asking screen.
  const [askMode, setAskMode] = useState<'voice' | 'text'>('voice');

  // Voice picker state. `voicesAvailable` is the live list of voices the
  // browser exposes (re-fetched on `voiceschanged`). `hostVoiceURI` /
  // `guestVoiceURI` are the URIs the listener has explicitly chosen — null
  // means "use the auto-pick fallback". `hostPitch` / `guestPitch` are
  // per-speaker pitch multipliers stored separately so the listener can tame
  // an artificial-sounding voice without changing which voice plays.
  const [voicesAvailable, setVoicesAvailable] = useState<SpeechSynthesisVoice[]>([]);
  const [hostVoiceURI, setHostVoiceURI] = useState<string | null>(null);
  const [guestVoiceURI, setGuestVoiceURI] = useState<string | null>(null);
  const [hostPitch, setHostPitch] = useState<number>(DEFAULT_HOST_PITCH);
  const [guestPitch, setGuestPitch] = useState<number>(DEFAULT_GUEST_PITCH);
  const [showVoices, setShowVoices] = useState(false);
  // Available chat-capable Azure OpenAI deployments — fetched once on mount
  // and used to populate the model dropdown. Empty string === "use server
  // default", which is what the cast service does when modelInput is "".
  const [availableModels, setAvailableModels] = useState<
    Array<{ deployment: string; model: string }>
  >([]);
  const [defaultModelDeployment, setDefaultModelDeployment] = useState<string>('');
  const [modelsSource, setModelsSource] = useState<'azure' | 'fallback' | 'cache' | null>(null);

  const queueRef = useRef<CastSegment[]>([]);
  const speakingRef = useRef<boolean>(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const voicePairRef = useRef<VoicePair>({ host: null, guest: null });
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // User overrides for which voice each speaker should use. Read inside
  // speakNext via refs so changing a voice doesn't drop the in-flight queue.
  const hostVoiceURIRef = useRef<string | null>(null);
  const guestVoiceURIRef = useRef<string | null>(null);
  const hostPitchRef = useRef<number>(DEFAULT_HOST_PITCH);
  const guestPitchRef = useRef<number>(DEFAULT_GUEST_PITCH);
  // Latest speed in a ref so speakNext sees it without re-creating the callback
  // (which would risk dropping the in-flight queue).
  const speedRef = useRef<number>(SPEED_PRESETS[DEFAULT_SPEED_INDEX]);
  // Highest segment index we've received so far. -1 means none yet.
  // Used as `?since=lastIndex+1` when reconnecting after asking a question
  // so the server doesn't replay segments we already heard.
  const lastSegmentIndexRef = useRef<number>(-1);
  const speechSupported = useMemo(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
    [],
  );

  // Restore persisted speed + last-used style on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SPEED_STORAGE_KEY);
      if (raw) {
        const n = clampSpeed(Number.parseFloat(raw));
        setSpeed(n);
        speedRef.current = n;
      }
      const lastStyle = window.localStorage.getItem(STYLE_STORAGE_KEY);
      if (lastStyle) setStyleInput(lastStyle);
      const savedModel = window.localStorage.getItem(MODEL_STORAGE_KEY);
      if (savedModel) setModelInput(savedModel);
      const savedPrompt = window.localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
      if (savedPrompt) setSystemPromptInput(savedPrompt);
      const configOpen = window.localStorage.getItem(CONFIG_OPEN_STORAGE_KEY);
      // Auto-open the configure panel if the listener had it open last time
      // OR they previously stashed a non-default value (so they can see it).
      if (configOpen === '1' || savedModel || savedPrompt) setShowConfig(true);

      const savedHostVoice = window.localStorage.getItem(HOST_VOICE_STORAGE_KEY);
      if (savedHostVoice) {
        setHostVoiceURI(savedHostVoice);
        hostVoiceURIRef.current = savedHostVoice;
      }
      const savedGuestVoice = window.localStorage.getItem(GUEST_VOICE_STORAGE_KEY);
      if (savedGuestVoice) {
        setGuestVoiceURI(savedGuestVoice);
        guestVoiceURIRef.current = savedGuestVoice;
      }
      const savedHostPitch = window.localStorage.getItem(HOST_PITCH_STORAGE_KEY);
      if (savedHostPitch) {
        const n = clampPitch(Number.parseFloat(savedHostPitch), DEFAULT_HOST_PITCH);
        setHostPitch(n);
        hostPitchRef.current = n;
      }
      const savedGuestPitch = window.localStorage.getItem(GUEST_PITCH_STORAGE_KEY);
      if (savedGuestPitch) {
        const n = clampPitch(Number.parseFloat(savedGuestPitch), DEFAULT_GUEST_PITCH);
        setGuestPitch(n);
        guestPitchRef.current = n;
      }
    } catch {
      /* localStorage unavailable — fall back to defaults */
    }
  }, []);

  // Keep speedRef in sync with state.
  useEffect(() => {
    speedRef.current = speed;
    try {
      window.localStorage?.setItem(SPEED_STORAGE_KEY, String(speed));
    } catch {
      /* ignore */
    }
  }, [speed]);

  // Fetch the chat-capable Azure OpenAI deployments visible to the API.
  // Done once on mount; the API caches the upstream call for 60s. If the
  // listener had previously stashed a model name that's no longer in the
  // list, clear it so the dropdown lands on a real value.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/cast/models');
        if (!res.ok) return;
        const data = (await res.json()) as {
          models?: Array<{ deployment?: unknown; model?: unknown }>;
          defaultDeployment?: unknown;
          source?: unknown;
        };
        if (cancelled) return;
        const cleaned = (data.models ?? [])
          .map((m) => ({
            deployment: typeof m.deployment === 'string' ? m.deployment : '',
            model: typeof m.model === 'string' ? m.model : '',
          }))
          .filter((m) => m.deployment.length > 0);
        setAvailableModels(cleaned);
        if (typeof data.defaultDeployment === 'string') {
          setDefaultModelDeployment(data.defaultDeployment);
        }
        if (typeof data.source === 'string') {
          setModelsSource(data.source as 'azure' | 'fallback' | 'cache');
        }
        // Stale-model guard: drop the persisted override if it isn't in the
        // live list. Otherwise the user could end up calling a deployment
        // that was renamed/deleted.
        setModelInput((prev) => {
          if (!prev) return prev;
          if (cleaned.some((m) => m.deployment === prev)) return prev;
          try {
            window.localStorage?.removeItem(MODEL_STORAGE_KEY);
          } catch {
            /* ignore */
          }
          return '';
        });
      } catch {
        // Endpoint failed — leave dropdown empty so the UI falls back to
        // a static "(server default)" only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep latest voice list (Chrome populates asynchronously) and surface it
  // to the picker UI via state.
  useEffect(() => {
    if (!speechSupported) return;
    const sync = () => {
      const have = window.speechSynthesis.getVoices();
      voicesRef.current = have;
      setVoicesAvailable(have);
      const stillThere = (v: SpeechSynthesisVoice | null) =>
        !v || have.some((x) => x.voiceURI === v.voiceURI);
      if (
        !voicePairRef.current.host ||
        !voicePairRef.current.guest ||
        !stillThere(voicePairRef.current.host) ||
        !stillThere(voicePairRef.current.guest)
      ) {
        voicePairRef.current = selectVoicePair(have);
      }
    };
    sync();
    window.speechSynthesis.addEventListener?.('voiceschanged', sync);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', sync);
    };
  }, [speechSupported]);

  // Persist + ref-sync voice/pitch overrides whenever they change.
  useEffect(() => {
    hostVoiceURIRef.current = hostVoiceURI;
    try {
      if (hostVoiceURI) window.localStorage?.setItem(HOST_VOICE_STORAGE_KEY, hostVoiceURI);
      else window.localStorage?.removeItem(HOST_VOICE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [hostVoiceURI]);
  useEffect(() => {
    guestVoiceURIRef.current = guestVoiceURI;
    try {
      if (guestVoiceURI) window.localStorage?.setItem(GUEST_VOICE_STORAGE_KEY, guestVoiceURI);
      else window.localStorage?.removeItem(GUEST_VOICE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [guestVoiceURI]);
  useEffect(() => {
    hostPitchRef.current = hostPitch;
    try {
      window.localStorage?.setItem(HOST_PITCH_STORAGE_KEY, String(hostPitch));
    } catch {
      /* ignore */
    }
  }, [hostPitch]);
  useEffect(() => {
    guestPitchRef.current = guestPitch;
    try {
      window.localStorage?.setItem(GUEST_PITCH_STORAGE_KEY, String(guestPitch));
    } catch {
      /* ignore */
    }
  }, [guestPitch]);

  const speakNext = useCallback(() => {
    if (!speechSupported) return;
    if (speakingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setCurrentSegment(null);
      return;
    }
    speakingRef.current = true;
    setCurrentSegment(next);

    // Make sure we have a voice pair — voices may have just become available.
    if (!voicePairRef.current.host || !voicePairRef.current.guest) {
      const fresh = window.speechSynthesis.getVoices();
      if (fresh.length) {
        voicesRef.current = fresh;
        voicePairRef.current = selectVoicePair(fresh);
      }
    }

    const utter = new SpeechSynthesisUtterance(next.text);
    // Resolve the voice for this speaker. Order:
    //   1. User override (from the Voices picker)
    //   2. Auto-picked voice from selectVoicePair()
    //   3. Engine default (let the browser pick)
    const speakerOverrideURI =
      next.speaker === 'host' ? hostVoiceURIRef.current : guestVoiceURIRef.current;
    const overrideVoice =
      speakerOverrideURI && voicesRef.current.find((v) => v.voiceURI === speakerOverrideURI);
    const fallbackVoice =
      next.speaker === 'host' ? voicePairRef.current.host : voicePairRef.current.guest;
    const chosen = overrideVoice || fallbackVoice;
    if (chosen) utter.voice = chosen;
    // Strong pitch + rate distinction so even when the engine collapses to a
    // single voice (some Linux/iOS configs) the host and guest sound different.
    // The user-controlled speed multiplier scales the per-speaker base rate.
    const baseRate = next.speaker === 'host' ? 1.02 : 0.97;
    utter.rate = clampSpeed(baseRate * speedRef.current);
    utter.pitch = clampPitch(
      next.speaker === 'host' ? hostPitchRef.current : guestPitchRef.current,
      next.speaker === 'host' ? DEFAULT_HOST_PITCH : DEFAULT_GUEST_PITCH,
    );
    utter.volume = 1;
    utter.onend = () => {
      speakingRef.current = false;
      utteranceRef.current = null;
      setTimeout(() => speakNext(), 30);
    };
    utter.onerror = () => {
      speakingRef.current = false;
      utteranceRef.current = null;
      setTimeout(() => speakNext(), 30);
    };
    utteranceRef.current = utter;
    window.speechSynthesis.speak(utter);
  }, [speechSupported]);

  // Speak a short sample using the chosen voice + pitch so the listener can
  // compare options before committing. Cancels any in-flight playback so the
  // preview takes precedence; the show resumes from the queue afterwards.
  const previewVoice = useCallback(
    (speaker: Speaker) => {
      if (!speechSupported) return;
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
      speakingRef.current = false;
      utteranceRef.current = null;

      const sample =
        speaker === 'host'
          ? "Hi there, I'm your host. This is a quick voice preview."
          : "And I'm your guest. Here's how I sound on this one.";
      const utter = new SpeechSynthesisUtterance(sample);
      const overrideURI = speaker === 'host' ? hostVoiceURI : guestVoiceURI;
      const overrideVoice =
        overrideURI && voicesAvailable.find((v) => v.voiceURI === overrideURI);
      const fallbackVoice =
        speaker === 'host' ? voicePairRef.current.host : voicePairRef.current.guest;
      const chosen = overrideVoice || fallbackVoice;
      if (chosen) utter.voice = chosen;
      const baseRate = speaker === 'host' ? 1.02 : 0.97;
      utter.rate = clampSpeed(baseRate * speedRef.current);
      utter.pitch = clampPitch(
        speaker === 'host' ? hostPitch : guestPitch,
        speaker === 'host' ? DEFAULT_HOST_PITCH : DEFAULT_GUEST_PITCH,
      );
      utter.volume = 1;
      utter.onend = () => {
        // After the preview, resume the queue if there's anything pending.
        setTimeout(() => speakNext(), 60);
      };
      window.speechSynthesis.speak(utter);
    },
    [guestPitch, guestVoiceURI, hostPitch, hostVoiceURI, speakNext, speechSupported, voicesAvailable],
  );

  const resetVoiceOverrides = useCallback(() => {
    setHostVoiceURI(null);
    setGuestVoiceURI(null);
    setHostPitch(DEFAULT_HOST_PITCH);
    setGuestPitch(DEFAULT_GUEST_PITCH);
  }, []);

  const cancelSpeech = useCallback(() => {
    if (!speechSupported) return;
    speakingRef.current = false;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    utteranceRef.current = null;
  }, [speechSupported]);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        /* ignore */
      }
      eventSourceRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    closeStream();
    cancelSpeech();
    queueRef.current = [];
    lastSegmentIndexRef.current = -1;
    setCurrentSegment(null);
    setSessionId(null);
    setStreamFinished(false);
    setQuestionInput('');
    setTopic('');
    setTopicInput('');
    setMeta(null);
    setShowAbout(false);
    setError(null);
    setPhase('idle');
    // Note: we keep `styleInput` and `speed` between sessions so the listener
    // doesn't have to re-type their preferred vibe each time.
  }, [cancelSpeech, closeStream]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      closeStream();
      cancelSpeech();
    };
  }, [closeStream, cancelSpeech]);

  const openStream = useCallback(
    (id: string, sinceIndex = 0) => {
      closeStream();
      const sinceParam = sinceIndex > 0 ? `?since=${sinceIndex}` : '';
      const url = toApiUrl(`/api/cast/${encodeURIComponent(id)}/stream${sinceParam}`);
      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;

      es.addEventListener('hello', () => {
        // no-op — server confirmed the session, just keeps stream alive.
      });

      es.addEventListener('segment', (event) => {
        try {
          const segment = JSON.parse((event as MessageEvent).data) as CastSegment;
          if (typeof segment?.text !== 'string' || !segment.text.trim()) return;
          if (typeof segment.index === 'number' && segment.index > lastSegmentIndexRef.current) {
            lastSegmentIndexRef.current = segment.index;
          }
          queueRef.current.push(segment);
          if (!speakingRef.current) speakNext();
        } catch {
          /* ignore malformed payload */
        }
      });

      es.addEventListener('done', () => {
        setStreamFinished(true);
        closeStream();
      });

      es.addEventListener('error', () => {
        if (!queueRef.current.length && !speakingRef.current && !streamFinished) {
          setError('Lost connection. Tap Restart to try again.');
          setPhase('error');
        }
        closeStream();
      });
    },
    [closeStream, speakNext, streamFinished],
  );

  const startCast = useCallback(
    async (rawTopic: string, rawStyle: string, rawModel: string, rawSystemPrompt: string) => {
      const trimmed = rawTopic.trim();
      const trimmedStyle = rawStyle.trim();
      // Trim model/prompt overrides; empty string means "use server defaults".
      const trimmedModel = rawModel.trim();
      const trimmedSystemPrompt = rawSystemPrompt.trim();
      if (!trimmed) {
        setError('Type a topic first.');
        return;
      }
      setError(null);
      setPhase('starting');
      try {
        const res = await apiFetch('/api/cast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: trimmed,
            style: trimmedStyle || undefined,
            model: trimmedModel || undefined,
            systemPrompt: trimmedSystemPrompt || undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Server returned ${res.status}`);
        }
        const data = (await res.json()) as {
          id: string;
          topic: string;
          style?: string;
          createdAt?: string;
          provider?: string;
          modelDisplayName?: string;
          systemPrompt?: string;
          systemPromptIsOverride?: boolean;
          modelIsOverride?: boolean;
        };
        setSessionId(data.id);
        setTopic(data.topic);
        setStreamFinished(false);
        lastSegmentIndexRef.current = -1;
        setMeta({
          id: data.id,
          topic: data.topic,
          style: data.style ?? '',
          createdAt: data.createdAt ?? new Date().toISOString(),
          provider: data.provider ?? 'unknown',
          modelDisplayName: data.modelDisplayName ?? 'unknown',
          systemPrompt: data.systemPrompt ?? '',
          systemPromptIsOverride: Boolean(data.systemPromptIsOverride),
          modelIsOverride: Boolean(data.modelIsOverride),
        });
        // Persist last-used style + LLM overrides so the next session reuses
        // them. Empty overrides clear the stored value so the listener isn't
        // surprised by an old prompt re-appearing.
        try {
          window.localStorage?.setItem(STYLE_STORAGE_KEY, trimmedStyle);
          if (trimmedModel) window.localStorage?.setItem(MODEL_STORAGE_KEY, trimmedModel);
          else window.localStorage?.removeItem(MODEL_STORAGE_KEY);
          if (trimmedSystemPrompt) window.localStorage?.setItem(SYSTEM_PROMPT_STORAGE_KEY, trimmedSystemPrompt);
          else window.localStorage?.removeItem(SYSTEM_PROMPT_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        setPhase('playing');
        openStream(data.id, 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start podcast.';
        setError(message);
        setPhase('error');
      }
    },
    [openStream],
  );

  const handleStartSubmit = (e: FormEvent) => {
    e.preventDefault();
    void startCast(topicInput, styleInput, modelInput, systemPromptInput);
  };

  // Persist whether the configure panel is open, so the listener doesn't
  // have to re-expand it every visit.
  const toggleConfig = useCallback(() => {
    setShowConfig((prev) => {
      const next = !prev;
      try {
        window.localStorage?.setItem(CONFIG_OPEN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const cycleSpeed = useCallback((direction: 1 | -1) => {
    setSpeed((prev) => {
      const idx = SPEED_PRESETS.findIndex((v) => Math.abs(v - prev) < 0.001);
      const fallback = SPEED_PRESETS.findIndex((v) => v >= prev);
      const start = idx >= 0 ? idx : fallback >= 0 ? fallback : DEFAULT_SPEED_INDEX;
      const next = Math.max(0, Math.min(SPEED_PRESETS.length - 1, start + direction));
      return SPEED_PRESETS[next];
    });
  }, []);

  // While a stream is open and the user changes speed, gently restart the
  // currently-speaking segment so the new rate takes effect immediately.
  // (SpeechSynthesisUtterance.rate is read at speak() time, not while playing.)
  useEffect(() => {
    if (!speechSupported) return;
    if (phase !== 'playing') return;
    if (!speakingRef.current) return;
    const inFlight = currentSegment;
    if (!inFlight) return;
    // Cancel current utterance and re-queue this segment at the front; the
    // next speakNext tick will pick up the new rate.
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    speakingRef.current = false;
    queueRef.current.unshift(inFlight);
    setTimeout(() => speakNext(), 30);
    // We intentionally do not depend on currentSegment — only on speed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  const handleAskOpen = useCallback(() => {
    if (!sessionId) return;
    // Stop the show while the listener is asking — but DON'T close the stream
    // here. The server is still emitting outline beats; we just suppress
    // playback. When the question lands the server will swap to answer beats
    // and we'll resume audio with those.
    cancelSpeech();
    queueRef.current = [];
    setCurrentSegment(null);
    setQuestionInput('');
    // Default to voice mode when the browser supports it. The asking screen
    // still offers a "type instead" toggle for fallback.
    setAskMode(speechRecognitionSupportedRef.current ? 'voice' : 'text');
    setPhase('asking');
  }, [cancelSpeech, sessionId]);

  // Ref so the closure above can read the latest support flag without
  // depending on it (avoids a re-render churn).
  const speechRecognitionSupportedRef = useRef(false);
  // Ref to abort()-on-cancel without re-creating the cancel callback every
  // time the speech hook re-renders.
  const speechAbortRef = useRef<(() => void) | null>(null);

  const handleAskCancel = useCallback(() => {
    speechAbortRef.current?.();
    setQuestionInput('');
    setPhase('playing');
    // If the stream had already wrapped (event: done), reopen from where we
    // left off so further activity (or another question) keeps working.
    if (sessionId && !eventSourceRef.current) {
      setStreamFinished(false);
      openStream(sessionId, lastSegmentIndexRef.current + 1);
    }
  }, [openStream, sessionId]);

  // Submit a question to the API. Accepts an explicit string so the voice
  // flow can call it directly with the recognised transcript without going
  // through React state. Falls back to whatever's currently in `questionInput`.
  const submitQuestion = useCallback(
    async (rawQuestion: string) => {
      const q = rawQuestion.trim();
      if (!q || !sessionId) return;
      try {
        const res = await apiFetch(`/api/cast/${encodeURIComponent(sessionId)}/question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Server returned ${res.status}`);
        }
        // Drop any segments that streamed in while the listener was typing —
        // we want the next thing they hear to be the host addressing their
        // question, not stale outline content.
        queueRef.current = [];
        cancelSpeech();
        // Reopen from the next unheard segment (the answer beat the server
        // queues will start at lastIndex+1 onward). If the stream is still
        // open we leave it — the server will pick up the question on its
        // next iteration and emit the answer beats.
        if (!eventSourceRef.current) {
          setStreamFinished(false);
          openStream(sessionId, lastSegmentIndexRef.current + 1);
        }
        setQuestionInput('');
        setPhase('playing');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send your question.';
        setError(message);
        setPhase('error');
      }
    },
    [cancelSpeech, openStream, sessionId],
  );

  const handleAskSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      await submitQuestion(questionInput);
    },
    [questionInput, submitQuestion],
  );

  // Wire the SpeechRecognition hook. Auto-submit on natural end-of-speech so
  // a driver can ask without ever taking their hands off the wheel.
  const speech = useSpeechRecognition({
    continuous: false,
    onFinalResult: (transcript) => {
      const q = transcript.trim();
      if (!q) return;
      // Mirror into the input so cancel/keyboard fallback still work, then
      // auto-submit. The submit clears the input and switches phase.
      setQuestionInput(q);
      void submitQuestion(q);
    },
  });
  // Cache the support flag + abort fn into refs the open/cancel handlers can
  // see without taking a dependency on the hook (which re-renders often).
  useEffect(() => {
    speechRecognitionSupportedRef.current = speech.isSupported;
  }, [speech.isSupported]);
  useEffect(() => {
    speechAbortRef.current = speech.abort;
  }, [speech.abort]);

  // Auto-start mic when entering voice mode of the asking phase. Auto-stop
  // when leaving the asking phase so the mic doesn't keep listening.
  useEffect(() => {
    if (phase === 'asking' && askMode === 'voice' && speech.isSupported) {
      speech.start();
    }
    if (phase !== 'asking') {
      // Defensive: any prior listening session should be cancelled.
      if (speech.status === 'listening' || speech.status === 'starting') {
        speech.abort();
      }
    }
    // We intentionally do not depend on `speech` itself — that would loop
    // because the hook returns new function refs on every render. Watch only
    // the values that should re-trigger start/stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, askMode, speech.isSupported]);

  const switchToTextMode = useCallback(() => {
    speech.abort();
    setAskMode('text');
  }, [speech]);

  const restartListening = useCallback(() => {
    speech.reset();
    speech.start();
  }, [speech]);


  const speakerLabel = currentSegment
    ? currentSegment.speaker === 'host'
      ? `${HOST_NAME} · host`
      : `${GUEST_NAME} · guest`
    : streamFinished
      ? 'Episode wrapped'
      : phase === 'starting'
        ? 'Cueing the studio…'
        : phase === 'playing'
          ? 'Connecting…'
          : '';

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#050510] via-[#0d0d22] to-[#1a0d2e] text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(167, 139, 250, 0.35), transparent 45%), radial-gradient(circle at 80% 80%, rgba(56, 189, 248, 0.25), transparent 45%)',
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-between px-4 py-8 sm:px-6 sm:py-12">
        <header className="w-full text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-white/50 sm:text-xs">
            PodCraft
          </p>
          <p className="mt-1 text-xs text-white/40 sm:text-sm">
            In-car podcast · one topic · press Go
          </p>
        </header>

        {phase === 'idle' || phase === 'starting' || phase === 'error' ? (
          <section className="flex w-full flex-col items-center gap-5 sm:gap-6">
            <h1 className="text-center text-3xl font-bold leading-tight sm:text-5xl md:text-6xl">
              What should we talk about?
            </h1>
            <form onSubmit={handleStartSubmit} className="flex w-full flex-col items-center gap-3 sm:gap-4">
              <input
                autoFocus
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                placeholder="e.g. the Apollo program, why bees matter, modern jazz"
                className="w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center text-base font-medium text-white placeholder-white/40 outline-none ring-0 transition focus:border-white/40 focus:bg-white/15 sm:px-6 sm:py-5 sm:text-xl"
                maxLength={200}
                disabled={phase === 'starting'}
                aria-label="Podcast topic"
              />
              <input
                value={styleInput}
                onChange={(e) => setStyleInput(e.target.value)}
                placeholder="optional vibe — e.g. punchy, cozy, contrarian, comedic, story-driven"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-center text-sm font-medium text-white placeholder-white/30 outline-none transition focus:border-white/30 focus:bg-white/10 sm:px-6 sm:py-3 sm:text-base"
                maxLength={500}
                disabled={phase === 'starting'}
                aria-label="Conversation style"
              />

              {/* Configure model + system prompt — collapsed by default. */}
              <div className="w-full">
                <button
                  type="button"
                  onClick={toggleConfig}
                  className="mx-auto flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/10 hover:text-white/90"
                  aria-expanded={showConfig}
                  aria-controls="config-panel"
                >
                  <span aria-hidden>{showConfig ? '▾' : '▸'}</span>
                  {showConfig ? 'Hide model & prompt' : 'Configure model & prompt'}
                  {!showConfig && (modelInput || systemPromptInput) ? (
                    <span className="ml-1 rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                      custom
                    </span>
                  ) : null}
                </button>
                {showConfig ? (
                  <div
                    id="config-panel"
                    className="mt-3 flex w-full flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-left text-sm"
                  >
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
                        Model / deployment
                      </span>
                      {availableModels.length > 0 ? (
                        <select
                          value={modelInput}
                          onChange={(e) => setModelInput(e.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none transition focus:border-white/30 focus:bg-white/10"
                          disabled={phase === 'starting'}
                          aria-label="Model deployment override"
                        >
                          <option value="" className="bg-black text-white">
                            Server default
                            {defaultModelDeployment ? ` — ${defaultModelDeployment}` : ''}
                          </option>
                          {availableModels.map((m) => (
                            <option
                              key={m.deployment}
                              value={m.deployment}
                              className="bg-black text-white"
                            >
                              {m.deployment}
                              {m.model && m.model !== m.deployment ? ` (${m.model})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={modelInput}
                          onChange={(e) => setModelInput(e.target.value)}
                          placeholder="e.g. gpt-5, gpt-5-mini"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white placeholder-white/30 outline-none transition focus:border-white/30 focus:bg-white/10"
                          maxLength={120}
                          disabled={phase === 'starting'}
                          aria-label="Model deployment override"
                        />
                      )}
                      <span className="text-[11px] text-white/40">
                        {availableModels.length > 0 ? (
                          <>
                            {modelsSource === 'azure'
                              ? `${availableModels.length} live deployment${availableModels.length === 1 ? '' : 's'} from Azure AI Foundry.`
                              : `${availableModels.length} model${availableModels.length === 1 ? '' : 's'} (live listing unavailable — showing known defaults).`}{' '}
                            Pick &ldquo;Server default&rdquo; to let the host choose.
                          </>
                        ) : (
                          <>Leave blank to use the server&rsquo;s default deployment.</>
                        )}
                      </span>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
                        System prompt
                      </span>
                      <textarea
                        value={systemPromptInput}
                        onChange={(e) => setSystemPromptInput(e.target.value)}
                        placeholder="Override the host's persona instruction. Leave blank to use PodCraft's default."
                        rows={5}
                        className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm leading-relaxed text-white placeholder-white/30 outline-none transition focus:border-white/30 focus:bg-white/10"
                        maxLength={4000}
                        disabled={phase === 'starting'}
                        aria-label="System prompt override"
                      />
                      <span className="text-[11px] text-white/40">
                        {systemPromptInput.length}/4000 — leave blank for the default. Custom prompt
                        only affects the outline; the question-answer flow uses a structural prompt
                        that can&rsquo;t be overridden.
                      </span>
                    </label>
                    {(modelInput || systemPromptInput) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setModelInput('');
                          setSystemPromptInput('');
                        }}
                        className="self-start text-xs text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
                      >
                        Reset to defaults
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={phase === 'starting' || !topicInput.trim()}
                className="rounded-full bg-white px-10 py-4 text-xl font-bold text-black transition disabled:opacity-50 active:scale-95 hover:bg-white/90 sm:px-12 sm:py-5 sm:text-2xl"
              >
                {phase === 'starting' ? 'Starting…' : 'Go'}
              </button>
              {error ? (
                <p className="rounded-xl bg-red-500/20 px-4 py-2 text-sm text-red-200" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
            <div className="max-w-md text-center text-[11px] text-white/40">
              Real Azure OpenAI is wired up — the host outline is generated by the model when
              available, with a templated fallback if the call fails. The vibe field shapes
              tone; the configure panel above lets you pin a custom deployment or rewrite the
              host&rsquo;s system prompt before pressing Go.
            </div>
            {!speechSupported ? (
              <p className="max-w-md text-center text-xs text-amber-300/80">
                This browser doesn’t support speech synthesis — you’ll see the text but not hear it.
                Try Chrome, Safari, or Edge.
              </p>
            ) : null}
          </section>
        ) : null}

        {phase === 'playing' ? (
          <section className="flex w-full flex-1 flex-col items-center justify-center gap-8">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.3em] text-white/50">Now playing</p>
              <h2 className="mt-2 text-4xl font-bold sm:text-5xl">{topic}</h2>
              {meta?.style ? (
                <p className="mt-2 text-xs uppercase tracking-[0.3em] text-fuchsia-300/70">
                  vibe · {meta.style}
                </p>
              ) : null}
            </div>
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 px-6 py-8 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/50">
                {speakerLabel}
              </p>
              <p className="mt-3 text-2xl font-medium leading-snug text-white sm:text-3xl">
                {currentSegment?.text || (streamFinished ? 'Tap “New topic” to start another conversation.' : '…')}
              </p>
            </div>

            <div
              className="flex items-center gap-4 rounded-full border border-white/15 bg-white/5 px-3 py-2"
              role="group"
              aria-label="Playback speed"
            >
              <button
                type="button"
                onClick={() => cycleSpeed(-1)}
                disabled={Math.abs(speed - SPEED_PRESETS[0]) < 0.001}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl font-bold text-white transition disabled:opacity-30 active:scale-95 hover:bg-white/20"
                aria-label="Slower"
              >
                −
              </button>
              <div className="min-w-[5rem] text-center">
                <p className="text-[10px] uppercase tracking-[0.25em] text-white/40">speed</p>
                <p className="text-lg font-bold tabular-nums text-white">{speed.toFixed(2)}×</p>
              </div>
              <button
                type="button"
                onClick={() => cycleSpeed(1)}
                disabled={Math.abs(speed - SPEED_PRESETS[SPEED_PRESETS.length - 1]) < 0.001}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl font-bold text-white transition disabled:opacity-30 active:scale-95 hover:bg-white/20"
                aria-label="Faster"
              >
                +
              </button>
            </div>

            <button
              type="button"
              onClick={handleAskOpen}
              className="flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400 text-2xl font-extrabold uppercase tracking-widest text-white shadow-[0_20px_60px_-20px_rgba(244,114,182,0.7)] transition active:scale-95"
              aria-label="Interrupt the show and ask a question by voice"
            >
              Ask
            </button>

            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAbout((v) => !v)}
                className="text-xs uppercase tracking-[0.25em] text-white/40 underline-offset-4 hover:text-white/80 hover:underline"
                aria-expanded={showAbout}
              >
                {showAbout ? 'Hide about' : 'About this episode'}
              </button>
              {speechSupported ? (
                <button
                  type="button"
                  onClick={() => setShowVoices((v) => !v)}
                  className="text-xs uppercase tracking-[0.25em] text-white/40 underline-offset-4 hover:text-white/80 hover:underline"
                  aria-expanded={showVoices}
                >
                  {showVoices ? 'Hide voices' : 'Choose voices'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={reset}
                className="text-sm text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
              >
                New topic
              </button>
            </div>

            {showAbout && meta ? (
              <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-left text-sm text-white/70 backdrop-blur">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                  <dt className="text-white/40">Provider</dt>
                  <dd className="font-mono text-white/80">{meta.provider}</dd>
                  <dt className="text-white/40">Model</dt>
                  <dd className="font-mono text-white/80">
                    {meta.modelDisplayName}
                    {meta.modelIsOverride ? (
                      <span className="ml-2 rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                        custom
                      </span>
                    ) : null}
                  </dd>
                  <dt className="text-white/40">Topic</dt>
                  <dd className="text-white/80">{meta.topic}</dd>
                  <dt className="text-white/40">Vibe</dt>
                  <dd className="text-white/80">{meta.style || <span className="italic text-white/40">(none)</span>}</dd>
                </dl>
                <p className="mt-3 text-[11px] uppercase tracking-[0.25em] text-white/40">
                  System prompt {meta.systemPromptIsOverride ? '(your override)' : '(default)'}
                </p>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-[12px] leading-relaxed text-white/80">
                  {meta.systemPrompt}
                </pre>
                <p className="mt-2 text-[11px] text-white/50">
                  {meta.provider === 'azure-openai'
                    ? 'PodCraft is calling Azure OpenAI for outline + answer generation. If a call fails, the session falls back to a templated outline so the show keeps going.'
                    : 'PodCraft is currently using a templated mock (no LLM endpoint configured for this preview). The system prompt above is the instruction that would be sent to a model when one is wired up.'}
                </p>
              </div>
            ) : null}

            {showVoices && speechSupported ? (
              <VoicePicker
                voicesAvailable={voicesAvailable}
                hostVoiceURI={hostVoiceURI}
                guestVoiceURI={guestVoiceURI}
                hostPitch={hostPitch}
                guestPitch={guestPitch}
                activeHost={voicePairRef.current.host}
                activeGuest={voicePairRef.current.guest}
                onHostVoiceChange={setHostVoiceURI}
                onGuestVoiceChange={setGuestVoiceURI}
                onHostPitchChange={setHostPitch}
                onGuestPitchChange={setGuestPitch}
                onPreview={previewVoice}
                onReset={resetVoiceOverrides}
              />
            ) : null}
          </section>
        ) : null}

        {phase === 'asking' ? (
          <section className="flex w-full flex-1 flex-col items-center justify-center gap-8">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.3em] text-white/50">Your question</p>
              <h2 className="mt-2 text-3xl font-bold sm:text-4xl">{topic}</h2>
            </div>

            {askMode === 'voice' ? (
              // Voice-first hands-free flow. The mic auto-starts when the
              // asking phase opens and auto-submits on natural end-of-speech,
              // so a driver never has to look at the screen.
              <div className="flex w-full max-w-2xl flex-col items-center gap-6">
                <div
                  className={`relative flex h-44 w-44 items-center justify-center rounded-full border-4 transition ${
                    speech.status === 'listening'
                      ? 'border-fuchsia-300/80 bg-gradient-to-br from-fuchsia-500/30 to-orange-400/30'
                      : speech.status === 'starting'
                        ? 'border-white/30 bg-white/5'
                        : speech.status === 'error'
                          ? 'border-rose-400/70 bg-rose-500/10'
                          : 'border-white/20 bg-white/5'
                  }`}
                  aria-live="polite"
                  role="status"
                >
                  {speech.status === 'listening' ? (
                    <span className="pointer-events-none absolute inset-0 animate-ping rounded-full border-2 border-fuchsia-300/50" />
                  ) : null}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-20 w-20 text-white/90"
                  >
                    <path d="M12 1.5a3.5 3.5 0 0 0-3.5 3.5v6a3.5 3.5 0 1 0 7 0V5A3.5 3.5 0 0 0 12 1.5Z" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <path d="M12 18v3.5" />
                    <path d="M8.5 21.5h7" />
                  </svg>
                </div>

                <div className="min-h-[5rem] w-full max-w-2xl text-center">
                  <p className="text-sm uppercase tracking-[0.3em] text-white/40">
                    {speech.status === 'listening'
                      ? 'Listening…'
                      : speech.status === 'starting'
                        ? 'Starting microphone…'
                        : speech.status === 'stopped'
                          ? 'Sending…'
                          : speech.status === 'error'
                            ? 'Microphone error'
                            : 'Ready'}
                  </p>
                  <p className="mt-2 text-xl font-medium text-white/90 sm:text-2xl">
                    {speech.finalTranscript || speech.interimTranscript || (
                      <span className="italic text-white/40">
                        {speech.status === 'listening'
                          ? 'Say your question, I\u2019m listening.'
                          : 'Tap the mic to speak.'}
                      </span>
                    )}
                  </p>
                  {speech.error ? (
                    <p className="mt-3 text-sm text-rose-300">{speech.error}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={handleAskCancel}
                    className="rounded-full border border-white/30 px-6 py-4 text-base font-semibold text-white/80 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  {speech.status === 'listening' ? (
                    <button
                      type="button"
                      onClick={() => speech.stop()}
                      className="rounded-full bg-white px-10 py-4 text-base font-bold text-black transition active:scale-95"
                      aria-label="Stop and send your question"
                    >
                      Send
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={restartListening}
                      className="rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400 px-8 py-4 text-base font-bold text-white transition active:scale-95"
                    >
                      {speech.finalTranscript ? 'Re-record' : 'Start mic'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={switchToTextMode}
                    className="text-xs uppercase tracking-[0.25em] text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
                  >
                    Type instead
                  </button>
                </div>
                {!speech.isSupported ? (
                  <p className="text-xs text-amber-200/80">
                    Voice input isn\u2019t supported in this browser. Use Type instead.
                  </p>
                ) : null}
              </div>
            ) : (
              <form onSubmit={handleAskSubmit} className="flex w-full max-w-2xl flex-col items-center gap-4">
                <input
                  autoFocus
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  placeholder="Type your question"
                  className="w-full rounded-2xl border border-white/15 bg-white/10 px-6 py-5 text-center text-xl font-medium text-white placeholder-white/40 outline-none focus:border-white/40 focus:bg-white/15"
                  maxLength={500}
                  aria-label="Your question"
                />
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={handleAskCancel}
                    className="rounded-full border border-white/30 px-8 py-4 text-lg font-semibold text-white/80 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!questionInput.trim()}
                    className="rounded-full bg-white px-10 py-4 text-lg font-bold text-black transition disabled:opacity-50 active:scale-95"
                  >
                    Send
                  </button>
                  {speech.isSupported ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuestionInput('');
                        setAskMode('voice');
                      }}
                      className="text-xs uppercase tracking-[0.25em] text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
                    >
                      Use mic instead
                    </button>
                  ) : null}
                </div>
              </form>
            )}
          </section>
        ) : null}

        <footer className="mt-8 text-center text-[11px] text-white/30">
          Drive safely · keep eyes on the road · ask hands-free when possible
        </footer>
      </div>
    </main>
  );
}

interface VoicePickerProps {
  voicesAvailable: SpeechSynthesisVoice[];
  hostVoiceURI: string | null;
  guestVoiceURI: string | null;
  hostPitch: number;
  guestPitch: number;
  activeHost: SpeechSynthesisVoice | null;
  activeGuest: SpeechSynthesisVoice | null;
  onHostVoiceChange: (uri: string | null) => void;
  onGuestVoiceChange: (uri: string | null) => void;
  onHostPitchChange: (n: number) => void;
  onGuestPitchChange: (n: number) => void;
  onPreview: (speaker: Speaker) => void;
  onReset: () => void;
}

function VoicePicker(props: VoicePickerProps) {
  const ranked = useMemo(() => rankVoices(props.voicesAvailable), [props.voicesAvailable]);
  const hostActive =
    (props.hostVoiceURI && ranked.find((v) => v.voiceURI === props.hostVoiceURI)) || props.activeHost;
  const guestActive =
    (props.guestVoiceURI && ranked.find((v) => v.voiceURI === props.guestVoiceURI)) || props.activeGuest;

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-left text-sm text-white/70 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.25em] text-white/40">Choose voices</p>
        <button
          type="button"
          onClick={props.onReset}
          className="text-[11px] uppercase tracking-[0.2em] text-white/40 underline-offset-4 hover:text-white/80 hover:underline"
        >
          Reset to auto
        </button>
      </div>
      {ranked.length === 0 ? (
        <p className="mt-3 text-[12px] text-white/50">
          No browser voices available yet — give the page a moment, or refresh.
        </p>
      ) : null}

      <VoicePickerRow
        label="Host"
        roleHint={`Currently: ${hostActive ? `${hostActive.name} (${hostActive.lang})` : 'engine default'}`}
        voices={ranked}
        selectedURI={props.hostVoiceURI}
        pitch={props.hostPitch}
        defaultPitch={DEFAULT_HOST_PITCH}
        onVoiceChange={props.onHostVoiceChange}
        onPitchChange={props.onHostPitchChange}
        onPreview={() => props.onPreview('host')}
      />
      <VoicePickerRow
        label="Guest"
        roleHint={`Currently: ${guestActive ? `${guestActive.name} (${guestActive.lang})` : 'engine default'}`}
        voices={ranked}
        selectedURI={props.guestVoiceURI}
        pitch={props.guestPitch}
        defaultPitch={DEFAULT_GUEST_PITCH}
        onVoiceChange={props.onGuestVoiceChange}
        onPitchChange={props.onGuestPitchChange}
        onPreview={() => props.onPreview('guest')}
      />

      <p className="mt-3 text-[11px] text-white/40">
        Tip: <span className="text-white/60">&quot;Natural&quot;</span>, <span className="text-white/60">&quot;Online&quot;</span>, and <span className="text-white/60">Google</span>{' '}
        voices generally sound less robotic. Lowering the pitch can take some of the artificial edge off.
      </p>
    </div>
  );
}

interface VoicePickerRowProps {
  label: string;
  roleHint: string;
  voices: SpeechSynthesisVoice[];
  selectedURI: string | null;
  pitch: number;
  defaultPitch: number;
  onVoiceChange: (uri: string | null) => void;
  onPitchChange: (n: number) => void;
  onPreview: () => void;
}

function VoicePickerRow(props: VoicePickerRowProps) {
  return (
    <div className="mt-3 rounded-xl bg-white/5 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">{props.label}</p>
        <button
          type="button"
          onClick={props.onPreview}
          className="rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/80 hover:bg-white/20"
        >
          Preview
        </button>
      </div>
      <p className="mt-1 text-[11px] text-white/40">{props.roleHint}</p>

      <label className="mt-2 block text-[11px] uppercase tracking-[0.2em] text-white/40">
        Voice
      </label>
      <select
        value={props.selectedURI ?? ''}
        onChange={(e) => props.onVoiceChange(e.target.value ? e.target.value : null)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white/90 outline-none focus:border-fuchsia-300/50"
      >
        <option value="">— Auto-pick (recommended) —</option>
        {props.voices.map((v) => {
          const tag = /(neural|natural|online|premium|enhanced)/i.test(v.name)
            ? '★ '
            : '';
          return (
            <option key={v.voiceURI} value={v.voiceURI}>
              {tag}
              {v.name} ({v.lang})
              {v.localService === false ? ' · online' : ''}
            </option>
          );
        })}
      </select>

      <label className="mt-3 block text-[11px] uppercase tracking-[0.2em] text-white/40">
        Pitch · {props.pitch.toFixed(2)}
      </label>
      <div className="mt-1 flex items-center gap-3">
        <input
          type="range"
          min={PITCH_MIN}
          max={PITCH_MAX}
          step={0.02}
          value={props.pitch}
          onChange={(e) => props.onPitchChange(Number.parseFloat(e.target.value))}
          className="w-full accent-fuchsia-400"
          aria-label={`${props.label} pitch`}
        />
        <button
          type="button"
          onClick={() => props.onPitchChange(props.defaultPitch)}
          className="rounded-full border border-white/15 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white/60 hover:bg-white/10"
        >
          Default
        </button>
      </div>
    </div>
  );
}
