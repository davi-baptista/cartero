import { Module } from '@nestjs/common';
import { EntityValidationService } from './entity-validation.service';

@Module({
  providers: [EntityValidationService],
  exports: [EntityValidationService],
})
export class CommonModule {}
