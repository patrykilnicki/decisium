import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { DailyContent } from "@/components/daily/daily-content";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return (
      <ProtectedRoute>
        <AppLayout>
          
          <DailyContent />
        </AppLayout>
      </ProtectedRoute>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-3xl">Daily Intelligence</CardTitle>
          <CardDescription className="text-lg">
            Your personal daily journaling and AI-powered reflection assistant
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Track your daily thoughts, plans, and observations. Ask AI questions
            about your patterns and get insights from your personal history.
          </p>
          <div className="flex gap-4">
            <Button asChild className="flex-1">
              <Link href="/auth">Get Started</Link>
            </Button>
            <Button variant="outline" asChild className="flex-1">
              <Link href="/auth">Sign In</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
