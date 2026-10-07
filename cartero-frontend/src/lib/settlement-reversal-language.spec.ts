import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
const receivableDrawer = read("../app/(dashboard)/receivables/receivable-detail-drawer.tsx");
const debtDrawer = read("../app/(dashboard)/debts/debt-detail-drawer.tsx");
const warningDialog = read("../app/(dashboard)/transactions/unmark-paid-warning-dialog.tsx");
const personDrawer = read("../components/person-statement-drawer.tsx");
const obligations = read("../app/(dashboard)/movements/obligations/obligations-client.tsx");
const income = read("../app/(dashboard)/recurring/income-panel.tsx");

describe("settlement reversal language", () => {
  it("names a received receivable reversal as undoing receipt", () => {
    expect(receivableDrawer).toContain("Desfazer recebimento");
    expect(warningDialog).toContain("kind === 'debt' ? 'Desfazer pagamento' : 'Desfazer recebimento'");
    expect(income).toContain("Desfazer recebimento de ${occurrence.title}");
  });

  it("names a debt reversal as undoing payment", () => {
    expect(debtDrawer).toContain("Desfazer pagamento");
    expect(warningDialog).toContain("kind === 'debt' ? 'Desfazer pagamento'");
  });

  it("chooses the reversal noun by domain in shared Person and Movements rows", () => {
    expect(personDrawer).toContain("isReceivable ? 'Desfazer recebimento' : 'Desfazer pagamento'");
    expect(obligations).toContain("row.domain === 'RECEIVABLE' ? 'Desfazer recebimento' : 'Desfazer pagamento'");
  });
});
