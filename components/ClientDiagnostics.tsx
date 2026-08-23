'use client';

import { useEffect } from 'react';

type ClientDiagnosticEvent = Record<string, unknown> & { kind: string };

type NavigatorWithDiagnostics = Navigator & {
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
};

type PerformanceWithMemory = Performance & {
  memory?: {
    jsHeapSizeLimit?: number;
    totalJSHeapSize?: number;
    usedJSHeapSize?: number;
  };
};

export default function ClientDiagnostics() {
  useEffect(() => {
    let cancelled = false;
    let captureActive = false;
    let queue: ClientDiagnosticEvent[] = [];
    let flushTimer: number | undefined;
    let lastRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const nativeFetch = window.fetch.bind(window);

    function queueEvent(event: ClientDiagnosticEvent) {
      if (!captureActive || cancelled) return;
      queue.push({ ...event, clientAt: new Date().toISOString() });
      if (queue.length >= 40) void flush();
      else if (!flushTimer) flushTimer = window.setTimeout(() => void flush(), 750);
    }

    async function flush() {
      if (flushTimer) window.clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!captureActive || cancelled || !queue.length) return;
      const events = queue.splice(0, 100);
      await nativeFetch('/api/diagnostics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'client-events', events }),
        keepalive: true,
      }).catch(() => null);
    }

    function describeRequest(input: RequestInfo | URL, init?: RequestInit) {
      try {
        const request = input instanceof Request ? input : undefined;
        const raw = request?.url || (input instanceof URL ? input.toString() : String(input));
        const url = new URL(raw, window.location.href);
        return {
          url,
          method: String(init?.method || request?.method || 'GET').toUpperCase(),
          internalApi: url.origin === window.location.origin && url.pathname.startsWith('/api/') && url.pathname !== '/api/diagnostics',
        };
      } catch {
        return { url: null, method: String(init?.method || 'GET').toUpperCase(), internalApi: false };
      }
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const descriptor = describeRequest(input, init);
      const started = performance.now();
      try {
        const response = await nativeFetch(input, init);
        if (captureActive && descriptor.internalApi && descriptor.url) {
          queueEvent({
            kind: 'api-request',
            method: descriptor.method,
            pathname: descriptor.url.pathname,
            queryKeys: [...descriptor.url.searchParams.keys()].filter((key, index, values) => values.indexOf(key) === index).sort(),
            status: response.status,
            ok: response.ok,
            redirected: response.redirected,
            durationMs: rounded(performance.now() - started),
            response: {
              contentType: response.headers.get('content-type'),
              contentLength: response.headers.get('content-length'),
              cacheControl: response.headers.get('cache-control'),
            },
          });
        }
        return response;
      } catch (error) {
        if (captureActive && descriptor.internalApi && descriptor.url) {
          queueEvent({
            kind: 'api-error',
            method: descriptor.method,
            pathname: descriptor.url.pathname,
            queryKeys: [...descriptor.url.searchParams.keys()].sort(),
            status: 0,
            durationMs: rounded(performance.now() - started),
            error: serializeClientError(error),
          });
        }
        throw error;
      }
    };

    async function captureClientSnapshot(reason: string) {
      if (!captureActive || cancelled) return;
      const nav = navigator as NavigatorWithDiagnostics;
      const perf = performance as PerformanceWithMemory;
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const registration = 'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
        : undefined;
      const storage = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => undefined) : undefined;

      queueEvent({
        kind: 'client-snapshot',
        reason,
        page: {
          href: window.location.href,
          title: document.title,
          readyState: document.readyState,
          visibilityState: document.visibilityState,
          online: navigator.onLine,
          viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
          screen: { width: window.screen.width, height: window.screen.height, colorDepth: window.screen.colorDepth },
        },
        browser: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          languages: navigator.languages,
          platform: navigator.platform,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemoryGb: nav.deviceMemory,
          cookiesEnabled: navigator.cookieEnabled,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          connection: nav.connection,
        },
        performance: {
          nowMs: rounded(performance.now()),
          timeOrigin: performance.timeOrigin,
          memory: perf.memory,
          resourceEntries: performance.getEntriesByType('resource').length,
          navigation: navigation ? {
            type: navigation.type,
            durationMs: rounded(navigation.duration),
            domInteractiveMs: rounded(navigation.domInteractive),
            domContentLoadedMs: rounded(navigation.domContentLoadedEventEnd),
            loadEventMs: rounded(navigation.loadEventEnd),
            responseStartMs: rounded(navigation.responseStart),
            transferSize: navigation.transferSize,
            encodedBodySize: navigation.encodedBodySize,
            decodedBodySize: navigation.decodedBodySize,
          } : undefined,
        },
        storage: storage ? { quota: storage.quota, usage: storage.usage } : undefined,
        serviceWorker: registration ? {
          scope: registration.scope,
          activeState: registration.active?.state,
          waitingState: registration.waiting?.state,
          installingState: registration.installing?.state,
          controlled: Boolean(navigator.serviceWorker.controller),
        } : { supported: 'serviceWorker' in navigator, registered: false },
      });
    }

    async function refreshCaptureStatus() {
      const response = await nativeFetch('/api/diagnostics?status=1', { cache: 'no-store' }).catch(() => null);
      if (!response?.ok || cancelled) return;
      const payload = await response.json().catch(() => ({})) as { status?: { active?: boolean } };
      const wasActive = captureActive;
      captureActive = payload.status?.active === true;
      if (captureActive && !wasActive) {
        lastRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        await captureClientSnapshot('capture-start');
      }
      if (!captureActive) queue = [];
    }

    function onWindowError(event: ErrorEvent) {
      queueEvent({
        kind: 'browser-error',
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        error: serializeClientError(event.error),
      });
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      queueEvent({ kind: 'unhandled-rejection', error: serializeClientError(event.reason) });
    }

    function onResourceError(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target instanceof HTMLImageElement) return;
      const source = target instanceof HTMLScriptElement
        ? target.src
        : target instanceof HTMLLinkElement
          ? target.href
          : undefined;
      if (!source) return;
      queueEvent({ kind: 'resource-error', tag: target.tagName, source });
    }

    function onNetworkState(event: Event) {
      queueEvent({ kind: 'network-state', event: event.type, online: navigator.onLine });
    }

    function onVisibility() {
      queueEvent({ kind: 'visibility', state: document.visibilityState });
    }

    function onPageLifecycle(event: PageTransitionEvent) {
      queueEvent({ kind: 'page-lifecycle', event: event.type, persisted: event.persisted });
      if (event.type === 'pagehide' && queue.length) void flush();
    }

    function onMediaEvent(event: Event) {
      const media = event.target;
      if (!(media instanceof HTMLMediaElement)) return;
      queueEvent({
        kind: 'media-event',
        event: event.type,
        tag: media.tagName,
        src: media.currentSrc || media.src,
        currentTime: finite(media.currentTime),
        duration: finite(media.duration),
        paused: media.paused,
        ended: media.ended,
        muted: media.muted,
        volume: media.volume,
        playbackRate: media.playbackRate,
        readyState: media.readyState,
        networkState: media.networkState,
        errorCode: media.error?.code,
        errorMessage: media.error?.message,
      });
    }

    let longTaskObserver: PerformanceObserver | undefined;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          queueEvent({
            kind: 'long-task',
            name: entry.name,
            entryType: entry.entryType,
            startTimeMs: rounded(entry.startTime),
            durationMs: rounded(entry.duration),
          });
        }
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {}

    const mediaEventNames = [
      'loadstart', 'loadedmetadata', 'canplay', 'play', 'playing', 'pause', 'waiting', 'stalled',
      'seeking', 'seeked', 'ended', 'error', 'abort', 'emptied', 'ratechange', 'volumechange',
    ];

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('online', onNetworkState);
    window.addEventListener('offline', onNetworkState);
    window.addEventListener('pageshow', onPageLifecycle);
    window.addEventListener('pagehide', onPageLifecycle);
    document.addEventListener('error', onResourceError, true);
    document.addEventListener('visibilitychange', onVisibility);
    for (const name of mediaEventNames) document.addEventListener(name, onMediaEvent, true);

    void refreshCaptureStatus();
    const statusTimer = window.setInterval(() => void refreshCaptureStatus(), 5000);
    const heartbeatTimer = window.setInterval(() => {
      if (!captureActive) return;
      const route = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (route !== lastRoute) {
        queueEvent({ kind: 'route-change', from: lastRoute, to: route });
        lastRoute = route;
      }
      const memory = (performance as PerformanceWithMemory).memory;
      queueEvent({
        kind: 'client-heartbeat',
        route,
        online: navigator.onLine,
        visibilityState: document.visibilityState,
        readyState: document.readyState,
        audioElements: document.querySelectorAll('audio').length,
        videoElements: document.querySelectorAll('video').length,
        resourceEntries: performance.getEntriesByType('resource').length,
        memory,
      });
    }, 15000);
    const snapshotTimer = window.setInterval(() => void captureClientSnapshot('periodic'), 60000);

    function diagnosticsChanged() {
      void refreshCaptureStatus();
    }
    window.addEventListener('needledrop:diagnostics-changed', diagnosticsChanged);

    return () => {
      if (captureActive && queue.length) void flush();
      cancelled = true;
      window.fetch = nativeFetch;
      if (flushTimer) window.clearTimeout(flushTimer);
      window.clearInterval(statusTimer);
      window.clearInterval(heartbeatTimer);
      window.clearInterval(snapshotTimer);
      longTaskObserver?.disconnect();
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('online', onNetworkState);
      window.removeEventListener('offline', onNetworkState);
      window.removeEventListener('pageshow', onPageLifecycle);
      window.removeEventListener('pagehide', onPageLifecycle);
      window.removeEventListener('needledrop:diagnostics-changed', diagnosticsChanged);
      document.removeEventListener('error', onResourceError, true);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const name of mediaEventNames) document.removeEventListener(name, onMediaEvent, true);
    };
  }, []);

  return null;
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function finite(value: number) {
  return Number.isFinite(value) ? rounded(value) : undefined;
}

function serializeClientError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  if (error && typeof error === 'object') {
    try { return JSON.parse(JSON.stringify(error)); } catch { return String(error); }
  }
  return String(error);
}
