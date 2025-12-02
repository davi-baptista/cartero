import { UniqueEntityId } from "@/core/entities/unique-entity-id";
import { Optional } from "@/core/types/optional";
import { Entity } from "src/core/entities/entity";

export interface AccountHolderProps {
    name: string
    createdAt: Date
}

export class AccountHolder extends Entity<AccountHolderProps>{
    get name() {
        return this.props.name
    }
    
    static create(props: Optional<AccountHolderProps, 'createdAt'>, id?: UniqueEntityId) {
        const accountHolder = new AccountHolder(
            {
                ...props,
                createdAt: props.createdAt ?? new Date()
            },
            id
        )
        
        return accountHolder
    }
}