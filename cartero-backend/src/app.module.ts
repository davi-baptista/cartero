import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './env/env';
import { EnvModule } from './env/env.module';
import { UsersModule } from './users/users.module';
import { BanksModule } from './banks/banks.module';
import { CategoriesModule } from './categories/categories.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AppScheduler } from './app.scheduler';
import { InvoicesModule } from './invoices/invoices.module';
import { DebtsModule } from './debts/debts.module';
import { ReceivablesModule } from './receivables/receivables.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => envSchema.parse(env),
    }),
    PrismaModule,
    EnvModule,
    AuthModule,
    UsersModule,
    BanksModule,
    CategoriesModule,
    TransactionsModule,
    InvoicesModule,
    DebtsModule,
    ReceivablesModule,
    ScheduleModule.forRoot(),
  ],
  providers: [AppScheduler],
})
export class AppModule {}
