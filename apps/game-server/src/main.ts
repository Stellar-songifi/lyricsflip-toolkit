import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppConfig, true>);

  // Registered before `listen()` so cross-origin requests from the frontend
  // are never rejected — see README.md#known-gaps for the bug this avoids.
  app.enableCors({
    origin: configService.get('frontendUrl', { infer: true }),
    credentials: true,
  });

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
