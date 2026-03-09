"use client";

import { ReactNode } from "react";

interface OnboardingLayoutProps {
  children: ReactNode;
}

export function OnboardingLayout({ children }: OnboardingLayoutProps) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background bg-[url('/bg.svg')] bg-no-repeat bg-left-top bg-[length:auto_50vh] dark:bg-[url('/bg-dark.svg')] p-4">
      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        {children}
      </div>
    </div>
  );
}
