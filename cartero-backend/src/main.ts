import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3001',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // Descarta propriedades não declaradas no DTO antes que cheguem aos
      // serviços — vários deles espalham o DTO em operações do Prisma.
      // `forbidNonWhitelisted` fica desligado de propósito: recusar a
      // requisição inteira por um campo extra mudaria o contrato para clientes
      // já publicados. Silenciosamente ignorar o excedente é o suficiente.
      whitelist: true,
    }),
  );

  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
