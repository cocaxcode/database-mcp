// ── Connection ──

export type ConnectionType = 'postgresql' | 'mysql' | 'sqlite'
export type ConnectionMode = 'read-only' | 'read-write'

export interface Connection {
  name: string
  type: ConnectionType
  mode: ConnectionMode
  /** DSN string (ej: postgresql://user:pass@host:5432/db) */
  dsn?: string
  /** Campos individuales (alternativa a DSN) */
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  /** Ruta al archivo SQLite */
  filepath?: string
  createdAt: string
  updatedAt: string
}

export interface ConnectionListItem {
  name: string
  type: ConnectionType
  mode: ConnectionMode
  active: boolean
  database?: string
}

// ── Schema ──

export type DetailLevel = 'names' | 'summary' | 'full'

export interface TableInfo {
  name: string
  schema?: string
  type?: 'table' | 'view'
  rowCount?: number
  columns?: ColumnInfo[]
  foreignKeys?: ForeignKeyInfo[]
  indexes?: IndexInfo[]
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
  isPrimaryKey: boolean
}

export interface ForeignKeyInfo {
  column: string
  referencedTable: string
  referencedColumn: string
  constraintName?: string
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
}

// ── Query ──

export type SqlType = 'read' | 'write' | 'ddl'

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows?: number
  executionTimeMs: number
}

export interface ColumnMeta {
  name: string
  type?: string
}

// ── Rollback ──

export interface RollbackSnapshot {
  id: string
  sql: string
  params?: unknown[]
  connection: string
  type: 'insert' | 'update' | 'delete' | 'ddl'
  table?: string
  affectedRows?: Record<string, unknown>[]
  insertedIds?: unknown[]
  timestamp: string
}

// ── History ──

export interface HistoryEntry {
  id: number
  sql: string
  params?: unknown[]
  type: SqlType | 'explain'
  connection: string
  timestamp: string
  executionTimeMs: number
  rowCount?: number
  affectedRows?: number
  success: boolean
  error?: string
}
