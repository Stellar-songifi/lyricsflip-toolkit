import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppConfig, true>);

  const redisUrl = configService.get('redisUrl' as keyof AppConfig, { infer: true }) as string | undefined;
  if (redisUrl) {
    const pubClient = createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    const redisAdapter = createAdapter(pubClient, subClient);
    class RedisIoAdapter extends IoAdapter {
      createIOServer(port: number, options?: Record<string, unknown>) {
        const server = super.createIOServer(port, options);
        server.adapter(redisAdapter);
        return server;
      }
    }
    app.useWebSocketAdapter(new RedisIoAdapter(app));
    logger.log('Socket.IO Redis adapter enabled');
  } else {
    logger.warn('REDIS_URL not set — Socket.IO is using the in-memory adapter (single-instance only)');
  }

  const corsOrigin = configService.get('corsOrigin', { infer: true });
  if (corsOrigin) {
    app.enableCors({
      origin: corsOrigin,
      credentials: true,
    });
  } else {
    logger.warn('CORS is disabled because CORS_ORIGIN is not configured.');
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LyricsFlip API')
    .setDescription('Solo play, rooms, head-to-head wagers and Stellar settlement')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get('port', { infer: true });
  await app.listen(port);
   
  console.log(`LyricsFlip API listening on http://localhost:${port}`);
   
  console.log(`Swagger UI at http://localhost:${port}/api/docs`);
}

bootstrap();
