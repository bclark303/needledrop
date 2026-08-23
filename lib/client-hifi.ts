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

  const hasToneChange = normalized.balance !== 0 || normalized.bass !== 0 || normalized.mid !== 0 || normalized.treble !== 0;
  if (!source && !activateTone && !hasToneChange) return;

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

  const WindowAudioContext = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!WindowAudioContext) return;

  context = new WindowAudioContext();
  source = context.createMediaElementSource(audio);
  sourceElement = audio;

  bassFilter = context.createBiquadFilter();
  bassFilter.type = 'lowshelf';
  bassFilter.frequency.value = 120;

  midFilter = context.createBiquadFilter();
  midFilter.type = 'peaking';
  midFilter.frequency.value = 1000;
  midFilter.Q.value = 0.85;

  trebleFilter = context.createBiquadFilter();
  trebleFilter.type = 'highshelf';
  trebleFilter.frequency.value = 8500;

  panner = context.createStereoPanner();

  source.connect(bassFilter);
  bassFilter.connect(midFilter);
  midFilter.connect(trebleFilter);
  trebleFilter.connect(panner);
  panner.connect(context.destination);

  if (context.state === 'suspended') await context.resume();
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
