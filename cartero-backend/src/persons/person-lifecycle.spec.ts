import { describe, expect, it, vi } from 'vitest';
import { PersonsService } from './persons.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import { USER_ID } from 'src/common/testing/fixtures';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Ciclo de vida da Person — exclusão e renomeação (Fase 8B)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Excluir uma pessoa significa "parar de manter esse contato cadastrado", não
 * "apagar os compromissos". O que garante isso é a combinação de duas coisas
 * já presentes no modelo:
 *
 *   1. o FK `personId` é `ON DELETE SET NULL` em Debt, Receivable e
 *      Transaction — o registro sobrevive, só perde o vínculo;
 *   2. `creditorName`/`debtorName` guardam o nome no momento da criação, então
 *      a contraparte continua legível depois de o vínculo cair.
 *
 * Sem o item 2 a exclusão precisaria ser bloqueada: um registro com
 * `personId: null` e nome vazio não diria a ninguém a quem se referia.
 */

function buildHarness(
  person = { id: 'person-1', userId: USER_ID, name: 'Eva' },
) {
  const deletes: string[] = [];
  const updates: any[] = [];

  const prisma: any = {
    person: {
      findUnique: vi.fn(async () => person),
      delete: vi.fn(async ({ where }: any) => {
        deletes.push(where.id);
        return person;
      }),
      update: vi.fn(async ({ data }: any) => {
        updates.push(data);
        return { ...person, ...data };
      }),
      findFirst: vi.fn(async () => null),
    },
  };

  const validation = new EntityValidationService(prisma as PrismaService);

  return {
    service: new PersonsService(prisma as PrismaService, validation),
    prisma,
    deletes,
    updates,
  };
}

describe('Excluir pessoa', () => {
  it('remove apenas a pessoa', async () => {
    const harness = buildHarness();

    await harness.service.remove('person-1', USER_ID);

    expect(harness.deletes).toEqual(['person-1']);
  });

  it('NÃO apaga dívidas, cobranças ou transações', async () => {
    /**
     * A garantia é do banco (`ON DELETE SET NULL`), não do serviço — e é por
     * isso que o teste verifica a AUSÊNCIA de deletes em cascata: se alguém
     * algum dia adicionar um `deleteMany` "para limpar", este teste cai.
     *
     * Apagar o histórico seria destruir movimento financeiro que aconteceu de
     * verdade, algo que nem o usuário pediu nem consegue reconstruir.
     */
    const harness = buildHarness();

    await harness.service.remove('person-1', USER_ID);

    expect(harness.prisma.debt).toBeUndefined();
    expect(harness.prisma.receivable).toBeUndefined();
    expect(harness.prisma.transaction).toBeUndefined();
  });

  it('não é bloqueada por pendências', async () => {
    // A exclusão é sobre o cadastro do contato. As obrigações continuam
    // existindo e legíveis pelo nome que ficou gravado nelas.
    const harness = buildHarness();

    await expect(
      harness.service.remove('person-1', USER_ID),
    ).resolves.toBeUndefined();
  });
});

describe('Renomear pessoa', () => {
  it('atualiza o nome da pessoa', async () => {
    const harness = buildHarness();

    await harness.service.update('person-1', USER_ID, {
      name: 'Eva Souza',
    } as any);

    expect(harness.updates[0].name).toBe('Eva Souza');
  });

  it('NÃO reescreve os nomes gravados em dívidas e cobranças', async () => {
    /**
     * `creditorName`/`debtorName` são snapshots do momento da criação.
     * Propagar o rename para trás reescreveria histórico textual: um registro
     * criado quando a pessoa se chamava "Eva" passaria a afirmar que sempre
     * disse "Eva Souza".
     *
     * O cabeçalho do drawer usa o nome ATUAL da Person, que é o lugar certo
     * para a informação viva.
     */
    const harness = buildHarness();

    await harness.service.update('person-1', USER_ID, {
      name: 'Eva Souza',
    } as any);

    // Nenhum updateMany em Debt/Receivable: os doubles nem existem.
    expect(harness.prisma.debt).toBeUndefined();
    expect(harness.prisma.receivable).toBeUndefined();
  });

  it('não permite mover a pessoa para outro usuário', async () => {
    // `userId` não está no DTO; espalhar o corpo permitiria injetá-lo.
    const harness = buildHarness();

    await harness.service.update('person-1', USER_ID, {
      name: 'Eva',
      userId: 'outro-usuario',
    } as any);

    expect(harness.updates[0]).not.toHaveProperty('userId');
  });
});
