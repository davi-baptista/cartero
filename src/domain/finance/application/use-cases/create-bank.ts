import { UniqueEntityId } from "src/core/entities/unique-entity-id";
import { BanksRepository } from "../repositories/banks-repository";
import { Either, right } from "@/core/either";
import { Bank } from "../../entreprise/entities/bank";

interface CreateBankUseCaseRequest {
    accountHolderId: UniqueEntityId
    name: string
    creditClosingDay?: number
    creaditDueDay?: number
}

type CreateBankUseCaseResponse = Either<
    null,
    {
        bank: Bank
    }
>

export class CreateBankUseCase {
    constructor(private banksRepository: BanksRepository) {}

    async execute({ accountHolderId, name, creditClosingDay, creaditDueDay }: CreateBankUseCaseRequest): Promise<CreateBankUseCaseResponse> {
        const bank = Bank.create({ accountHolderId, name, creditClosingDay, creaditDueDay })
        
        await this.banksRepository.create(bank)
        
        return right({ bank })
    }
}