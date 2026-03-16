declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database
  }

  interface Database {
    run(sql: string, params?: unknown[]): void
    exec(sql: string, params?: unknown[]): QueryExecResult[]
    getRowsModified(): number
    export(): Uint8Array
    close(): void
  }

  interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }

  export default function initSqlJs(): Promise<SqlJsStatic>
}
