import { HomePageSkeleton } from "@/app/home/components/home-page-skeleton";

/**
 * Lightweight loading fallback for /home: skeleton only, no ProtectedRoute/AppLayout.
 * Avoids mounting auth, realtime, and sidebar during the loading state.
 */
export default function HomeLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-y-auto scroll-smooth">
      <HomePageSkeleton />
    </div>
  );
}
