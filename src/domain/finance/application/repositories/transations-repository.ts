import { Transaction } from "../../entreprise/entities/transaction";

export interface TransactionsRepository {
    create(transaction: Transaction): Promise<void>
}