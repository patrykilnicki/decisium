"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DailySummaryContent } from "@/packages/agents/schemas/summary.schema";
import { format } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDown, ChevronUp } from "@hugeicons/core-free-icons";

interface DaySummaryCardProps {
  date: string;
  summary: DailySummaryContent;
  onExpand?: () => void;
}

export function DaySummaryCard({
  date,
  summary,
  onExpand,
}: DaySummaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            {format(new Date(date), "MMMM d, yyyy")}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setExpanded(!expanded);
              if (!expanded && onExpand) {
                onExpand();
              }
            }}
          >
            <HugeiconsIcon
              icon={expanded ? ChevronUp : ChevronDown}
              strokeWidth={2}
            />
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">Facts</h4>
            <ul className="list-disc list-inside space-y-1 text-sm">
              {summary.facts.map((fact, i) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
          </div>
          {summary.insight && (
            <div>
              <h4 className="font-semibold mb-2">Insight</h4>
              <p className="text-sm">{summary.insight}</p>
            </div>
          )}
          {summary.suggestion && (
            <div>
              <h4 className="font-semibold mb-2">Suggestion</h4>
              <p className="text-sm">{summary.suggestion}</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
