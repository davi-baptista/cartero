import { UniqueEntityId } from "src/core/entities/unique-entity-id";
import { TransactionsRepository } from "../repositories/transations-repository";
import { Either, left, right } from "@/core/either";
import { Transaction } from "../../entreprise/entities/transaction";

interface CreateTransactionUseCaseRequest {
    accountHolderId: UniqueEntityId
    bankId: UniqueEntityId
    type: "EXPENSE" | "INCOME"
    isPaymentInCredit: boolean
}

type CreateTransactionUseCaseResponse = Either<
    null,
    {
        transaction: Transaction
    }
>

export class CreateTransactionUseCase {
    constructor(private transactionsRepository: TransactionsRepository) {}

    async execute({ accountHolderId, bankId, type, isPaymentInCredit }: CreateTransactionUseCaseRequest): Promise<CreateTransactionUseCaseResponse> {
        const transaction = Transaction.create({ accountHolderId, bankId, type, isPaymentInCredit})
        
        await this.transactionsRepository.create(transaction)
        
        return right({ transaction})
    }
}