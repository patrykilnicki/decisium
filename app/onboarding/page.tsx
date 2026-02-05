"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  OnboardingLayout,
  StepProgress,
  StepConnectApps,
} from "@/components/onboarding";
import { completeOnboarding } from "@/app/actions/onboarding";

const TOTAL_STEPS = 1;

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentStep = parseInt(searchParams.get("step") || "1", 10);

  function handleNextStep() {
    if (currentStep < TOTAL_STEPS) {
      router.push(`/onboarding?step=${currentStep + 1}`);
    } else {
      handleComplete();
    }
  }

  async function handleComplete() {
    await completeOnboarding();
    router.push("/");
  }

  function renderStep() {
    switch (currentStep) {
      case 1:
        return <StepConnectApps onComplete={handleNextStep} />;
      default:
        return <StepConnectApps onComplete={handleNextStep} />;
    }
  }

  return (
    <OnboardingLayout>
      <div className="mb-4 text-center">
        <h1 className="text-3xl font-bold text-foreground">Decisium</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Let&apos;s get you set up
        </p>
      </div>
      <StepProgress currentStep={currentStep} totalSteps={TOTAL_STEPS} />
      {renderStep()}
    </OnboardingLayout>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <OnboardingLayout>
          <div className="flex items-center justify-center">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        </OnboardingLayout>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
