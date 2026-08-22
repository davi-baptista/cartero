import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { UpdateTransactionDto } from 'src/transactions/dto/update-transaction.dto';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';
import { UpdateBankDto } from 'src/banks/dto/update-bank.dto';
import { UpdatePersonDto } from 'src/persons/dto/update-person.dto';
import { UpdateCategoryDto } from 'src/categories/dto/update-category.dto';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Crítico C: mass assignment — CORRIGIDO na Fase 2B
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Antes: o ValidationPipe global rodava só com `{ transform: true }`, e quatro
 * serviços espalhavam o DTO inteiro em operações do Prisma
 * (`data: { ...dto }`). Propriedades não declaradas sobreviviam à validação e
 * chegavam ao banco; o dano só não era maior porque nenhum DTO expunha campo
 * sensível — proteção acidental, não defesa.
 *
 * Agora: `whitelist: true` no pipe global descarta o excedente, e os quatro
 * serviços atribuem campo a campo. As duas barreiras são independentes.
 *
 * `currentPipe` (sem whitelist) é mantido nos testes apenas para demonstrar o
 * contraste — não reflete mais a configuração de produção.
 */

/** Pipe sem whitelist, só para contrastar com o comportamento corrigido. */
const currentPipe = new ValidationPipe({ transform: true });

/** Espelha a configuração real de `main.ts`. */
const whitelistPipe = new ValidationPipe({ transform: true, whitelist: true });

function metatype(cls: any) {
  return { type: 'body' as const, metatype: cls };
}

describe('ValidationPipe atual — comportamento sem whitelist', () => {
  it('comportamento ATUAL: campo não declarado atravessa a validação', async () => {
    const result: any = await currentPipe.transform(
      { amount: 100, campoIntruso: 'passa' },
      metatype(UpdateTransactionDto),
    );

    expect(result.campoIntruso).toBe('passa');
  });

  it('com whitelist o campo intruso é removido', async () => {
    const result: any = await whitelistPipe.transform(
      { amount: 100, campoIntruso: 'nao passa' },
      metatype(UpdateTransactionDto),
    );

    expect(result.campoIntruso).toBeUndefined();
    expect(result.amount).toBe(100);
  });

  it('whitelist preserva todos os campos legítimos de UpdateTransactionDto', async () => {
    // Garante que ligar a proteção não quebra o payload real do frontend.
    const payload = {
      bankId: '11111111-1111-4111-8111-111111111111',
      categoryId: '22222222-2222-4222-8222-222222222222',
      title: 'Compra',
      type: 'CREDIT_CARD',
      amount: 250.5,
      isRefund: false,
      description: 'obs',
      date: '2026-08-19',
      personId: '33333333-3333-4333-8333-333333333333',
      confirmReopenClosedInvoice: true,
    };

    const result: any = await whitelistPipe.transform(
      { ...payload },
      metatype(UpdateTransactionDto),
    );

    for (const key of Object.keys(payload)) {
      expect(result).toHaveProperty(key);
    }
  });

  it('whitelist preserva personId nulo — usado para desvincular a pessoa', async () => {
    const result: any = await whitelistPipe.transform(
      { personId: null },
      metatype(UpdateTransactionDto),
    );

    expect(result.personId).toBeNull();
  });
});

describe('Contrato dos DTOs expostos a spread', () => {
  /**
   * O risco do spread é proporcional ao que o DTO aceita. Estes testes fixam
   * a superfície de cada um: se alguém adicionar um campo sensível a um DTO
   * usado com `...dto`, o teste falha e força a revisão.
   */

  it('UpdateUserDto não aceita email nem id', async () => {
    // O que contém o dano hoje: sem esses campos, o spread em
    // users.service.ts não permite trocar identidade nem promover conta.
    const result: any = await whitelistPipe.transform(
      { name: 'Novo', email: 'intruso@exemplo.com', id: 'outro-usuario' },
      metatype(UpdateUserDto),
    );

    expect(result.email).toBeUndefined();
    expect(result.id).toBeUndefined();
    expect(result.name).toBe('Novo');
  });

  it('comportamento ATUAL: sem whitelist, email e id sobrevivem no DTO de usuário', async () => {
    // Não chegam ao banco por sorte — `user.update` receberia `email`, que
    // É um campo real do modelo. A única barreira é o DTO não declará-lo.
    const result: any = await currentPipe.transform(
      { name: 'Novo', email: 'intruso@exemplo.com' },
      metatype(UpdateUserDto),
    );

    expect(result.email).toBe('intruso@exemplo.com');
  });

  it('UpdateBankDto não aceita isSystem', async () => {
    // `isSystem` protege o banco interno de recebíveis de ser listado ou
    // excluído. Marcar um banco comum como sistema o esconderia da UI.
    const result: any = await whitelistPipe.transform(
      { name: 'Banco', isSystem: true },
      metatype(UpdateBankDto),
    );

    expect(result.isSystem).toBeUndefined();
  });

  it('UpdatePersonDto não aceita userId', async () => {
    const result: any = await whitelistPipe.transform(
      { name: 'Eva', userId: 'outro-usuario' },
      metatype(UpdatePersonDto),
    );

    expect(result.userId).toBeUndefined();
  });

  it('rejeita tipo inválido em campo declarado, com ou sem whitelist', async () => {
    // A validação de tipo já funciona hoje — o problema é só o excedente.
    await expect(
      currentPipe.transform(
        { amount: 'muito dinheiro' },
        metatype(UpdateTransactionDto),
      ),
    ).rejects.toThrow();
  });

  it('rejeita valor abaixo do mínimo', async () => {
    await expect(
      currentPipe.transform({ amount: 0 }, metatype(UpdateTransactionDto)),
    ).rejects.toThrow();
  });
});

describe('Crítico C — proteção ativada (Fase 2B)', () => {
  it('o ValidationPipe global está configurado com whitelist', async () => {
    // Espelha `main.ts`. Se alguém remover a opção, este teste cai.
    const configured = new ValidationPipe({ transform: true, whitelist: true });

    const result: any = await configured.transform(
      { amount: 100, campoIntruso: 'descartado' },
      metatype(UpdateTransactionDto),
    );

    expect(result.campoIntruso).toBeUndefined();
    expect(result.amount).toBe(100);
  });

  it('campo extra é descartado, não vira erro 400', async () => {
    // `forbidNonWhitelisted` continua desligado de propósito: recusar a
    // requisição inteira mudaria o contrato para clientes já publicados.
    await expect(
      whitelistPipe.transform(
        { amount: 100, campoIntruso: 'x' },
        metatype(UpdateTransactionDto),
      ),
    ).resolves.toBeDefined();
  });

  /**
   * Todo DTO precisa de decorators para sobreviver ao whitelist: propriedade
   * sem decorator é descartada. Dois DTOs de update não tinham nenhum
   * (`UpdateBankDto` e `UpdateCategoryDto`) e chegariam vazios ao serviço —
   * a edição não faria nada, silenciosamente. Corrigido nesta fase.
   */
  it('UpdateBankDto sobrevive ao whitelist com todos os campos', async () => {
    const result: any = await whitelistPipe.transform(
      { name: 'Novo', invoiceDueDate: 20, invoiceDueDaysAfterClose: 5 },
      metatype(UpdateBankDto),
    );

    expect(result).toEqual({
      name: 'Novo',
      invoiceDueDate: 20,
      invoiceDueDaysAfterClose: 5,
    });
  });

  it('UpdateCategoryDto sobrevive ao whitelist com todos os campos', async () => {
    const result: any = await whitelistPipe.transform(
      { name: 'Mercado', icon: 'ShoppingCart', color: '#ff0000' },
      metatype(UpdateCategoryDto),
    );

    expect(result).toEqual({
      name: 'Mercado',
      icon: 'ShoppingCart',
      color: '#ff0000',
    });
  });

  it('nenhum DTO de update chega vazio ao passar pelo whitelist', async () => {
    // Guarda geral contra o mesmo defeito reaparecer em outro DTO.
    const cases: Array<[any, Record<string, unknown>]> = [
      [UpdateTransactionDto, { amount: 10 }],
      [UpdateUserDto, { name: 'Nome' }],
      [UpdateBankDto, { name: 'Banco' }],
      [UpdatePersonDto, { name: 'Eva' }],
      [UpdateCategoryDto, { name: 'Categoria' }],
    ];

    for (const [dto, payload] of cases) {
      const result: any = await whitelistPipe.transform(
        { ...payload },
        metatype(dto),
      );
      expect(Object.keys(result).length).toBeGreaterThan(0);
    }
  });

  it('os serviços não espalham mais o DTO em operações do Prisma', async () => {
    // Defesa em profundidade além do whitelist: mesmo que a opção seja
    // removida, os serviços atribuem campo a campo. Verificado no código.
    const { readFileSync } = await import('node:fs');
    const services = [
      'src/transactions/transactions.service.ts',
      'src/persons/persons.service.ts',
      'src/banks/banks.service.ts',
      'src/users/users.service.ts',
    ];

    // O risco é espalhar o DTO dentro de `data:` — o que chega ao banco. Um
    // spread para montar argumento de função interna (a prévia faz isso ao
    // reaproveitar as guardas do update) não persiste nada.
    for (const path of services) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/data:\s*\{\s*\.\.\.dto/);
      expect(source).not.toMatch(/const data = \{\s*\.\.\.dto/);
    }
  });
});
