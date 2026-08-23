import type { Instrumentation } from 'next';

export async function register() {
  // Request-level failures are captured below. Avoid process-wide listeners here
  // because Next.js also bundles instrumentation for Edge-compatible runtimes.
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
    },
  });
};
