"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/");
    }
  }, [loading, user, router]);

  // When loaded and no user, redirect (handled in effect); hide content
  if (!loading && !user) {
    return null;
  }

  // Render children even while loading so layout and page content can mount
  // and start reacting to userId from context as soon as it's available
  return <>{children}</>;
}
