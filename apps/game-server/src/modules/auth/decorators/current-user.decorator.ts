import { ExecutionContext, createParamDecorator } from '@nestjs/common';

/** The signed-in user's id, from the JWT validated by `JwtAuthGuard`. */
export const CurrentUserId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest().user.userId;
});
