"use client";

import { Suspense } from "react";
import { Separator } from "@/components/ui/separator";
import {
  TodoEmailScopeSection,
  TodoPromptSettingsSection,
} from "@/app/settings/components";
import { TodoEmailScopeSectionSkeleton } from "@/app/settings/components/todo-email-scope-section-skeleton";
import { TodoPromptSettingsSectionSkeleton } from "@/app/settings/components/todo-prompt-settings-section-skeleton";

function TasksContent() {
  return (
    <div className="p-4">
      <div className="max-w-2xl space-y-8">
        <TodoEmailScopeSection />
        <Separator />
        <TodoPromptSettingsSection />
      </div>
    </div>
  );
}

function TasksFallback() {
  return (
    <div className="p-4 max-w-2xl space-y-8">
      <TodoEmailScopeSectionSkeleton />
      <Separator />
      <TodoPromptSettingsSectionSkeleton />
    </div>
  );
}

export default function SettingsTasksPage() {
  return (
    <Suspense fallback={<TasksFallback />}>
      <TasksContent />
    </Suspense>
  );
}
