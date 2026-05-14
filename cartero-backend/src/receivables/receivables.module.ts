import { Module } from '@nestjs/common';
import { CommonModule } from 'src/common/common.module';
import { ReceivablesService } from './receivables.service';
import { ReceivablesController } from './receivables.controller';

@Module({
  imports: [CommonModule],
  providers: [ReceivablesService],
  exports: [ReceivablesService],
  controllers: [ReceivablesController],
})
export class ReceivablesModule {}
