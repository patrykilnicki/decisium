"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDailySummaries,
  getWeeklySummaries,
  getMonthlySummaries,
} from "@/app/actions/summaries";
import { useAuth } from "@/contexts/auth-context";
import { DaySummaryCard } from "@/app/summaries/components/day-summary-card";
import { WeeklySummaryCard } from "@/app/summaries/components/weekly-summary-card";
import { MonthlySummaryCard } from "@/app/summaries/components/monthly-summary-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dailySummaries, setDailySummaries] = useState<DailySummaryRow[]>([]);
  const [weeklySummaries, setWeeklySummaries] = useState<WeeklySummaryRow[]>(
    [],
  );
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummaryRow[]>(
    [],
  );

  const loadSummaries = useCallback(async () => {
    const userId = user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const [daily, weekly, monthly] = await Promise.all([
        getDailySummaries(userId),
        getWeeklySummaries(userId),
        getMonthlySummaries(userId),
      ]);
      setDailySummaries(daily as unknown as DailySummaryRow[]);
      setWeeklySummaries(weekly as unknown as WeeklySummaryRow[]);
      setMonthlySummaries(monthly as unknown as MonthlySummaryRow[]);
    } catch (error) {
      console.error("Failed to load summaries:", error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-4">
          <Skeleton className="h-7 w-32 mb-2" />
          <Skeleton className="h-4 w-72" />
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-6">
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton
                  key={i}
                  className="h-48 w-full rounded-xl border border-border"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background bg-[url('/bg.svg')] bg-no-repeat bg-left-top bg-[length:auto_50vh] dark:bg-[url('/bg-dark.svg')] p-4">
      <div className="flex flex-col h-full max-w-2xl mx-auto">
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
    </div>
  );
}
