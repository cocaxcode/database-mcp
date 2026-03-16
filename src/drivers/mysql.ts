import type { DatabaseDriver } from './interface.js'
import type { QueryResult } from '../lib/types.js'

export class MySQLAdapter implements DatabaseDriver {
  readonly type = 'mysql' as const
  private connection: unknown = null
  private readonly dsn?: string
  private readonly config?: {
    host: string
    port: number
    database: string
    user: string
    password: string
  }

  constructor(options: { dsn?: string; host?: string; port?: number; database?: string; user?: string; password?: string }) {
    this.dsn = options.dsn
    if (!options.dsn && options.host) {
      this.config = {
        host: options.host,
        port: options.port ?? 3306,
        database: options.database ?? '',
        user: options.user ?? 'root',
        password: options.password ?? '',
      }
    }
  }

  async connect(): Promise<void> {
    let mysql2: unknown
    try {
      mysql2 = await import('mysql2/promise')
    } catch {
      throw new Error(
        'Driver MySQL no disponible. Instala mysql2: npm install mysql2',
      )
    }

    const m = mysql2 as { createConnection: (config: unknown) => Promise<unknown> }

    if (this.dsn) {
      this.connection = await m.createConnection(this.dsn)
    } else if (this.config) {
      this.connection = await m.createConnection(this.config)
    } else {
      throw new Error('MySQL requiere DSN o campos de conexion (host, database, user)')
    }

    // Test connection — close if test fails to prevent leak
    try {
      await (this.connection as { execute: (sql: string) => Promise<unknown> }).execute('SELECT 1')
    } catch (e) {
      await (this.connection as { end: () => Promise<void> }).end().catch(() => {})
      this.connection = null
      throw e
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await (this.connection as { end: () => Promise<void> }).end()
      this.connection = null
    }
  }

  isConnected(): boolean {
    return this.connection !== null
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.connection) {
      throw new Error('No hay conexion MySQL activa')
    }

    const start = performance.now()
    const conn = this.connection as {
      execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>
    }

    try {
      const [result, fields] = await conn.execute(sql, params)
      const executionTimeMs = Math.round(performance.now() - start)

      // DML sin resultados
      if (!Array.isArray(result)) {
        const dmlResult = result as { affectedRows?: number }
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: dmlResult.affectedRows,
          executionTimeMs,
        }
      }

      const rows = result as Record<string, unknown>[]
      const fieldDefs = fields as Array<{ name: string }>
      const columns = fieldDefs?.map((f) => f.name) ?? (rows.length > 0 ? Object.keys(rows[0]) : [])

      return {
        columns,
        rows,
        rowCount: rows.length,
        executionTimeMs,
      }
    } catch (error) {
      const executionTimeMs = Math.round(performance.now() - start)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Error SQL (${executionTimeMs}ms): ${message}`)
    }
  }
}
