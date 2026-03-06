"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { CentralIcon } from "@/components/ui/central-icon";
import { cn } from "@/lib/utils";

export interface SuggestionItem {
  title: string;
  subtitle: string;
}

const DEFAULT_SUGGESTIONS: SuggestionItem[] = [
  { title: "Summarize this week", subtitle: "Summarize this week" },
  {
    title: "Coach me",
    subtitle: "What decisions worked best this month?",
  },
  {
    title: "Create routines",
    subtitle: "Where did I change my mind most often?",
  },
  {
    title: "Improve my calendar",
    subtitle: "What should I improve?",
  },
];

interface SuggestionCardsProps {
  suggestions?: SuggestionItem[];
  onSelect?: (item: SuggestionItem) => void;
  className?: string;
}

export function SuggestionCards({
  suggestions = DEFAULT_SUGGESTIONS,
  onSelect,
  className,
}: SuggestionCardsProps) {
  return (
    <div className={cn("grid w-full grid-cols-2 grid-rows-2 gap-4", className)}>
      {suggestions.map((item, index) => (
        <Card
          key={index}
          className={cn("cursor-pointer")}
          onClick={() => onSelect?.(item)}
        >
          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background shadow-sm">
              <CentralIcon name="IconMicrophone" size={20} />
            </div>
            <div className="flex flex-col gap-1">
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.subtitle}</CardDescription>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
