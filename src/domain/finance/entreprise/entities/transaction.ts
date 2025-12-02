import { Optional } from "@/core/types/optional";
import { Entity } from "src/core/entities/entity";
import { UniqueEntityId } from "src/core/entities/unique-entity-id";

export interface TransactionProps {
    accountHolderId: UniqueEntityId
    bankId: UniqueEntityId
    type: 'EXPENSE' | 'INCOME'
    isPaymentInCredit: boolean
    createdAt: Date
}

export class Transaction extends Entity<TransactionProps>{
    get accountHolderId() {
        return this.props.accountHolderId
    }
    
    get bankId() {
        return this.props.bankId
    }
    
    get type() {
        return this.props.type
    }
    
    get isPaymentInCredit() {
        return this.props.isPaymentInCredit
    }

    static create(props: Optional<TransactionProps, 'createdAt'>, id?: UniqueEntityId) {
        const transaction = new Transaction(
            {
                ...props,
                createdAt: props.createdAt ?? new Date()
            },
            id
        )
        return transaction
    }
}