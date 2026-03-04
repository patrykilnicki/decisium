"use client";

import { ReactNode } from "react";

interface OnboardingLayoutProps {
  children: ReactNode;
}

export function OnboardingLayout({ children }: OnboardingLayoutProps) {
  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-4"
      style={{
        backgroundImage: "url(/bg.svg)",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "top left",
        backgroundSize: "auto 50vh",
      }}
    >
      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        {children}
      </div>
    </div>
  );
}
