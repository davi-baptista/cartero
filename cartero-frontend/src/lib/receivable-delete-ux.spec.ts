import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, relativePath), "utf8");

const drawer = read(
  "../app/(dashboard)/receivables/receivable-detail-drawer.tsx",
);
const unlinkDialog = read(
  "../app/(dashboard)/receivables/receivable-unlink-dialog.tsx",
);
const sourceDeleteDialog = read(
  "../app/(dashboard)/receivables/source-transaction-delete-dialog.tsx",
);
const obligations = read(
  "../app/(dashboard)/movements/obligations/obligations-client.tsx",
);
const editScope = read(
  "../app/(dashboard)/transactions/installment-scope-dialog.tsx",
);
const income = read("../app/(dashboard)/recurring/income-panel.tsx");
const overview = read("../components/overview-contextual-details.tsx");
const personStatement = read("../components/person-statement-drawer.tsx");
const dialogPrimitive = read("../components/ui/dialog.tsx");
const drawerUiCopy = drawer.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

describe("automatic receivable delete flow", () => {
  it("keeps the operational footer to Edit and Delete and puts unlink inside Delete", () => {
    expect(drawer).toContain("(onEdit || showDeleteAction) && <DetailFooter");
    expect(drawer).not.toContain("Desvincular de {sourcePerson}</Button>");
    expect(drawer).toContain("Excluir cobran");
    expect(drawer).toContain("Excluir compra");
    expect(drawer).toContain("Manter compra e desvincular de ");
    expect(drawer).toContain("openDeleteFlow('unlink')");
    expect(drawer).toContain("openDeleteFlow('delete-source')");
  });

  it("sends simple unlink straight to preview and shows scope cards only for installments", () => {
    expect(unlinkDialog).toContain("{source.isInstallment && (");
    expect(unlinkDialog).toContain("<InstallmentScopeSelector");
    expect(unlinkDialog).toContain("previewUnlinkTransaction(source!.id, scope)");
    expect(unlinkDialog).toContain("previewQuery.data!.targetPersonId");
    expect(unlinkDialog).toContain("previewQuery.data!.eligibleIds");
    expect(editScope).toContain("<InstallmentScopeSelector");
  });

  it("keeps purchase deletion on the source preview and OPEN authority", () => {
    expect(sourceDeleteDialog).toContain("previewDeleteTransaction(transactionId!)");
    expect(sourceDeleteDialog).toContain(
      "deleteOpenInstallments(transactionId!, preview.deletable.map(({ id }) => id))",
    );
    expect(sourceDeleteDialog).toContain(": deleteTransaction(transactionId!)");
    expect(sourceDeleteDialog).not.toMatch(
      /InstallmentScopeSelector|\bONE\b|\bNEXT\b|\bALL\b/,
    );
    expect(drawer).not.toContain("deleteReceivable(");
  });

  it("keeps automatic received deletion protected and uses receipt terminology", () => {
    expect(drawer).toContain("openDeleteFlow('protected-received')");
    expect(drawer).toContain("Desfazer recebimento</Button>");
    expect(drawer).not.toContain("Marque a cobran");
  });

  it("removes obsolete instructions to open the source purchase", () => {
    expect(drawerUiCopy).not.toContain("abra a compra de origem");
    expect(drawerUiCopy).not.toContain("escolha o escopo da exclus");
    expect(drawerUiCopy).toContain("Cobran");
  });

  it("opens one explicit atomic action for a received recurring occurrence", () => {
    expect(drawer).toContain("<DialogTitle>Excluir recebimento?</DialogTitle>");
    expect(drawer).toContain("Desfazer recebimento e excluir");
    expect(drawer).toContain("openDeleteFlow('delete-recurring-received')");
    expect(drawer).toContain("await onDeleteRecurringReceived?.(receivable)");
    expect(income).toContain("onDeleteRecurringReceived=");
    expect(drawer).toContain("setDeleteFlow(null)");
    expect(drawer).toContain("onOpenChange={(next) => !next && !busy && onClose()}");
  });

  it("keeps recurring receipt deletion copy correctly encoded", () => {
    expect(drawer).toContain(
      "Este recebimento já foi registrado. Ao continuar, o lançamento financeiro do recebimento e esta cobrança serão removidos.",
    );
    for (const source of [income, obligations, overview, personStatement]) {
      expect(source).toContain("Recebimento desfeito e excluído");
    }
  });

  it("Case A: Cancel closes specialized flow to idle without a generic fallback", () => {
    expect(drawer).toContain("onDeleteFlowStart?.(receivable)");
    expect(obligations).toContain("onDeleteFlowStart={() => setDeleteIntent(null)}");
    expect(income).toContain("onDeleteFlowStart={() => setOccurrenceDeleteTarget(null)}");
    expect(drawer).toContain("onClose={() => setDeleteFlow(null)}");
    expect(obligations).not.toContain("source-purchase");
    expect(obligations).not.toContain("SourceTransactionDeleteDialog");
    expect(obligations).toContain("open={deleteIntent?.kind === 'confirm'}");
  });

  it("Case B: X closes the specialized dialog directly to idle", () => {
    expect(dialogPrimitive).toContain("showCloseButton = true");
    expect(drawer).toContain("onOpenChange={(next) => !next && !busy && onClose()}");
    expect(drawer).toContain("onClose={() => setDeleteFlow(null)}");
  });

  it("Case C: Escape uses the same controlled close transition to idle", () => {
    expect(drawer).toContain("onOpenChange={(next) => !next && !busy && onClose()}");
    expect(drawer).toContain("onClose={() => setDeleteFlow(null)}");
    expect(drawer).not.toMatch(/setTimeout|requestAnimationFrame|opacity-0|delay:/);
  });

  it("Case D: specialized confirmation never calls the generic delete callback", () => {
    const specialized = drawer.slice(
      drawer.indexOf("function ReceivedRecurringIncomeDeleteDialog"),
    );
    expect(specialized).toContain("await onConfirm()");
    expect(specialized).not.toContain("onDelete?.(receivable)");
    expect(drawer).toContain("onDeleteRecurringReceived?.(receivable)");
  });

  it("Case E: manual receivable keeps its legitimate generic confirmation", () => {
    expect(drawer).toContain("onDelete?.(receivable)");
    expect(obligations).toContain("handleDetailDelete(item, 'receivable')");
    expect(obligations).toContain("open={deleteIntent?.kind === 'confirm'}");
  });
});
