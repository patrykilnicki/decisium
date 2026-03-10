/**
 * Lightweight loading fallback for /ask: inline skeleton for main content area.
 * Layout (ProtectedRoute, AppLayout, AskSidebar) is provided by ask/layout.tsx.
 */
export default function AskLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="flex flex-col gap-2">
        <div className="h-4 w-96 max-w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted" />
      </div>
      <div className="h-12 w-full max-w-md animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
