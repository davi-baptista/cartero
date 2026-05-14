import { Module } from '@nestjs/common';
import { DebtsService } from './debts.service';
import { DebtsController } from './debts.controller';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [CommonModule],
  providers: [DebtsService],
  exports: [DebtsService],
  controllers: [DebtsController],
})
export class DebtsModule {}
