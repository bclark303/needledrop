import { performance as nodePerformance } from 'node:perf_hooks';
import { NextResponse } from 'next/server';
import {
  clearDiagnosticsCapture,
  diagnosticsActive,
  getDiagnosticsStatus,
  recordDiagnostic,
  recordDiagnosticError,
  startDiagnosticsCapture,
  stopDiagnosticsCapture,
} from '@/lib/diagnostics';
import {
  buildDiagnosticsExport,
  captureCurrentArtworkSnapshot,
  getDiagnosticsOverview,
} from '@/lib/diagnostics-report';
import { getSession } from '@/lib/session';
import { canManageSettings } from '@/lib/settings';

export const runtime = 'nodejs';

let lastServerHeartbeatAt = 0;

function serverHealth(reason: string) {
  return {
    reason,
    uptimeSeconds: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    resourceUsage: process.resourceUsage(),
    eventLoopUtilization: nodePerformance.eventLoopUtilization(),
  };
}

function maybeRecordServerHeartbeat(reason: string, force = false) {
  const now = Date.now();
  if (!force && now - lastServerHeartbeatAt < 10000) return;
  lastServerHeartbeatAt = now;
  recordDiagnostic('server-health-snapshot', serverHealth(reason), 'debug');
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const canManage = canManageSettings(session.u);
  const url = new URL(request.url);

  if (url.searchParams.get('status') === '1') {
    return NextResponse.json({ status: getDiagnosticsStatus(), canManage });
  }

  if (url.searchParams.get('export') === '1') {
    if (!canManage) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    try {
      recordDiagnostic('diagnostics-export-started', {});
      maybeRecordServerHeartbeat('export-start', true);
      const report = await buildDiagnosticsExport();
      recordDiagnostic('diagnostics-export-complete', { albumCount: report.albumCount, errors: report.errors.length });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      return new Response(JSON.stringify(report, null, 2), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="needledrop-diagnostics-${stamp}.json"`,
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      recordDiagnosticError('diagnostics-export-failed', error);
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not export diagnostics' }, { status: 500 });
    }
  }

  try {
    const overview = await getDiagnosticsOverview();
    return NextResponse.json({ ...overview, canManage });
  } catch (error) {
    return NextResponse.json({
      status: getDiagnosticsStatus(),
      canManage,
      error: error instanceof Error ? error.message : 'Could not load diagnostics',
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'client-events') {
    if (!diagnosticsActive()) return NextResponse.json({ ok: true, captured: 0, active: false });
    const events = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
    let captured = 0;
    for (const raw of events) {
      if (!raw || typeof raw !== 'object') continue;
      const event = raw as Record<string, unknown>;
      const kind = typeof event.kind === 'string' ? event.kind.replace(/[^a-z0-9-]/gi, '-').slice(0, 60) : 'event';
      if (recordDiagnostic(`client-${kind}`, event)) captured += 1;
    }
    maybeRecordServerHeartbeat('client-event-batch');
    return NextResponse.json({ ok: true, captured, active: true });
  }

  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    if (action === 'start') {
      const status = startDiagnosticsCapture(body.clear !== false);
      maybeRecordServerHeartbeat('capture-start', true);
      try { await captureCurrentArtworkSnapshot('capture-start'); }
      catch (error) { recordDiagnosticError('artwork-state-snapshot-failed', error, { reason: 'capture-start' }, 'warn'); }
      return NextResponse.json({ ok: true, status, overview: await getDiagnosticsOverview() });
    }

    if (action === 'stop') {
      if (diagnosticsActive()) {
        maybeRecordServerHeartbeat('capture-stop', true);
        try { await captureCurrentArtworkSnapshot('capture-stop'); }
        catch (error) { recordDiagnosticError('artwork-state-snapshot-failed', error, { reason: 'capture-stop' }, 'warn'); }
      }
      const status = stopDiagnosticsCapture();
      return NextResponse.json({ ok: true, status, overview: await getDiagnosticsOverview() });
    }

    if (action === 'clear') {
      const status = clearDiagnosticsCapture();
      return NextResponse.json({ ok: true, status, overview: await getDiagnosticsOverview() });
    }

    if (action === 'snapshot') {
      if (!diagnosticsActive()) return NextResponse.json({ error: 'Start a diagnostics capture first.' }, { status: 409 });
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 120) : 'manual';
      maybeRecordServerHeartbeat(`snapshot:${reason}`, true);
      const result = await captureCurrentArtworkSnapshot(reason);
      return NextResponse.json({ ok: true, result, overview: await getDiagnosticsOverview() });
    }

    if (action === 'marker') {
      if (!diagnosticsActive()) return NextResponse.json({ error: 'Start a diagnostics capture first.' }, { status: 409 });
      const label = typeof body.label === 'string' ? body.label.slice(0, 200) : 'Manual marker';
      recordDiagnostic('manual-marker', { label });
      maybeRecordServerHeartbeat(`marker:${label}`, true);
      try { await captureCurrentArtworkSnapshot(`marker:${label}`); }
      catch (error) { recordDiagnosticError('artwork-state-snapshot-failed', error, { reason: `marker:${label}` }, 'warn'); }
      return NextResponse.json({ ok: true, overview: await getDiagnosticsOverview() });
    }

    return NextResponse.json({ error: 'Unknown diagnostics action' }, { status: 400 });
  } catch (error) {
    recordDiagnosticError('diagnostics-action-failed', error, { action });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Diagnostics action failed' }, { status: 500 });
  }
}
