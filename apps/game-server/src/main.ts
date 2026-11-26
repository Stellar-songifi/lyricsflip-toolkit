import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { join } from 'path';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

/**
 * Builds the OpenAPI document for the given Nest application.
 *
 * This is exported so that both `bootstrap()` and the OpenAPI export script
 * (which writes the committed `openapi.json` consumed by the mobile client's
 * generated types) construct the document in exactly the same way. This
 * guarantees the committed spec matches what the running server serves at
 * `/api/docs-json`.
 */
export function buildOpenApiDocument(app: INestApplication) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('LyricsFlip API')
    .setDescription('Solo play, rooms, head-to-head wagers and Stellar settlement')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, swaggerConfig);
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve .well-known/ files for iOS Universal Links (apple-app-site-association)
  // and Android App Links (assetlinks.json) verification by platform crawlers.
  app.useStaticAssets(join(__dirname, '..', 'public'));
  const app = await NestFactory.create(AppModule, { bodyParser: false });
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

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document);
  const isProduction = process.env.NODE_ENV === 'production';
  const swaggerEnabled =
    process.env.SWAGGER_ENABLED !== undefined
      ? process.env.SWAGGER_ENABLED === 'true'
      : !isProduction;

  if (swaggerEnabled) {
    const swaggerUser = process.env.SWAGGER_USER;
    const swaggerPassword = process.env.SWAGGER_PASSWORD;

    if (isProduction && swaggerUser && swaggerPassword) {
      const expected = `Basic ${Buffer.from(`${swaggerUser}:${swaggerPassword}`).toString('base64')}`;
      app.use('/api/docs', (req: any, res: any, next: () => void) => {
        if (req.headers.authorization === expected) {
          return next();
        }
        res.setHeader('WWW-Authenticate', 'Basic realm="Swagger"');
        res.status(401).send('Unauthorized');
      });
    } else if (isProduction) {
      logger.warn(
        'Swagger is enabled in production without SWAGGER_USER/SWAGGER_PASSWORD basic auth protection.',
      );
    }

    const swaggerConfig = new DocumentBuilder()
      .setTitle('LyricsFlip API')
      .setDescription('Solo play, rooms, head-to-head wagers and Stellar settlement')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Enable NestJS shutdown lifecycle hooks so OnModuleDestroy is called on
  // SIGTERM/SIGINT (required for WagerReconcilerService and Sep10CleanupService
  // to clear their setInterval timers during graceful shutdown).
  app.enableShutdownHooks();

  const port = configService.get('port', { infer: true });
  await app.listen(port);

  console.log(`LyricsFlip API listening on http://localhost:${port}`);

  console.log(`Swagger UI at http://localhost:${port}/api/docs`);
   
  if (swaggerEnabled) {
    console.log(`Swagger UI at http://localhost:${port}/api/docs`);
  }
}

bootstrap();