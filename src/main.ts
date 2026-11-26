import 'dotenv/config';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CONFIGURACAO, type Configuracao } from './config/configuracao';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<Configuracao>(CONFIGURACAO);
  if (!config.token) throw new Error('Defina ROBO_TOKEN no .env antes de subir a API');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  await app.listen(config.porta, config.host);
  new Logger('Robo FGTS').log(`API no ar em http://${config.host}:${config.porta}`);
}

bootstrap();
