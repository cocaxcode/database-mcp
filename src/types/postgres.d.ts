declare module 'postgres' {
  interface Sql {
    unsafe(sql: string, params?: unknown[]): Promise<Row[] & { count?: number; columns?: Array<{ name: string }> }>
    end(): Promise<void>
  }

  type Row = Record<string, unknown>

  function postgres(dsn: string): Sql
  function postgres(options: Record<string, unknown>): Sql

  export default postgres
}
