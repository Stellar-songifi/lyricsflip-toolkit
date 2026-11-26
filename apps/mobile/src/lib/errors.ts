import * as Sentry from '@sentry/react-native';

/** Report a handled error (including ApiError) to the crash-reporting SDK. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
