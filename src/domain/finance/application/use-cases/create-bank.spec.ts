import { UniqueEntityId } from "@/core/entities/unique-entity-id"
import { CreateBankUseCase } from "./create-bank"
import { inMemoryBankRepository } from "test/repositories/in-memory-bank-repository"

let BanksRepository: inMemoryBankRepository
let sut: CreateBankUseCase

describe('Create Bank', () => {
    beforeEach(() => {
        BanksRepository = new inMemoryBankRepository()
        sut = new CreateBankUseCase(BanksRepository)
    })

    it('should be able to create a Bank', async () => {
        const result = await sut.execute({
            accountHolderId: new UniqueEntityId(),
            name: 'any_name',
            creditClosingDay: 7,
            creaditDueDay: 12
        })
        
        expect(result.isRight()).toBe(true)
        expect(BanksRepository.items[0]).toEqual(result.value?.bank)
    })
})