import { TransactionType } from '@prisma/client';

export class CreateTransactionDto {
  bankId: string;
  categoryId: string;
  title: string;
  type: TransactionType;
  amount: number;
  description?: string;
  date: string;
  installments?: number;
}
