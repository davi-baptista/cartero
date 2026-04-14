export class CreateDebtDto {
  title: string;
  creditorName: string;
  amount: number;
  description?: string;
  dueDate?: string;
  isAlertEnabled: boolean;
  isPaid?: boolean;
}
