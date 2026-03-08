"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { CurrentUser } from "@/lib/user";
import { getCurrentUser, deleteCurrentUser } from "@/lib/user-client";

function getInitials(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((s) => s[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return "?";
}

export default function SettingsAccountPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser().then((user) => {
      if (!cancelled) {
        setCurrentUser(user);
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDeleteAccount() {
    const { error } = await deleteCurrentUser();
    if (error) {
      // Optionally toast or set error state
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex gap-12 items-center w-full">
          <div className="size-[140px] rounded-full bg-muted animate-pulse shrink-0" />
          <div className="flex-1 min-w-0 space-y-6">
            <div className="space-y-2">
              <div className="h-4 w-24 bg-muted rounded animate-pulse" />
              <div className="h-10 w-full bg-muted rounded-lg animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              <div className="h-10 w-full bg-muted rounded-lg animate-pulse" />
            </div>
          </div>
        </div>
        <Separator />
        <div className="space-y-4">
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          <div className="h-10 w-32 bg-muted rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8 w-full">
      <div className="flex flex-col sm:flex-row gap-12 items-start sm:items-center w-full">
        <Avatar className="size-[140px] rounded-full shrink-0">
          <AvatarImage
            src={currentUser.photo ?? undefined}
            alt={currentUser.name ?? "Profile"}
          />
          <AvatarFallback className="text-2xl bg-muted text-muted-foreground">
            {getInitials(currentUser.name, currentUser.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-1 flex-col gap-6 min-w-0 w-full">
          <Field className="gap-1.5">
            <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
              Name
            </FieldTitle>
            <FieldContent>
              <Input
                type="text"
                value={currentUser.name ?? ""}
                readOnly
                className="h-10 rounded-lg px-4 py-2.5 text-sm font-normal bg-input border-input"
              />
            </FieldContent>
          </Field>
          <Field className="gap-1.5">
            <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
              Email
            </FieldTitle>
            <FieldContent>
              <Input
                type="email"
                value={currentUser.email ?? ""}
                readOnly
                className="h-10 rounded-lg px-4 py-2.5 text-sm font-normal bg-input border-input"
              />
            </FieldContent>
          </Field>
        </div>
      </div>

      <Separator className="bg-border" />

      <div className="flex flex-col gap-4 w-full">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium leading-5 text-foreground">
            Danger zone
          </p>
          <p className="text-[13px] leading-5 tracking-[-0.13px] text-muted-foreground">
            Proceeding will delete all workspaces owned by this account. Team
            workspaces will only be deleted if you are the last member.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              className="rounded-lg border border-input shadow-xs self-start"
            >
              Delete account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete account</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. All your data and workspaces will
                be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void handleDeleteAccount()}
              >
                Delete account
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
