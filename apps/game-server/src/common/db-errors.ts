/**
 * PostgreSQL reports a unique-constraint violation as SQLSTATE 23505. TypeORM
 * wraps the driver error in a `QueryFailedError`, and which level carries the
 * code has moved between versions, so check both the error and its `driverError`.
 */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(err: unknown): boolean {
  const error = err as { code?: string; driverError?: { code?: string } } | null;
  return (error?.code ?? error?.driverError?.code) === UNIQUE_VIOLATION;
}