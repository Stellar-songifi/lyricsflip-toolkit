import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootApp, resetDatabase } from './e2e-app';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await bootApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });
});
