import { Optional } from "@/core/types/optional";
import { Entity } from "src/core/entities/entity";
import { UniqueEntityId } from "src/core/entities/unique-entity-id";

export interface BankProps {
    accountHolderId: UniqueEntityId
    name: string
    creditClosingDay?: number
    creaditDueDay?: number
    createdAt: Date
}

export class Bank extends Entity<BankProps>{
    get accountHolderId() {
        return this.props.accountHolderId
    }

    get name() {
        return this.props.name
    }

    get creditClosingDay() {
        return this.props.creditClosingDay
    }

    get creaditDueDay() {
        return this.props.creaditDueDay
    }

    get createdAt() {
        return this.props.createdAt
    }
    
    static create(props: Optional<BankProps, 'createdAt'>, id?: UniqueEntityId) {
        const bank = new Bank(
            {
                ...props,
                createdAt: props.createdAt ?? new Date()
            },
            id
        )
        
        return bank
    }
}