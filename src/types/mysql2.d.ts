declare module 'mysql2/promise' {
  interface Connection {
    execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]>
    end(): Promise<void>
  }

  function createConnection(config: unknown): Promise<Connection>

  export { createConnection, Connection }
}
