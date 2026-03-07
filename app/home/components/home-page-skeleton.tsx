export function HomePageSkeleton() {
  return (
    <div
      className="relative flex min-h-screen flex-col items-center bg-background p-4"
      style={{
        backgroundImage: "url(/bg.svg)",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "top left",
        backgroundSize: "auto 50vh",
      }}
    >
      <div className="flex w-full max-w-5xl flex-1 flex-col items-stretch gap-14 px-4 py-8 md:px-8 md:py-10 lg:px-32">
        {/* Header skeleton */}
        <header className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
          <div className="flex items-center gap-2">
            <div className="h-5 w-24 animate-pulse rounded bg-muted" />
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
            <div className="flex items-center gap-1">
              <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
              <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
            </div>
          </div>
        </header>

        {/* Tasks section skeleton */}
        <section className="flex w-full flex-col gap-4">
          <div className="h-7 w-24 animate-pulse rounded bg-muted" />
          <div className="min-h-[280px] overflow-hidden rounded-2xl border border-border bg-card w-full">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-b-0"
              >
                <div className="h-4 w-4 shrink-0 animate-pulse rounded border border-input bg-muted" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="h-4 w-3/4 max-w-sm animate-pulse rounded bg-muted" />
                  <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 px-5 py-3">
              <div className="h-4 w-4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </section>

        {/* Calendar section skeleton */}
        <section className="flex w-full max-w-[720px] flex-col gap-4">
          <div className="h-7 w-28 animate-pulse rounded bg-muted" />
          <div className="flex min-h-[180px] flex-col gap-1">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex gap-3 rounded-xl bg-muted/50 px-2 py-2"
              >
                <div className="w-[3px] shrink-0 self-stretch animate-pulse rounded bg-muted" />
                <div className="flex flex-1 flex-col gap-1 py-0.5">
                  <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Journal section skeleton */}
        <section className="flex w-full flex-col gap-4">
          <div className="h-7 w-20 animate-pulse rounded bg-muted" />
          <div className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-4 shadow-sm">
            <div className="min-h-[80px] animate-pulse rounded-lg bg-muted/50" />
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <div className="size-8 animate-pulse rounded-full bg-muted" />
                <div className="h-8 w-32 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="size-8 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
          <div className="min-h-[200px] overflow-hidden rounded-2xl border border-border bg-card w-full">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex gap-5 border-b border-border px-5 py-4 last:border-b-0"
              >
                <div className="h-4 w-12 shrink-0 animate-pulse rounded bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
                  <div className="h-4 w-2/3 max-w-sm animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
