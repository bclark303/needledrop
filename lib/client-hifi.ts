import type { HiFiSettings } from '@/components/types';

export const DEFAULT_HIFI_SETTINGS: HiFiSettings = {
  volume: 0.8,
  balance: 0,
  bass: 0,
  mid: 0,
  treble: 0,
};

const STORAGE_KEY = 'needledrop.hifi.v1';
let context: AudioContext | null = null;
let source: MediaElementAudioSourceNode | null = null;
let sourceElement: HTMLAudioElement | null = null;
let bassFilter: BiquadFilterNode | null = null;
let midFilter: BiquadFilterNode | null = null;
let trebleFilter: BiquadFilterNode | null = null;
let panner: StereoPannerNode | null = null;
let graphPromise: Promise<void> | null = null;

export function readHiFiSettings(): HiFiSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_HIFI_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HIFI_SETTINGS };
    const value = JSON.parse(raw) as Partial<HiFiSettings>;
    return normalizeHiFiSettings(value);
  } catch {
    return { ...DEFAULT_HIFI_SETTINGS };
  }
}

export function applyHiFiSettings(settings: HiFiSettings, activateTone = false) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeHiFiSettings(settings);
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch {}

  const audio = document.querySelector<HTMLAudioElement>('audio');
  if (!audio) return;
  audio.volume = normalized.volume;

  // Keep normal HTMLAudio playback untouched until a user actually moves a tone/balance control.
  // Once the graph exists, subsequent updates (including Reset) update it immediately.
  if (!source && !activateTone) return;

  void ensureGraph(audio).then(() => {
    if (!bassFilter || !midFilter || !trebleFilter || !panner) return;
    bassFilter.gain.value = normalized.bass;
    midFilter.gain.value = normalized.mid;
    trebleFilter.gain.value = normalized.treble;
    panner.pan.value = normalized.balance;
  }).catch(() => {});
}

export function normalizeHiFiSettings(value: Partial<HiFiSettings>): HiFiSettings {
  return {
    volume: clamp(Number(value.volume ?? DEFAULT_HIFI_SETTINGS.volume), 0, 1),
    balance: clamp(Number(value.balance ?? 0), -1, 1),
    bass: clamp(Number(value.bass ?? 0), -12, 12),
    mid: clamp(Number(value.mid ?? 0), -12, 12),
    treble: clamp(Number(value.treble ?? 0), -12, 12),
  };
}

async function ensureGraph(audio: HTMLAudioElement) {
  if (source && sourceElement === audio && context) {
    if (context.state === 'suspended') await context.resume();
    return;
  }
  if (source && sourceElement !== audio) return;

  if (!graphPromise) {
    graphPromise = createGraph(audio).finally(() => {
      graphPromise = null;
    });
  }
  await graphPromise;
}

async function createGraph(audio: HTMLAudioElement) {
  if (source) return;
  const WindowAudioContext = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!WindowAudioContext) return;

  const nextContext = new WindowAudioContext();
  const nextSource = nextContext.createMediaElementSource(audio);
  const nextBass = nextContext.createBiquadFilter();
  const nextMid = nextContext.createBiquadFilter();
  const nextTreble = nextContext.createBiquadFilter();
  const nextPanner = nextContext.createStereoPanner();

  nextBass.type = 'lowshelf';
  nextBass.frequency.value = 120;
  nextMid.type = 'peaking';
  nextMid.frequency.value = 1000;
  nextMid.Q.value = 0.85;
  nextTreble.type = 'highshelf';
  nextTreble.frequency.value = 8500;

  nextSource.connect(nextBass);
  nextBass.connect(nextMid);
  nextMid.connect(nextTreble);
  nextTreble.connect(nextPanner);
  nextPanner.connect(nextContext.destination);

  context = nextContext;
  source = nextSource;
  sourceElement = audio;
  bassFilter = nextBass;
  midFilter = nextMid;
  trebleFilter = nextTreble;
  panner = nextPanner;

  if (nextContext.state === 'suspended') await nextContext.resume();
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
