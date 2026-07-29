import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepIndicator({
  steps,
  currentStep,
}: {
  steps: string[];
  currentStep: number;
}) {
  return (
    <ol aria-label="Progress" className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {steps.map((label, index) => {
        const isComplete = index < currentStep;
        const isCurrent = index === currentStep;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                isComplete && "bg-primary text-primary-foreground",
                isCurrent && !isComplete && "border-2 border-primary text-primary",
                !isComplete && !isCurrent && "border border-border text-muted-foreground",
              )}
            >
              {isComplete ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                isCurrent ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden className="mx-1 h-px w-4 bg-border sm:w-8" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
