"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <nav className="border-b">
      <div className="container mx-auto flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <Link href="/daily">
            <Button
              variant={pathname === "/daily" ? "default" : "ghost"}
              className={cn(pathname === "/daily" && "font-semibold")}
            >
              Daily
            </Button>
          </Link>
          <Link href="/ask">
            <Button
              variant={pathname.startsWith("/ask") ? "default" : "ghost"}
              className={cn(pathname.startsWith("/ask") && "font-semibold")}
            >
              Ask AI
            </Button>
          </Link>
        </div>
        <Button variant="ghost" onClick={handleSignOut}>
          Sign Out
        </Button>
      </div>
    </nav>
  );
}
