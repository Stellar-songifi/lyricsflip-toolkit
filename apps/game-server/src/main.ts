import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

/**
 * Socket.IO adapter that applies the same CORS policy as the HTTP API.
 *
 * Native app clients send no `Origin` header, so those handshakes are allowed.
 * Browser handshakes are only accepted when the origin matches `CORS_ORIGIN`.
 */
class CorsIoAdapter extends IoAdapter {
  constructor(
    app: Parameters<typeof IoAdapter>[0],
    private readonly corsOrigin: string | string[] | undefined,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const allowedOrigins = this.corsOrigin
      ? Array.isArray(this.corsOrigin)
        ? this.corsOrigin
        : [this.corsOrigin]
      : [];

    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
          // Native app clients do not send an Origin header.
          if (!origin) {
            return callback(null, true);
          }
          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
        },
        credentials: true,
      },
    });
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService<AppConfig, true>);

  const nodeEnv = configService.get('nodeEnv', { infer: true });
  const isProduction = nodeEnv === 'production';

  const trustProxy = configService.get('trustProxy', { infer: true });
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      },
      hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );

  const bodyLimit = '64kb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  const corsOrigin = configService.get('corsOrigin', { infer: true });
  if (corsOrigin) {
    app.enableCors({
      origin: corsOrigin,
      credentials: true,
    });
  } else {
    logger.warn('CORS is disabled because CORS_ORIGIN is not configured.');
  }

  app.useWebSocketAdapter(new CorsIoAdapter(app, corsOrigin));

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
