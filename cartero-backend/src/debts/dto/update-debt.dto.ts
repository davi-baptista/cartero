export class UpdateDebtDto {
  bankId?: string;
  title?: string;
  creditorName?: string;
  amount?: number;
  description?: string;
  dueDate?: string;
  isAlertEnabled?: boolean;
  isPaid?: boolean;
  categoryId?: string;
}
