import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';
import { mountBetterAuth } from './modules/auth/auth.controller.js';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter.js';

async function bootstrap() {
  // bodyParser: false — Better Auth parses its own routes; JSON parsing is re-enabled below for everything else.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService).getOrThrow<AppConfig>('app');

  app.set('trust proxy', 1); // behind Nginx/ALB: correct client IPs for rate limits
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });

  mountBetterAuth(app); // /api/auth/* — must be before express.json()
  app.use(express.json({ limit: '1mb' }));

  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const ws = new RedisIoAdapter(app);
  await ws.connect(config.redisUrl);
  app.useWebSocketAdapter(ws);

  if (!config.isProd) {
    const doc = new DocumentBuilder()
      .setTitle('Servio API')
      .setVersion('1')
      .addCookieAuth('better-auth.session_token')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, doc),
    );
  }

  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
