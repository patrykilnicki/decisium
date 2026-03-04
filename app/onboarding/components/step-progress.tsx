"use client";

interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
}

export function StepProgress({ currentStep, totalSteps }: StepProgressProps) {
  return (
    <div className="mb-8 flex w-full items-center justify-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
        <div key={step} className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
              step === currentStep
                ? "bg-primary text-primary-foreground"
                : step < currentStep
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {step}
          </div>
          {step < totalSteps && (
            <div
              className={`h-0.5 w-8 transition-colors ${
                step < currentStep ? "bg-primary/20" : "bg-muted"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
