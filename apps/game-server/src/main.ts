import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
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

  const port = configService.get('port', { infer: true });
  await app.listen(port);
   
  console.log(`LyricsFlip API listening on http://localhost:${port}`);
   
  if (swaggerEnabled) {
    console.log(`Swagger UI at http://localhost:${port}/api/docs`);
  }
}

bootstrap();
