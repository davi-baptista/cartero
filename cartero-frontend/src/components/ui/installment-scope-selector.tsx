"use client";

import { useId } from "react";
import { InstallmentScope } from "@/types";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export const INSTALLMENT_SCOPE_LABELS: Record<InstallmentScope, string> = {
  [InstallmentScope.ONE]: "Apenas esta",
  [InstallmentScope.NEXT]: "Esta e as próximas",
  [InstallmentScope.ALL]: "Todas as parcelas",
};

export function installmentScopeDescription(
  scope: InstallmentScope,
  options: { count?: number; position?: number | null } = {},
): string {
  const { count, position } = options;
  if (scope === InstallmentScope.ONE) {
    return position ? `Somente a parcela ${position}` : "Somente esta parcela";
  }
  if (scope === InstallmentScope.NEXT) {
    return count === undefined
      ? "Afeta esta e as próximas parcelas"
      : `${count} ${count === 1 ? "parcela" : "parcelas"}`;
  }
  return count === undefined
    ? "Afeta todas as parcelas da série"
    : `A série inteira · ${count} ${count === 1 ? "parcela" : "parcelas"}`;
}

export interface InstallmentScopeOption {
  scope: InstallmentScope;
  description: string;
  affectedTotal?: number;
  partialTotal?: boolean;
}

export function InstallmentScopeSelector({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  tone = "default",
}: {
  value: InstallmentScope;
  options: InstallmentScopeOption[];
  onChange: (scope: InstallmentScope) => void;
  ariaLabel: string;
  disabled?: boolean;
  tone?: "default" | "destructive";
}) {
  const groupName = useId();

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
      <legend className="sr-only">{ariaLabel}</legend>
      {options.map((option) => {
        const selected = value === option.scope;
        const destructive =
          tone === "destructive" && option.scope !== InstallmentScope.ONE;
        const inputId = `${groupName}-${option.scope.toLowerCase()}`;

        return (
          <label
            key={option.scope}
            htmlFor={inputId}
            className="min-w-0 cursor-pointer"
          >
            <input
              id={inputId}
              type="radio"
              name={groupName}
              value={option.scope}
              checked={selected}
              onChange={() => onChange(option.scope)}
              className="peer sr-only"
            />
            <span
              data-selected={selected}
              className={cn(
                "flex min-w-0 items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
                selected
                  ? "border-primary bg-primary/10"
                  : destructive
                    ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
                    : "border-border hover:bg-muted",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {INSTALLMENT_SCOPE_LABELS[option.scope]}
                </span>
                <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                  {option.description}
                </span>
              </span>
              {option.affectedTotal !== undefined && (
                <span className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                  {option.partialTotal && "no mínimo "}
                  {formatCurrency(option.affectedTotal)}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
