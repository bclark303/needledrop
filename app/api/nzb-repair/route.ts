import { NextResponse } from 'next/server';
import {
  getPublicNzbRepairSettings,
  saveNzbRepairSettings,
  testNzbRepairConnections,
  type NzbRepairProvider,
} from '@/lib/nzb-repair';
import { getSession } from '@/lib/session';
import { canManageSettings } from '@/lib/settings';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  return NextResponse.json({
    settings: getPublicNzbRepairSettings(),
    canManage: canManageSettings(session.u),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action !== 'test') return NextResponse.json({ error: 'Unknown NZB repair action' }, { status: 400 });
    const result = await testNzbRepairConnections({
      provider: provider(body.provider),
      indexerUrl: stringValue(body.indexerUrl),
      indexerApiKey: stringValue(body.indexerApiKey),
      categories: stringValue(body.categories),
      sabUrl: stringValue(body.sabUrl),
      sabApiKey: stringValue(body.sabApiKey),
      sabCategory: stringValue(body.sabCategory),
      stagingPath: stringValue(body.stagingPath),
      importPath: stringValue(body.importPath),
    });
    const warnings: string[] = [];
    if (!result.sab.categoryExists) warnings.push(`SABnzbd category “${result.sab.category}” does not exist yet.`);
    if (!result.paths.stagingReadable) warnings.push(`NeedleDrop cannot read ${result.paths.staging}.`);
    if (!result.paths.importWritable) warnings.push(`NeedleDrop cannot write ${result.paths.importPath}.`);
    return NextResponse.json({
      ok: warnings.length === 0,
      result,
      message: warnings.length ? warnings.join(' ') : `Connected to ${result.indexer.name} and SABnzbd. Repair mounts are ready.`,
      warnings,
    }, { status: warnings.length ? 409 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'NZB repair connection test failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (!canManageSettings(session.u)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    saveNzbRepairSettings({
      provider: provider(body.provider),
      indexerUrl: stringValue(body.indexerUrl),
      indexerApiKey: stringValue(body.indexerApiKey),
      clearIndexerApiKey: body.clearIndexerApiKey === true,
      categories: stringValue(body.categories),
      sabUrl: stringValue(body.sabUrl),
      sabApiKey: stringValue(body.sabApiKey),
      clearSabApiKey: body.clearSabApiKey === true,
      sabCategory: stringValue(body.sabCategory),
      stagingPath: stringValue(body.stagingPath),
      importPath: stringValue(body.importPath),
      cleanupStaging: typeof body.cleanupStaging === 'boolean' ? body.cleanupStaging : undefined,
      preferLossless: typeof body.preferLossless === 'boolean' ? body.preferLossless : undefined,
    });
    return NextResponse.json({ settings: getPublicNzbRepairSettings(), canManage: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save NZB repair settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function provider(value: unknown): NzbRepairProvider | undefined {
  return value === 'prowlarr' || value === 'nzbhydra2' || value === 'newznab' ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}
