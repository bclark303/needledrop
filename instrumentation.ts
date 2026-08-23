import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const globalState = globalThis as typeof globalThis & { __needledropDiagnosticHooks?: boolean };
  if (globalState.__needledropDiagnosticHooks) return;
  globalState.__needledropDiagnosticHooks = true;

  const { recordDiagnostic, recordDiagnosticError } = await import('./lib/diagnostics');

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    recordDiagnosticError('server-uncaught-exception', error, { origin });
  });

  process.on('warning', (warning) => {
    recordDiagnostic('server-process-warning', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    }, 'warn');
  });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { recordDiagnosticError } = await import('./lib/diagnostics');
  recordDiagnosticError('next-request-error', error, {
    request: {
      path: request.path,
      method: request.method,
    },
    context: {
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
      revalidateReason: context.revalidateReason,
      renderType: context.renderType,
    },
  });
};
