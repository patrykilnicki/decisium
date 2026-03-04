"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WeeklySummaryContent } from "@/packages/agents/schemas/summary.schema";
import { format, endOfWeek } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDown, ChevronUp } from "@hugeicons/core-free-icons";

interface WeeklySummaryCardProps {
  weekStart: string;
  summary: WeeklySummaryContent;
  onExpand?: () => void;
}

export function WeeklySummaryCard({
  weekStart,
  summary,
  onExpand,
}: WeeklySummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const weekEnd = endOfWeek(new Date(weekStart), { weekStartsOn: 1 });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            {format(new Date(weekStart), "MMM d")} –{" "}
            {format(weekEnd, "MMM d, yyyy")}
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
          {summary.patterns.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Patterns</h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {summary.patterns.map((pattern, i) => (
                  <li key={i}>{pattern}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.themes.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Themes</h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {summary.themes.map((theme, i) => (
                  <li key={i}>{theme}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.insights.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2">Insights</h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {summary.insights.map((insight, i) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
