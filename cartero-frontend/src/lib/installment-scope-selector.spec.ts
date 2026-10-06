import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InstallmentScope } from "@/types";
import {
  InstallmentScopeSelector,
  installmentScopeDescription,
} from "@/components/ui/installment-scope-selector";
import { originalInstallmentNumber } from "@/lib/installment-series";

const options = [
  {
    scope: InstallmentScope.ONE,
    description: installmentScopeDescription(InstallmentScope.ONE, {
      position: 1,
    }),
    affectedTotal: 120,
  },
  {
    scope: InstallmentScope.NEXT,
    description: installmentScopeDescription(InstallmentScope.NEXT, {
      count: 2,
    }),
    affectedTotal: 240,
  },
  {
    scope: InstallmentScope.ALL,
    description: installmentScopeDescription(InstallmentScope.ALL, {
      count: 2,
    }),
    affectedTotal: 240,
  },
];

describe("InstallmentScopeSelector", () => {
  it("renders the shared copy as keyboard-operable native radio cards", () => {
    const markup = renderToStaticMarkup(
      createElement(InstallmentScopeSelector, {
        value: InstallmentScope.ALL,
        options,
        onChange: vi.fn(),
        ariaLabel: "Escopo do parcelamento",
      }),
    );

    expect(markup).toContain("Apenas esta");
    expect(markup).toContain("Esta e as próximas");
    expect(markup).toContain("Todas as parcelas");
    expect(markup).toContain("Somente a parcela 1");
    expect(markup).toContain("A série inteira · 2 parcelas");
    expect(markup).toContain("R$");
    expect(markup).toContain('type="radio"');
    expect(markup.match(/type="radio"/g)).toHaveLength(3);
    expect(markup.match(/checked=""/g)).toHaveLength(1);
    expect(markup).toContain("peer-focus-visible:ring-2");
  });

  it("uses singular copy for a one-item impact", () => {
    expect(
      installmentScopeDescription(InstallmentScope.NEXT, { count: 1 }),
    ).toBe("1 parcela");
  });

  it("keeps original 2/2 identity when the first installment is missing", () => {
    const visibleReceivableSource = {
      id: "installment-2",
      parentId: "installment-1",
      installmentIndex: 2,
      installmentCount: 2,
    } as Parameters<typeof originalInstallmentNumber>[0];
    const position = originalInstallmentNumber(visibleReceivableSource);
    const one = installmentScopeDescription(InstallmentScope.ONE, { position });
    const next = installmentScopeDescription(InstallmentScope.NEXT, { count: 1 });
    const all = installmentScopeDescription(InstallmentScope.ALL, { count: 1 });

    expect(position).toBe(2);
    expect(one).toBe("Somente a parcela 2");
    expect(one).not.toMatch(/parcela [13]/);
    expect(next).toBe("1 parcela");
    expect(all).toContain("1 parcela");
  });
});
