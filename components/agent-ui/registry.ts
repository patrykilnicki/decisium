"use client";

import type { ComponentType } from "react";
import {
  TaskApprovalCard,
  type TaskApprovalCardComponentProps,
} from "./task-approval-card";

export const agentUiRegistry: Record<
  string,
  ComponentType<TaskApprovalCardComponentProps>
> = {
  task_approval_card: TaskApprovalCard,
};
