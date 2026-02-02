"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MonthlySummaryContent } from "@/packages/agents/schemas/summary.schema";
import { format } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDown, ChevronUp } from "@hugeicons/core-free-icons";

interface MonthlySummaryCardProps {
  monthStart: string;
  summary: MonthlySummaryContent;
  onExpand?: () => void;
}

export function MonthlySummaryCard({
  monthStart,
  summary,
  onExpand,
}: MonthlySummaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            {format(new Date(monthStart), "MMMM yyyy")}
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
          {summary.trends.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Trends</h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {summary.trends.map((trend, i) => (
                  <li key={i}>{trend}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.strategic_insights.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Strategic Insights</h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {summary.strategic_insights.map((insight, i) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.reflections.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Reflections</h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {summary.reflections.map((reflection, i) => (
                  <li key={i}>{reflection}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
