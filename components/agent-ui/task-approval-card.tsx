"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { TaskApprovalCardProps } from "@/packages/agents/schemas/agent-ui.schema";

export interface TaskApprovalCardComponentProps {
  proposalId: string;
  props: TaskApprovalCardProps;
  isSubmitting?: boolean;
  onApprove: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
  onEditApprove: (
    proposalId: string,
    props: TaskApprovalCardProps,
  ) => Promise<void>;
}

export function TaskApprovalCard({
  proposalId,
  props,
  isSubmitting = false,
  onApprove,
  onReject,
  onEditApprove,
}: TaskApprovalCardComponentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<TaskApprovalCardProps>(props);

  const urgentCount = useMemo(
    () => draft.items.filter((item) => item.priority === "urgent").length,
    [draft.items],
  );

  function updateItem(
    index: number,
    key: "title" | "summary" | "suggestedNextAction" | "dueAt" | "priority",
    value: string,
  ) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (key === "priority") {
          return {
            ...item,
            priority: value === "urgent" ? "urgent" : "normal",
          };
        }
        return { ...item, [key]: value };
      }),
    }));
  }

  return (
    <Card className="border border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle>AI action requires approval</CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{draft.items.length} task(s)</span>
          <span>•</span>
          <span>{urgentCount} urgent</span>
          <span>•</span>
          <span>{draft.date}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {draft.description ?? "Review before saving."}
        </div>
        {draft.items.map((item, index) => (
          <div
            key={item.id}
            className="rounded-md border border-border bg-background/60 p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <Badge
                variant={
                  item.priority === "urgent" ? "destructive" : "secondary"
                }
              >
                {item.priority}
              </Badge>
              <span className="text-xs text-muted-foreground">
                #{index + 1}
              </span>
            </div>
            {isEditing ? (
              <div className="space-y-2">
                <Input
                  value={item.title}
                  onChange={(event) =>
                    updateItem(index, "title", event.target.value)
                  }
                  placeholder="Task title"
                />
                <Textarea
                  value={item.summary}
                  onChange={(event) =>
                    updateItem(index, "summary", event.target.value)
                  }
                  placeholder="Task summary"
                />
                <Textarea
                  value={item.suggestedNextAction}
                  onChange={(event) =>
                    updateItem(index, "suggestedNextAction", event.target.value)
                  }
                  placeholder="Suggested next action"
                />
                <Input
                  type="datetime-local"
                  value={item.dueAt.slice(0, 16)}
                  onChange={(event) =>
                    updateItem(index, "dueAt", `${event.target.value}:00.000Z`)
                  }
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      item.priority === "normal" ? "secondary" : "outline"
                    }
                    onClick={() => updateItem(index, "priority", "normal")}
                  >
                    Normal
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      item.priority === "urgent" ? "destructive" : "outline"
                    }
                    onClick={() => updateItem(index, "priority", "urgent")}
                  >
                    Urgent
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                <div className="font-medium">{item.title}</div>
                <div className="text-muted-foreground">{item.summary}</div>
                <div className="text-muted-foreground">
                  Next: {item.suggestedNextAction}
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {!isEditing ? (
          <>
            <Button
              type="button"
              size="sm"
              onClick={() => onApprove(proposalId)}
              disabled={isSubmitting}
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setIsEditing(true)}
              disabled={isSubmitting}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onReject(proposalId)}
              disabled={isSubmitting}
            >
              Reject
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              onClick={() => onEditApprove(proposalId, draft)}
              disabled={isSubmitting}
            >
              Save and approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(props);
                setIsEditing(false);
              }}
              disabled={isSubmitting}
            >
              Cancel edits
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  );
}
