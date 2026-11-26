import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { swaggerAvailable } from '../src/http/swagger';
import { Harness, createHarness } from './harness';

/** Every toolkit route is documented with request and response schemas (#67). */
describe('Swagger documentation', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('documents every toolkit route with tags, auth and a response schema', () => {
    expect(swaggerAvailable).toBe(true);
    const doc = SwaggerModule.createDocument(h.app, new DocumentBuilder().addBearerAuth().build());

    const expected: Array<[string, string]> = [
      ['/wagers', 'get'],
      ['/wagers/{id}', 'get'],
      ['/wagers/{id}/accept', 'post'],
      ['/wagers/{id}/decline', 'post'],
      ['/wagers/{id}/cancel', 'post'],
      ['/wagers/{id}/stake-transaction', 'post'],
      ['/wagers/{id}/stake', 'post'],
      ['/wallet', 'get'],
      ['/wallet/challenge', 'post'],
      ['/wallet/verify', 'post'],
      ['/wager/resolver-address', 'get'],
    ];
    for (const [path, method] of expected) {
      const op = (doc.paths[path] as Record<string, any> | undefined)?.[method];
      expect(op).toBeDefined();
      expect(op.tags?.length).toBeGreaterThan(0);
      expect(op.security).toEqual(expect.arrayContaining([{ bearer: [] }]));
      const ok = op.responses?.['200'] ?? op.responses?.['201'];
      expect(ok?.content?.['application/json']?.schema).toBeDefined();
    }

    const schemas = doc.components?.schemas ?? {};
    for (const name of ['WagerDto', 'UnsignedStakeDto', 'StakeTransactionDto', 'Sep10ChallengeDto', 'SubmitStakeDto', 'WalletVerifyDto']) {
      expect(schemas[name]).toBeDefined();
    }
    expect((doc.paths['/wallet/verify'] as any).post.requestBody).toBeDefined();
  });
});
