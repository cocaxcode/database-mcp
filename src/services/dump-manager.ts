import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseDriver } from '../drivers/interface.js'
import { SchemaIntrospector } from './schema-introspector.js'
import type { TableInfo, ColumnInfo } from '../lib/types.js'
import { escapeValue, quoteIdentifier, assertSafeIdentifier } from '../utils/sql-escape.js'
import { assertSafePath } from '../utils/path-guard.js'

export interface DumpOptions {
  /** Incluir estructura (CREATE TABLE, indices, FKs) */
  includeSchema: boolean
  /** Incluir datos (INSERT statements) */
  includeData: boolean
  /** Todas las tablas o solo las especificadas */
  tables?: string[]
  /** Schema (para PostgreSQL, default: public) */
  schema?: string
}

export interface DumpResult {
  filename: string
  filepath: string
  tables: number
  totalRows: number
  sizeBytes: number
}

/** Max rows per table in data dump to prevent OOM */
const MAX_DUMP_ROWS = 500_000

export class DumpManager {
  private readonly dumpDir: string

  constructor(projectDir: string) {
    this.dumpDir = join(projectDir, '.database-mcp', 'dumps')
  }

  /**
   * Genera un dump SQL de la base de datos.
   */
  async dump(driver: DatabaseDriver, connName: string, options: DumpOptions): Promise<DumpResult> {
    await mkdir(this.dumpDir, { recursive: true })

    // Obtener tablas con esquema completo
    const allTables = await SchemaIntrospector.getTables(driver, {
      schema: options.schema,
      objectType: 'table',
      detailLevel: 'full',
    })

    // Filtrar tablas si se especificaron
    const tables = options.tables
      ? allTables.filter((t) => options.tables!.includes(t.name))
      : allTables

    if (tables.length === 0) {
      throw new Error('No se encontraron tablas para exportar')
    }

    // Generar SQL
    const parts: string[] = []
    let totalRows = 0

    parts.push(buildHeader(driver.type, connName, options))

    // Desactivar foreign keys al inicio
    parts.push(buildDisableFKs(driver.type))

    for (const table of tables) {
      // CREATE TABLE (DDL)
      if (options.includeSchema) {
        const ddl = await buildCreateTable(driver, table)
        parts.push(ddl)
      }

      // INSERT statements
      if (options.includeData) {
        const { sql, rowCount } = await buildInserts(driver, table)
        if (sql) parts.push(sql)
        totalRows += rowCount
      }
    }

    // Reactivar foreign keys
    parts.push(buildEnableFKs(driver.type))

    parts.push(buildFooter())

    const content = parts.join('\n\n')

    // Nombre: {conn}-{timestamp}-{mode}.sql
    const mode = options.includeSchema && options.includeData
      ? 'full'
      : options.includeData
        ? 'data'
        : 'schema'
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const safeName = connName.replace(/[^a-zA-Z0-9_-]/g, '_')
    const filename = `${safeName}-${ts}-${mode}.sql`
    const filepath = join(this.dumpDir, filename)

    await writeFile(filepath, content, 'utf-8')

    return {
      filename,
      filepath,
      tables: tables.length,
      totalRows,
      sizeBytes: Buffer.byteLength(content, 'utf-8'),
    }
  }

  /**
   * Restaura un dump SQL en la base de datos.
   */
  async restore(driver: DatabaseDriver, filename: string): Promise<{ statements: number; errors: string[] }> {
    // Path traversal protection
    const filepath = assertSafePath(this.dumpDir, filename)
    const content = await readFile(filepath, 'utf-8')

    const statements = splitStatements(content)
    const errors: string[] = []
    let executed = 0

    for (const stmt of statements) {
      try {
        await driver.execute(stmt)
        executed++
      } catch (e) {
        errors.push(`Error en: ${stmt.substring(0, 80)}... → ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return { statements: executed, errors }
  }

  /**
   * Lista los dumps disponibles.
   */
  async list(): Promise<{ filename: string; sizeBytes: number; createdAt: string }[]> {
    try {
      const files = await readdir(this.dumpDir)
      const dumps: { filename: string; sizeBytes: number; createdAt: string }[] = []

      for (const file of files) {
        if (!file.endsWith('.sql')) continue
        const filepath = join(this.dumpDir, file)
        // Use fs.stat instead of reading entire file for size
        const stats = await stat(filepath)
        const sizeBytes = stats.size

        // Extraer fecha del nombre: name-YYYY-MM-DDTHH-MM-SS-mode.sql
        const match = file.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/)
        const createdAt = match
          ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
          : 'unknown'

        dumps.push({ filename: file, sizeBytes, createdAt })
      }

      return dumps.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch {
      return []
    }
  }
}

// ── SQL Generation Helpers ──

function buildHeader(dialect: string, connName: string, options: DumpOptions): string {
  const mode = options.includeSchema && options.includeData
    ? 'estructura + datos'
    : options.includeData
      ? 'solo datos'
      : 'solo estructura'
  const tables = options.tables ? options.tables.join(', ') : 'todas'
  return [
    `-- ============================================`,
    `-- Dump generado por @cocaxcode/database-mcp`,
    `-- Conexion: ${connName}`,
    `-- Dialecto: ${dialect}`,
    `-- Modo: ${mode}`,
    `-- Tablas: ${tables}`,
    `-- Fecha: ${new Date().toISOString()}`,
    `-- ============================================`,
  ].join('\n')
}

function buildFooter(): string {
  return '-- Fin del dump'
}

function buildDisableFKs(dialect: string): string {
  switch (dialect) {
    case 'sqlite':
      return 'PRAGMA foreign_keys = OFF;'
    case 'postgresql':
      return 'SET session_replication_role = replica;'
    case 'mysql':
      return 'SET FOREIGN_KEY_CHECKS = 0;'
    default:
      return ''
  }
}

function buildEnableFKs(dialect: string): string {
  switch (dialect) {
    case 'sqlite':
      return 'PRAGMA foreign_keys = ON;'
    case 'postgresql':
      return 'SET session_replication_role = DEFAULT;'
    case 'mysql':
      return 'SET FOREIGN_KEY_CHECKS = 1;'
    default:
      return ''
  }
}

async function buildCreateTable(driver: DatabaseDriver, table: TableInfo): Promise<string> {
  const q = (n: string) => quoteIdentifier(n, driver.type)

  // Para SQLite, usar sqlite_master que tiene el DDL exacto
  if (driver.type === 'sqlite') {
    assertSafeIdentifier(table.name, 'tabla')
    const result = await driver.execute(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table.name}'`,
    )
    if (result.rows.length > 0 && result.rows[0].sql) {
      return `-- Tabla: ${table.name}\nDROP TABLE IF EXISTS ${q(table.name)};\n${result.rows[0].sql as string};`
    }
  }

  // Para PostgreSQL y MySQL, generar DDL desde metadata
  const columns = table.columns ?? []
  const fks = table.foreignKeys ?? []
  const indexes = table.indexes ?? []

  const tableName = q(table.name)

  const lines: string[] = []

  // Columnas
  for (const col of columns) {
    const parts: string[] = [q(col.name)]
    parts.push(mapColumnType(driver.type, col))
    if (!col.nullable) parts.push('NOT NULL')
    if (col.defaultValue !== undefined && col.defaultValue !== null) {
      if (!col.isPrimaryKey || !col.defaultValue.includes('nextval')) {
        parts.push(`DEFAULT ${col.defaultValue}`)
      }
    }
    lines.push('  ' + parts.join(' '))
  }

  // Primary key
  const pkCols = columns.filter((c) => c.isPrimaryKey)
  if (pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.map((c) => q(c.name)).join(', ')})`)
  }

  // Foreign keys
  for (const fk of fks) {
    lines.push(`  FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.referencedTable)}(${q(fk.referencedColumn)})`)
  }

  const dropStmt = driver.type === 'mysql'
    ? `DROP TABLE IF EXISTS ${tableName};`
    : `DROP TABLE IF EXISTS ${tableName} CASCADE;`

  const createStmt = `CREATE TABLE ${tableName} (\n${lines.join(',\n')}\n);`

  // Indexes (no PKs)
  const indexStmts = indexes
    .filter((idx) => !idx.name.includes('pkey') && !idx.name.includes('PRIMARY'))
    .map((idx) => {
      const unique = idx.unique ? 'UNIQUE ' : ''
      return `CREATE ${unique}INDEX ${q(idx.name)} ON ${tableName} (${idx.columns.map(q).join(', ')});`
    })

  return [
    `-- Tabla: ${table.name}`,
    dropStmt,
    createStmt,
    ...indexStmts,
  ].join('\n')
}

function mapColumnType(dialect: string, col: ColumnInfo): string {
  const t = col.type.toUpperCase()

  if (dialect === 'postgresql' && col.isPrimaryKey && (t === 'INTEGER' || t === 'INT' || t === 'BIGINT')) {
    return t === 'BIGINT' ? 'BIGSERIAL' : 'SERIAL'
  }

  if (dialect === 'mysql' && col.isPrimaryKey && (t === 'INT' || t === 'INTEGER' || t === 'BIGINT')) {
    return `${col.type} AUTO_INCREMENT`
  }

  return col.type
}

async function buildInserts(
  driver: DatabaseDriver,
  table: TableInfo,
): Promise<{ sql: string; rowCount: number }> {
  const q = (n: string) => quoteIdentifier(n, driver.type)
  const tableName = q(table.name)

  // Read data with limit to prevent OOM
  const result = await driver.execute(`SELECT * FROM ${tableName} LIMIT ${MAX_DUMP_ROWS}`)

  if (result.rows.length === 0) {
    return { sql: `-- ${table.name}: sin datos`, rowCount: 0 }
  }

  const columns = result.columns.map(q).join(', ')

  const inserts: string[] = [`-- Datos: ${table.name} (${result.rows.length} filas${result.rows.length >= MAX_DUMP_ROWS ? ' — TRUNCADO' : ''})`]

  for (const row of result.rows) {
    const values = result.columns.map((col) => escapeValue(row[col])).join(', ')
    inserts.push(`INSERT INTO ${tableName} (${columns}) VALUES (${values});`)
  }

  return { sql: inserts.join('\n'), rowCount: result.rows.length }
}

/**
 * Splits SQL into statements respecting single-quoted strings.
 * Handles escaped quotes ('') inside strings correctly.
 */
function splitStatements(sql: string): string[] {
  // Remove comment lines first
  const lines = sql.split('\n').filter((line) => !line.startsWith('--') && line.trim().length > 0)
  const cleaned = lines.join('\n')

  const statements: string[] = []
  let current = ''
  let inString = false

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]

    if (ch === "'" && !inString) {
      inString = true
      current += ch
    } else if (ch === "'" && inString) {
      // Check for escaped quote ('')
      if (i + 1 < cleaned.length && cleaned[i + 1] === "'") {
        current += "''"
        i++ // skip next quote
      } else {
        inString = false
        current += ch
      }
    } else if (ch === ';' && !inString) {
      const trimmed = current.trim()
      if (trimmed.length > 0) {
        statements.push(trimmed + ';')
      }
      current = ''
    } else {
      current += ch
    }
  }

  // Handle last statement without trailing semicolon
  const trimmed = current.trim()
  if (trimmed.length > 0) {
    statements.push(trimmed + ';')
  }

  return statements
}
