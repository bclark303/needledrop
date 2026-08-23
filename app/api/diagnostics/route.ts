import { NextResponse } from 'next/server';
import {
  clearDiagnosticsCapture,
  diagnosticsActive,
  getDiagnosticsStatus,
  recordDiagnostic,
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

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const canManage = canManageSettings(session.u);
  const url = new URL(request.url);

  if (url.searchParams.get('export') === '1') {
    if (!canManage) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    try {
      recordDiagnostic('diagnostics-export-started', {});
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
      recordDiagnostic('diagnostics-export-failed', { error: error instanceof Error ? error.message : String(error) }, 'error');
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
      if (recordDiagnostic(`client-${kind}`, { ...event, username: session.u })) captured += 1;
    }
    return NextResponse.json({ ok: true, captured, active: true });
  }

  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    if (action === 'start') {
      const status = startDiagnosticsCapture(body.clear !== false);
      try { await captureCurrentArtworkSnapshot('capture-start'); }
      catch (error) { recordDiagnostic('artwork-state-snapshot-failed', { reason: 'capture-start', error: error instanceof Error ? error.message : String(error) }, 'warn'); }
      return NextResponse.json({ ok: true, status: getDiagnosticsStatus(), overview: await getDiagnosticsOverview() });
    }

    if (action === 'stop') {
      if (diagnosticsActive()) {
        try { await captureCurrentArtworkSnapshot('capture-stop'); }
        catch (error) { recordDiagnostic('artwork-state-snapshot-failed', { reason: 'capture-stop', error: error instanceof Error ? error.message : String(error) }, 'warn'); }
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
      const result = await captureCurrentArtworkSnapshot(reason);
      return NextResponse.json({ ok: true, result, overview: await getDiagnosticsOverview() });
    }

    if (action === 'marker') {
      if (!diagnosticsActive()) return NextResponse.json({ error: 'Start a diagnostics capture first.' }, { status: 409 });
      const label = typeof body.label === 'string' ? body.label.slice(0, 200) : 'Manual marker';
      recordDiagnostic('manual-marker', { label, username: session.u });
      return NextResponse.json({ ok: true, overview: await getDiagnosticsOverview() });
    }

    return NextResponse.json({ error: 'Unknown diagnostics action' }, { status: 400 });
  } catch (error) {
    recordDiagnostic('diagnostics-action-failed', { action, error: error instanceof Error ? error.message : String(error) }, 'error');
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Diagnostics action failed' }, { status: 500 });
  }
}
