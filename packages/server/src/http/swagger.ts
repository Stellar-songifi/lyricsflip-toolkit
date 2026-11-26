/**
 * Swagger decorators that degrade to no-ops.
 *
 * `@nestjs/swagger` is an optional peer dependency: hosts that serve
 * `/api/docs` get typed routes and schemas, and hosts without it still work.
 * The real decorators are loaded lazily; when the package is missing, every
 * decorator below does nothing.
 */

/** A decorator usable on classes, methods and properties. */
type AnyDecorator = ClassDecorator & MethodDecorator & PropertyDecorator;
type DecoratorFactory = (...args: any[]) => AnyDecorator;

const noop: AnyDecorator = () => undefined;

function loadSwagger(): Record<string, DecoratorFactory> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@nestjs/swagger');
  } catch {
    return null;
  }
}

const swagger = loadSwagger();

function decorator(name: string): DecoratorFactory {
  const real = swagger?.[name];
  return typeof real === 'function' ? (...args: any[]) => real(...args) : () => noop;
}

/** True when `@nestjs/swagger` is installed in the host application. */
export const swaggerAvailable = swagger !== null;

export const ApiTags = decorator('ApiTags');
export const ApiBearerAuth = decorator('ApiBearerAuth');
export const ApiOperation = decorator('ApiOperation');
export const ApiOkResponse = decorator('ApiOkResponse');
export const ApiNotFoundResponse = decorator('ApiNotFoundResponse');
export const ApiBadRequestResponse = decorator('ApiBadRequestResponse');
export const ApiUnauthorizedResponse = decorator('ApiUnauthorizedResponse');
export const ApiConflictResponse = decorator('ApiConflictResponse');
export const ApiParam = decorator('ApiParam');
export const ApiProperty = decorator('ApiProperty');
export const ApiPropertyOptional = decorator('ApiPropertyOptional');
