"use client";

import { Suspense } from "react";
import {
  TodoEmailScopeSection,
  TodoPromptSettingsSection,
} from "@/app/settings/components";
import { TodoEmailScopeSectionSkeleton } from "@/app/settings/components/todo-email-scope-section-skeleton";
import { TodoPromptSettingsSectionSkeleton } from "@/app/settings/components/todo-prompt-settings-section-skeleton";

function TasksFallback() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Tasks</h2>
        <p className="text-muted-foreground text-sm mt-1 max-w-xl">
          Control how to-do tasks are generated — which sources to include, what
          types of tasks to create, and any custom instructions for the model.
        </p>
      </div>
      <div className="flex flex-col gap-6 max-w-xl">
        <TodoPromptSettingsSectionSkeleton />
        <TodoEmailScopeSectionSkeleton />
      </div>
    </div>
  );
}

export default function SettingsTasksPage() {
  return (
    <Suspense fallback={<TasksFallback />}>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Tasks</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-xl">
            Control how to-do tasks are generated — which sources to include,
            what types of tasks to create, and any custom instructions for the
            model.
          </p>
        </div>
        <div className="flex flex-col gap-6 max-w-xl">
          <TodoPromptSettingsSection />
          <TodoEmailScopeSection />
        </div>
      </div>
    </Suspense>
  );
}
