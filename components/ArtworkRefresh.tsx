'use client';

import { useEffect, useRef } from 'react';
import type { EnrichmentStatus } from './types';

type ClientDiagnosticEvent = Record<string, unknown> & { kind: string };

export default function ArtworkRefresh() {
  const previousState = useRef<EnrichmentStatus['state'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let captureActive = false;
    let queue: ClientDiagnosticEvent[] = [];
    let flushTimer: number | undefined;

    function queueEvent(event: ClientDiagnosticEvent) {
      if (!captureActive || cancelled) return;
      queue.push({ ...event, clientAt: new Date().toISOString() });
      if (queue.length >= 30) void flush();
      else if (!flushTimer) flushTimer = window.setTimeout(() => void flush(), 700);
    }

    async function flush() {
      if (flushTimer) window.clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!captureActive || cancelled || !queue.length) return;
      const events = queue.splice(0, 100);
      await fetch('/api/diagnostics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'client-events', events }),
        keepalive: true,
      }).catch(() => null);
    }

    async function refreshCaptureStatus() {
      const response = await fetch('/api/diagnostics', { cache: 'no-store' }).catch(() => null);
      if (!response?.ok || cancelled) return;
      const payload = await response.json().catch(() => ({})) as { status?: { active?: boolean } };
      const wasActive = captureActive;
      captureActive = payload.status?.active === true;
      if (captureActive && !wasActive) {
        const navigationEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        const navigation = navigationEntries[0];
        queueEvent({
          kind: 'page-mount',
          pathname: window.location.pathname,
          navigationType: navigation?.type || 'unknown',
          visibilityState: document.visibilityState,
          online: navigator.onLine,
          viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        });
      }
      if (!captureActive) queue = [];
    }

    async function pollEnrichment() {
      try {
        const response = await fetch('/api/enrichment', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const payload = await response.json() as { status?: EnrichmentStatus };
        const state = payload.status?.state || 'idle';
        if (state !== previousState.current) {
          queueEvent({ kind: 'enrichment-state', previous: previousState.current, state, status: payload.status });
        }
        if (previousState.current === 'running' && state !== 'running') {
          refreshArtworkImages('enrichment-complete', queueEvent);
        }
        previousState.current = state;
      } catch {}
    }

    function imageTelemetry(event: Event) {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      const src = image.currentSrc || image.src;
      if (!src.includes('/api/artwork/') && !src.includes('/api/metadata/')) return;
      const entries = performance.getEntriesByName(src) as PerformanceResourceTiming[];
      const timing = entries.length ? entries[entries.length - 1] : undefined;
      queueEvent({
        kind: event.type === 'error' ? 'image-error' : 'image-load',
        src,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        complete: image.complete,
        timing: timing ? {
          durationMs: Math.round(timing.duration * 100) / 100,
          transferSize: timing.transferSize,
          encodedBodySize: timing.encodedBodySize,
          decodedBodySize: timing.decodedBodySize,
          responseStartMs: Math.round(timing.responseStart * 100) / 100,
        } : undefined,
      });
    }

    function artworkUpdated() {
      refreshArtworkImages('needledrop-artwork-updated', queueEvent);
    }

    function diagnosticsChanged() {
      void refreshCaptureStatus();
    }

    void refreshCaptureStatus();
    void pollEnrichment();
    const enrichmentTimer = window.setInterval(() => void pollEnrichment(), 2500);
    const diagnosticsTimer = window.setInterval(() => void refreshCaptureStatus(), 5000);
    window.addEventListener('needledrop:artwork-updated', artworkUpdated);
    window.addEventListener('needledrop:diagnostics-changed', diagnosticsChanged);
    document.addEventListener('load', imageTelemetry, true);
    document.addEventListener('error', imageTelemetry, true);

    return () => {
      if (captureActive && queue.length) void flush();
      cancelled = true;
      if (flushTimer) window.clearTimeout(flushTimer);
      window.clearInterval(enrichmentTimer);
      window.clearInterval(diagnosticsTimer);
      window.removeEventListener('needledrop:artwork-updated', artworkUpdated);
      window.removeEventListener('needledrop:diagnostics-changed', diagnosticsChanged);
      document.removeEventListener('load', imageTelemetry, true);
      document.removeEventListener('error', imageTelemetry, true);
    };
  }, []);

  return null;
}

function refreshArtworkImages(reason: string, emit?: (event: ClientDiagnosticEvent) => void) {
  const stamp = String(Date.now());
  const images = [...document.querySelectorAll<HTMLImageElement>('img[src*="/api/artwork/"]')];
  emit?.({ kind: 'artwork-refresh-trigger', reason, count: images.length, stamp });

  // Do not turn a completed enrichment pass into a burst of dozens of simultaneous
  // Discogs/CAA requests. The server also limits upstream concurrency, but staggering
  // here keeps browser and proxy pressure low and lets the collection refill smoothly.
  images.forEach((image, index) => {
    window.setTimeout(() => {
      if (!image.isConnected) return;
      try {
        const url = new URL(image.currentSrc || image.src, window.location.href);
        url.searchParams.set('_ndv', stamp);
        image.src = url.toString();
        emit?.({ kind: 'artwork-refresh-image', reason, index, src: url.toString() });
      } catch {}
    }, index * 90);
  });
}
