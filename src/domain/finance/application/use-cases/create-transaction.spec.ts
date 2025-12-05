import { inMemoryTransactionRepository } from "test/repositories/in-memory-transaction-repository"
import { CreateTransactionUseCase } from "./create-transaction"
import { UniqueEntityId } from "@/core/entities/unique-entity-id"

let transactionsRepository: inMemoryTransactionRepository
let sut: CreateTransactionUseCase

describe('Create Transaction', () => {
    beforeEach(() => {
        transactionsRepository = new inMemoryTransactionRepository()
        sut = new CreateTransactionUseCase(transactionsRepository)
    })

    it('should be able to create a transaction', async () => {
        const result = await sut.execute({
            accountHolderId: new UniqueEntityId(),
            bankId: new UniqueEntityId(),
            type: 'EXPENSE',
            isPaymentInCredit: false,
            ocurredAt: new Date()
        })
        
        expect(result.isRight()).toBe(true)
        expect(transactionsRepository.items[0]).toEqual(result.value?.transaction)
    })
})