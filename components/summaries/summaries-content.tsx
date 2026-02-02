"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getDailySummaries,
  getWeeklySummaries,
  getMonthlySummaries,
} from "@/app/actions/summaries";
import { DaySummaryCard } from "@/components/daily/day-summary-card";
import { WeeklySummaryCard } from "@/components/summaries/weekly-summary-card";
import { MonthlySummaryCard } from "@/components/summaries/monthly-summary-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import type {
  DailySummaryContent,
  WeeklySummaryContent,
  MonthlySummaryContent,
} from "@/packages/agents/schemas/summary.schema";

interface DailySummaryRow {
  id: string;
  date: string;
  content: DailySummaryContent;
}

interface WeeklySummaryRow {
  id: string;
  week_start: string;
  content: WeeklySummaryContent;
}

interface MonthlySummaryRow {
  id: string;
  month_start: string;
  content: MonthlySummaryContent;
}

const EMPTY_MESSAGE =
  "No summaries yet. Summaries are generated automatically from your Daily entries.";

export function SummariesContent() {
  const [loading, setLoading] = useState(true);
  const [dailySummaries, setDailySummaries] = useState<DailySummaryRow[]>([]);
  const [weeklySummaries, setWeeklySummaries] = useState<WeeklySummaryRow[]>([]);
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummaryRow[]>(
    []
  );

  const loadSummaries = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const [daily, weekly, monthly] = await Promise.all([
        getDailySummaries(user.id),
        getWeeklySummaries(user.id),
        getMonthlySummaries(user.id),
      ]);
      setDailySummaries(daily as DailySummaryRow[]);
      setWeeklySummaries(weekly as WeeklySummaryRow[]);
      setMonthlySummaries(monthly as MonthlySummaryRow[]);
    } catch (error) {
      console.error("Failed to load summaries:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-4">
          <h1 className="text-xl font-semibold">Summaries</h1>
          <p className="text-sm text-muted-foreground">
            Daily, weekly, and monthly insights from your entries
          </p>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-sm">Loading summaries...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10 p-4">
        <h1 className="text-xl font-semibold">Summaries</h1>
        <p className="text-sm text-muted-foreground">
          Daily, weekly, and monthly insights from your entries
        </p>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="daily" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>

          <TabsContent value="daily" className="space-y-4">
            {dailySummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">
                {EMPTY_MESSAGE}
              </p>
            ) : (
              <div className="space-y-4">
                {dailySummaries.map((s) => (
                  <DaySummaryCard
                    key={s.id}
                    date={s.date}
                    summary={s.content}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="weekly" className="space-y-4">
            {weeklySummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">
                {EMPTY_MESSAGE}
              </p>
            ) : (
              <div className="space-y-4">
                {weeklySummaries.map((s) => (
                  <WeeklySummaryCard
                    key={s.id}
                    weekStart={s.week_start}
                    summary={s.content}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="monthly" className="space-y-4">
            {monthlySummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8">
                {EMPTY_MESSAGE}
              </p>
            ) : (
              <div className="space-y-4">
                {monthlySummaries.map((s) => (
                  <MonthlySummaryCard
                    key={s.id}
                    monthStart={s.month_start}
                    summary={s.content}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
