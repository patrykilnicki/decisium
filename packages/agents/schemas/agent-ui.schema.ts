import { z } from "zod";

export const agentUiComponentSchema = z.enum([
  "task_approval_card",
  "calendar_event_approval_card",
  "email_summary_card",
  "risk_signal_card",
  "table",
  "chart",
  "form",
]);

export type AgentUiComponent = z.infer<typeof agentUiComponentSchema>;

export const taskApprovalItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  priority: z.enum(["normal", "urgent"]).default("normal"),
  suggestedNextAction: z.string().min(1).max(500),
  dueAt: z.string().datetime(),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
});

export type TaskApprovalItem = z.infer<typeof taskApprovalItemSchema>;

export const taskApprovalCardPropsSchema = z.object({
  title: z.string().min(1).max(140),
  description: z.string().min(1).max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  request: z.string().min(1),
  items: z.array(taskApprovalItemSchema).min(1).max(20),
});

export type TaskApprovalCardProps = z.infer<typeof taskApprovalCardPropsSchema>;

const genericComponentPropsSchema = z.record(z.unknown());

export const agentUiMessageSchema = z.discriminatedUnion("component", [
  z.object({
    component: z.literal("task_approval_card"),
    props: taskApprovalCardPropsSchema,
  }),
  z.object({
    component: z.literal("calendar_event_approval_card"),
    props: genericComponentPropsSchema,
  }),
  z.object({
    component: z.literal("email_summary_card"),
    props: genericComponentPropsSchema,
  }),
  z.object({
    component: z.literal("risk_signal_card"),
    props: genericComponentPropsSchema,
  }),
  z.object({
    component: z.literal("table"),
    props: genericComponentPropsSchema,
  }),
  z.object({
    component: z.literal("chart"),
    props: genericComponentPropsSchema,
  }),
  z.object({
    component: z.literal("form"),
    props: genericComponentPropsSchema,
  }),
]);

export type AgentUiMessage = z.infer<typeof agentUiMessageSchema>;

export const approvalDecisionSchema = z.enum(["approve", "edit", "reject"]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const approvalSubmissionSchema = z.object({
  proposalId: z.string().uuid(),
  decision: approvalDecisionSchema,
  editedProps: taskApprovalCardPropsSchema.optional(),
});

export type ApprovalSubmission = z.infer<typeof approvalSubmissionSchema>;
