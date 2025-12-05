import { Bank } from "../../entreprise/entities/bank";

export interface BanksRepository {
    create(bank: Bank): Promise<void> 
}