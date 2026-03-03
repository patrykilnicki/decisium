"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { createDocument } from "@/app/actions/vault";

export default function NewVaultDocumentPage() {
  const router = useRouter();

  useEffect(() => {
    async function create() {
      const { data, error } = await createDocument({
        title: "Untitled",
      });
      if (error) {
        console.error("Failed to create document:", error);
        router.push("/vault");
        return;
      }
      if (data?.id) {
        router.replace(`/vault/documents/${data.id}`);
      }
    }
    create();
  }, [router]);

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="flex h-full items-center justify-center p-8">
          <p className="text-muted-foreground">Creating document...</p>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
