import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [CommonModule],
  providers: [InvoicesService],
  exports: [InvoicesService],
  controllers: [InvoicesController],
})
export class InvoicesModule {}
