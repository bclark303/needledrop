import { diagnosticsActive, recordDiagnostic, recordDiagnosticError, sanitizeUrlForDiagnostics } from './diagnostics';

type DiagnosticFetchContext = {
  provider: string;
  operation: string;
  data?: Record<string, unknown>;
};

function responseMetadata(response: Response) {
  const selectedHeaders: Record<string, string> = {};
  for (const name of [
    'content-type',
    'content-length',
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-discogs-ratelimit',
    'x-discogs-ratelimit-remaining',
    'x-discogs-ratelimit-used',
  ]) {
    const value = response.headers.get(name);
    if (value) selectedHeaders[name] = value;
  }
  return selectedHeaders;
}

export async function diagnosticFetch(
  input: string | URL,
  init: RequestInit | undefined,
  context: DiagnosticFetchContext,
) {
  const url = String(input);
  const started = Date.now();
  const method = String(init?.method || 'GET').toUpperCase();

  if (diagnosticsActive()) {
    recordDiagnostic('provider-request-start', {
      provider: context.provider,
      operation: context.operation,
      method,
      url: sanitizeUrlForDiagnostics(url),
      ...context.data,
    }, 'debug');
  }

  try {
    const response = await fetch(input, init);
    if (diagnosticsActive()) {
      recordDiagnostic('provider-request-complete', {
        provider: context.provider,
        operation: context.operation,
        method,
        url: sanitizeUrlForDiagnostics(url),
        status: response.status,
        ok: response.ok,
        redirected: response.redirected,
        durationMs: Date.now() - started,
        headers: responseMetadata(response),
        ...context.data,
      }, response.ok ? 'info' : 'warn');
    }
    return response;
  } catch (error) {
    recordDiagnosticError('provider-request-error', error, {
      provider: context.provider,
      operation: context.operation,
      method,
      url: sanitizeUrlForDiagnostics(url),
      durationMs: Date.now() - started,
      ...context.data,
    });
    throw error;
  }
}
