import { BanksRepository } from "@/domain/finance/application/repositories/banks-repository";
import { Bank } from "@/domain/finance/entreprise/entities/bank";

export class inMemoryBankRepository implements BanksRepository {
    public items: Bank[] = []
    
    async create(Bank: Bank) {
        this.items.push(Bank)
    }
    
}