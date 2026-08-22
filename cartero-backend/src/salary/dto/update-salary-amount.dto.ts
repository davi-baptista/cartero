import { IsNumber, Min } from 'class-validator';

/**
 * Corrige o valor de uma competência já cadastrada.
 *
 * Só o `amount` viaja no corpo: a competência vem da URL e é imutável nesta
 * operação. Aceitar `year`/`month` aqui permitiria transformar janeiro em
 * fevereiro por edição — outra intenção, com outro efeito sobre a herança.
 *
 * As mesmas regras do upsert: zero é renda legítima (alguém entre empregos),
 * diferente de não haver registro.
 */
export class UpdateSalaryAmountDto {
  @IsNumber()
  @Min(0)
  amount: number;
}
