import type { DatabaseDriver } from './interface.js'
import type { QueryResult } from '../lib/types.js'

export class PostgresAdapter implements DatabaseDriver {
  readonly type = 'postgresql' as const
  private sql: unknown = null
  private connected = false
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
        port: options.port ?? 5432,
        database: options.database ?? 'postgres',
        user: options.user ?? 'postgres',
        password: options.password ?? '',
      }
    }
  }

  async connect(): Promise<void> {
    let postgres: unknown
    try {
      postgres = await import('postgres')
    } catch {
      throw new Error(
        'Driver PostgreSQL no disponible. Instala postgres: npm install postgres',
      )
    }

    const pgFn = typeof postgres === 'function'
      ? postgres
      : (postgres as { default: unknown }).default

    if (this.dsn) {
      this.sql = (pgFn as (dsn: string) => unknown)(this.dsn)
    } else if (this.config) {
      this.sql = (pgFn as (options: object) => unknown)({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        username: this.config.user,
        password: this.config.password,
      })
    } else {
      throw new Error('PostgreSQL requiere DSN o campos de conexion (host, database, user)')
    }

    // Test connection
    await (this.sql as { unsafe: (sql: string) => Promise<unknown> }).unsafe('SELECT 1')
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.sql) {
      await (this.sql as { end: () => Promise<void> }).end()
      this.sql = null
      this.connected = false
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.sql) {
      throw new Error('No hay conexion PostgreSQL activa')
    }

    const start = performance.now()
    const pg = this.sql as {
      unsafe: (sql: string, params?: unknown[]) => Promise<unknown[] & { count?: number; columns?: Array<{ name: string }> }>
    }

    try {
      const result = await pg.unsafe(sql, params)
      const executionTimeMs = Math.round(performance.now() - start)

      const rows = Array.isArray(result) ? result as Record<string, unknown>[] : []
      const columns = rows.length > 0 ? Object.keys(rows[0]) : (result.columns?.map((c) => c.name) ?? [])

      return {
        columns,
        rows,
        rowCount: rows.length,
        affectedRows: result.count,
        executionTimeMs,
      }
    } catch (error) {
      const executionTimeMs = Math.round(performance.now() - start)
      const message = error instanceof Error ? error.message : String(error)
      // Detect connection-level errors and mark as disconnected
      if (message.includes('CONNECTION') || message.includes('connection') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
        this.connected = false
      }
      throw new Error(`Error SQL (${executionTimeMs}ms): ${message}`)
    }
  }
}
