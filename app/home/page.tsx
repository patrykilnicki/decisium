"use client";

import { useEffect, useState } from "react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { HomeContent } from "@/components/home/home-content";
import { createClient } from "@/lib/supabase/client";

export default function HomePage() {
  const [userName, setUserName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUser() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const name =
          user.user_metadata?.full_name ??
          user.user_metadata?.name ??
          user.email?.split("@")[0];
        setUserName(name ?? "there");
        setUserId(user.id);
      } else {
        setUserName("there");
        setUserId(null);
      }
    }
    fetchUser();
  }, []);

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-y-auto scroll-smooth">
          <HomeContent userName={userName} userId={userId} />
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
