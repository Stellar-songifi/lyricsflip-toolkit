import configuration from './configuration';

export interface DatabaseConnectionOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/** Build the connection options shared by TypeORM's CLI entrypoint. */
export function databaseConnectionOptions(): DatabaseConnectionOptions {
  const database = configuration().database.primary;
  return {
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.name,
  };
}
