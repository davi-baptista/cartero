import { Module } from '@nestjs/common';
import { BanksService } from './banks.service';
import { BanksController } from './banks.controller';
import { InvoicesService } from 'src/invoices/invoices.service';

@Module({
  providers: [BanksService, InvoicesService],
  exports: [BanksService],
  controllers: [BanksController],
})
export class BanksModule {}
