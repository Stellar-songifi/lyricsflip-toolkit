import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve .well-known/ files for iOS Universal Links (apple-app-site-association)
  // and Android App Links (assetlinks.json) verification by platform crawlers.
  app.useStaticAssets(join(__dirname, '..', 'public'));
  const configService = app.get(ConfigService<AppConfig, true>);

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

  // Enable NestJS shutdown lifecycle hooks so OnModuleDestroy is called on
  // SIGTERM/SIGINT (required for WagerReconcilerService and Sep10CleanupService
  // to clear their setInterval timers during graceful shutdown).
  app.enableShutdownHooks();

  const port = configService.get('port', { infer: true });
  await app.listen(port);
   
  console.log(`LyricsFlip API listening on http://localhost:${port}`);
   
  console.log(`Swagger UI at http://localhost:${port}/api/docs`);
}

bootstrap();
