import { TransactionsRepository } from "@/domain/finance/application/repositories/transations-repository";
import { Transaction } from "@/domain/finance/entreprise/entities/transaction";

export class inMemoryTransactionRepository implements TransactionsRepository {
    public items: Transaction[] = []
    
    async create(transaction: Transaction) {
        this.items.push(transaction)
    }
    
}