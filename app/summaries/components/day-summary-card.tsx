"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DailySummaryContent } from "@/packages/agents/schemas/summary.schema";
import { format, isToday } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDown, ChevronUp } from "@hugeicons/core-free-icons";

interface DaySummaryCardProps {
  date: string;
  summary: DailySummaryContent;
  onExpand?: () => void;
}

function LaurelIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2c-2 3-4 8-4 12 0 4 1.5 6 4 8 2.5-2 4-4 4-8 0-4-2-9-4-12Z" />
      <path d="M12 2c2 3 4 8 4 12 0 4-1.5 6-4 8-2.5-2-4-4-4-8 0-4 2-9 4-12Z" />
    </svg>
  );
}

export function DaySummaryCard({
  date,
  summary,
  onExpand,
}: DaySummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const dateObj = new Date(date);
  const titleLabel = isToday(dateObj)
    ? `Today ${format(dateObj, "d MMM yyyy")}`
    : format(dateObj, "MMMM d, yyyy");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{titleLabel}</CardTitle>
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
          {/* Productivity format (score, time allocation, narrative, pills) */}
          {"score" in summary && typeof summary.score === "number" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <LaurelIcon className="size-8 text-emerald-600 shrink-0" />
                <span className="text-3xl font-semibold tabular-nums">
                  {summary.score}
                </span>
                <LaurelIcon className="size-8 text-emerald-600 shrink-0" />
                <span className="text-lg font-medium text-emerald-600">
                  {summary.score_label}
                </span>
              </div>
              {"explanation" in summary && summary.explanation && (
                <p className="text-sm text-muted-foreground">
                  {summary.explanation}
                </p>
              )}
              {"time_allocation" in summary && summary.time_allocation && (
                <div className="space-y-2">
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="bg-emerald-500 shrink-0 transition-[width]"
                      style={{
                        width: `${summary.time_allocation.meetings}%`,
                      }}
                    />
                    <div
                      className="bg-violet-500 shrink-0 transition-[width]"
                      style={{
                        width: `${summary.time_allocation.deep_work}%`,
                      }}
                    />
                    <div
                      className="bg-amber-500 shrink-0 transition-[width]"
                      style={{
                        width: `${summary.time_allocation.other}%`,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-emerald-500" />
                      Meetings
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-violet-500" />
                      Deep work
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-amber-500" />
                      Other
                    </span>
                  </div>
                </div>
              )}
              {"narrative_summary" in summary && summary.narrative_summary && (
                <p className="text-sm">{summary.narrative_summary}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {"notes_added" in summary && (
                  <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs">
                    {summary.notes_added} notes added
                  </span>
                )}
                {"new_ideas" in summary && (
                  <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs">
                    {summary.new_ideas} new ideas
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Facts/insight/suggestion format (cron + seed) */}
          {"facts" in summary && Array.isArray(summary.facts) && (
            <div>
              <h4 className="font-semibold mb-2">Facts</h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {(summary.facts ?? []).map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            </div>
          )}
          {"insight" in summary && summary.insight && !("score" in summary) && (
            <div>
              <h4 className="font-semibold mb-2">Insight</h4>
              <p className="text-sm">{summary.insight}</p>
            </div>
          )}
          {"suggestion" in summary && summary.suggestion && (
            <div>
              <h4 className="font-semibold mb-2">Suggestion</h4>
              <p className="text-sm">{summary.suggestion}</p>
            </div>
          )}

          {/* Reflection format (context, key_entry, identity_insight, etc.) */}
          {"context" in summary && summary.context && (
            <div>
              <h4 className="font-semibold mb-2">Context</h4>
              <p className="text-sm">{summary.context}</p>
            </div>
          )}
          {"key_entry" in summary && summary.key_entry && (
            <div>
              <h4 className="font-semibold mb-2">Key entry</h4>
              <p className="text-sm">{summary.key_entry}</p>
            </div>
          )}
          {"identity_insight" in summary && summary.identity_insight && (
            <div>
              <h4 className="font-semibold mb-2">Identity insight</h4>
              <p className="text-sm">{summary.identity_insight}</p>
            </div>
          )}
          {"reflection_prompt" in summary && summary.reflection_prompt && (
            <div>
              <h4 className="font-semibold mb-2">Reflection prompt</h4>
              <p className="text-sm">{summary.reflection_prompt}</p>
            </div>
          )}
          {"pattern_observation" in summary && summary.pattern_observation && (
            <div>
              <h4 className="font-semibold mb-2">Pattern observation</h4>
              <p className="text-sm">{summary.pattern_observation}</p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
