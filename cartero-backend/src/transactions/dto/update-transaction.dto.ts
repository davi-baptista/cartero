import { TransactionType } from '@prisma/client';

export class UpdateTransactionDto {
  bankId?: string;
  categoryId?: string;
  title?: string;
  type?: TransactionType;
  amount?: number;
  description?: string;
  date?: string;
}
