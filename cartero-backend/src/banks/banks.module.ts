import { Module } from '@nestjs/common';
import { BanksService } from './banks.service';
import { BanksController } from './banks.controller';
import { InvoicesService } from 'src/invoices/invoices.service';
import { CommonModule } from 'src/common/common.module';

@Module({
  imports: [CommonModule],
  providers: [BanksService, InvoicesService],
  exports: [BanksService],
  controllers: [BanksController],
})
export class BanksModule {}
