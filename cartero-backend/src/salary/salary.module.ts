import { Module } from '@nestjs/common';
import { SalaryController } from './salary.controller';
import { SalaryService } from './salary.service';

/**
 * `PrismaModule` é `@Global()`, então `PrismaService` já está disponível —
 * não há import a declarar aqui.
 */
@Module({
  controllers: [SalaryController],
  providers: [SalaryService],
  // Exportado porque o Budget resolve a renda do mês selecionado.
  exports: [SalaryService],
})
export class SalaryModule {}
