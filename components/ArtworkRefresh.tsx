'use client';

import { useEffect, useRef } from 'react';
import type { EnrichmentStatus } from './types';

export default function ArtworkRefresh() {
  const previousState = useRef<EnrichmentStatus['state'] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch('/api/enrichment', { cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const payload = await response.json() as { status?: EnrichmentStatus };
        const state = payload.status?.state || 'idle';
        if (previousState.current === 'running' && state !== 'running') refreshArtworkImages();
        previousState.current = state;
      } catch {}
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    const listener = () => refreshArtworkImages();
    window.addEventListener('needledrop:artwork-updated', listener);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('needledrop:artwork-updated', listener);
    };
  }, []);

  return null;
}

function refreshArtworkImages() {
  const stamp = String(Date.now());
  const images = [...document.querySelectorAll<HTMLImageElement>('img[src*="/api/artwork/"]')];

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
      } catch {}
    }, index * 90);
  });
}
