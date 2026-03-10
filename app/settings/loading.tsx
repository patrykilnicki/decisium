/**
 * Lightweight loading fallback for /settings: inline skeleton only.
 * No client components; avoids extra JS during loading state.
 */
export default function SettingsLoading() {
  return (
    <div className="p-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-24 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-56 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
          <div className="h-10 w-28 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    </div>
  );
}
