import type { DatabaseDriver } from './interface.js'
import type { QueryResult } from '../lib/types.js'

export class SQLiteAdapter implements DatabaseDriver {
  readonly type = 'sqlite' as const
  private db: unknown = null
  private SQL: unknown = null
  private readonly filepath?: string

  constructor(filepath?: string) {
    this.filepath = filepath
  }

  async connect(): Promise<void> {
    try {
      const initSqlJs = await import('sql.js')
      // sql.js puede exportar como default o como named
      const init = typeof initSqlJs === 'function'
        ? initSqlJs
        : (initSqlJs as { default: unknown }).default
      this.SQL = await (init as () => Promise<unknown>)()
    } catch {
      throw new Error(
        'Driver SQLite no disponible. Instala sql.js: npm install sql.js',
      )
    }

    if (this.filepath) {
      // Leer archivo existente
      const { readFile } = await import('node:fs/promises')
      try {
        const buffer = await readFile(this.filepath)
        this.db = new (this.SQL as { Database: new (data: Uint8Array) => unknown }).Database(
          new Uint8Array(buffer),
        )
      } catch {
        // Archivo no existe, crear nueva DB
        this.db = new (this.SQL as { Database: new () => unknown }).Database()
      }
    } else {
      // In-memory
      this.db = new (this.SQL as { Database: new () => unknown }).Database()
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      // Guardar a archivo si hay filepath
      if (this.filepath) {
        const { writeFile } = await import('node:fs/promises')
        const data = (this.db as { export: () => Uint8Array }).export()
        await writeFile(this.filepath, data)
      }
      ;(this.db as { close: () => void }).close()
      this.db = null
    }
  }

  isConnected(): boolean {
    return this.db !== null
  }

  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.db) {
      throw new Error('No hay conexion SQLite activa')
    }

    const start = performance.now()
    const db = this.db as {
      run: (sql: string, params?: unknown[]) => void
      exec: (sql: string, params?: unknown[]) => Array<{ columns: string[]; values: unknown[][] }>
      getRowsModified: () => number
    }

    try {
      const results = db.exec(sql, params)
      const executionTimeMs = Math.round(performance.now() - start)

      if (results.length === 0) {
        // DML sin resultados (INSERT, UPDATE, DELETE)
        const affected = db.getRowsModified()
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: affected,
          executionTimeMs,
        }
      }

      const result = results[0]
      const rows = result.values.map((row) => {
        const obj: Record<string, unknown> = {}
        result.columns.forEach((col, i) => {
          obj[col] = row[i]
        })
        return obj
      })

      return {
        columns: result.columns,
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
