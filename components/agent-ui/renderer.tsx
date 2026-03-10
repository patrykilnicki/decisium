"use client";

import type { TaskApprovalCardProps } from "@/packages/agents/schemas/agent-ui.schema";
import { agentUiRegistry } from "./registry";

export interface PendingApprovalCard {
  taskId: string;
  proposalId: string;
  component: "task_approval_card";
  props: TaskApprovalCardProps;
}

interface AgentUiRendererProps {
  cards: PendingApprovalCard[];
  submittingProposalId?: string | null;
  onApprove: (taskId: string, proposalId: string) => Promise<void>;
  onReject: (taskId: string, proposalId: string) => Promise<void>;
  onEditApprove: (
    taskId: string,
    proposalId: string,
    props: TaskApprovalCardProps,
  ) => Promise<void>;
}

export function AgentUiRenderer({
  cards,
  submittingProposalId,
  onApprove,
  onReject,
  onEditApprove,
}: AgentUiRendererProps) {
  if (cards.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 px-4 pb-2">
      {cards.map((card) => {
        const Component = agentUiRegistry[card.component];
        if (!Component) return null;
        return (
          <Component
            key={`${card.taskId}:${card.proposalId}`}
            proposalId={card.proposalId}
            props={card.props}
            isSubmitting={submittingProposalId === card.proposalId}
            onApprove={async () => onApprove(card.taskId, card.proposalId)}
            onReject={async () => onReject(card.taskId, card.proposalId)}
            onEditApprove={async (_, props) =>
              onEditApprove(card.taskId, card.proposalId, props)
            }
          />
        );
      })}
    </div>
  );
}
