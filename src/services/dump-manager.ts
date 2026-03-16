import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseDriver } from '../drivers/interface.js'
import { SchemaIntrospector } from './schema-introspector.js'
import type { TableInfo, ColumnInfo } from '../lib/types.js'

export interface DumpOptions {
  /** Solo estructura (DDL) o tambien datos */
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
      // CREATE TABLE
      const ddl = await buildCreateTable(driver, table)
      parts.push(ddl)

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
    const mode = options.includeData ? 'full' : 'schema'
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
    const filepath = join(this.dumpDir, filename)
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
        const content = await readFile(filepath, 'utf-8')
        const sizeBytes = Buffer.byteLength(content, 'utf-8')

        // Extraer fecha del nombre: name-YYYY-MM-DDTHH-MM-SS-mode.sql
        const match = file.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/)
        const createdAt = match ? match[1].replace(/T/, ' ').replace(/-/g, (_m, offset) => offset > 9 ? ':' : '-') : 'unknown'

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
  const mode = options.includeData ? 'estructura + datos' : 'solo estructura'
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
  // Para SQLite, usar sqlite_master que tiene el DDL exacto
  if (driver.type === 'sqlite') {
    const result = await driver.execute(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table.name}'`,
    )
    if (result.rows.length > 0 && result.rows[0].sql) {
      return `-- Tabla: ${table.name}\nDROP TABLE IF EXISTS "${table.name}";\n${result.rows[0].sql as string};`
    }
  }

  // Para PostgreSQL y MySQL, generar DDL desde metadata
  const columns = table.columns ?? []
  const fks = table.foreignKeys ?? []
  const indexes = table.indexes ?? []

  const quoteFn = driver.type === 'mysql' ? (n: string) => `\`${n}\`` : (n: string) => `"${n}"`
  const tableName = quoteFn(table.name)

  const lines: string[] = []

  // Columnas
  for (const col of columns) {
    const parts: string[] = [quoteFn(col.name)]
    parts.push(mapColumnType(driver.type, col))
    if (!col.nullable) parts.push('NOT NULL')
    if (col.defaultValue !== undefined && col.defaultValue !== null) {
      // Filtrar defaults auto-generados como nextval() para PKs
      if (!col.isPrimaryKey || !col.defaultValue.includes('nextval')) {
        parts.push(`DEFAULT ${col.defaultValue}`)
      }
    }
    lines.push('  ' + parts.join(' '))
  }

  // Primary key
  const pkCols = columns.filter((c) => c.isPrimaryKey)
  if (pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.map((c) => quoteFn(c.name)).join(', ')})`)
  }

  // Foreign keys
  for (const fk of fks) {
    lines.push(`  FOREIGN KEY (${quoteFn(fk.column)}) REFERENCES ${quoteFn(fk.referencedTable)}(${quoteFn(fk.referencedColumn)})`)
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
      return `CREATE ${unique}INDEX ${quoteFn(idx.name)} ON ${tableName} (${idx.columns.map(quoteFn).join(', ')});`
    })

  return [
    `-- Tabla: ${table.name}`,
    dropStmt,
    createStmt,
    ...indexStmts,
  ].join('\n')
}

function mapColumnType(dialect: string, col: ColumnInfo): string {
  // Usar el tipo original — es lo que vino de information_schema
  const t = col.type.toUpperCase()

  // Para PostgreSQL auto-increment
  if (dialect === 'postgresql' && col.isPrimaryKey && (t === 'INTEGER' || t === 'INT' || t === 'BIGINT')) {
    return t === 'BIGINT' ? 'BIGSERIAL' : 'SERIAL'
  }

  // Para MySQL auto-increment
  if (dialect === 'mysql' && col.isPrimaryKey && (t === 'INT' || t === 'INTEGER' || t === 'BIGINT')) {
    return `${col.type} AUTO_INCREMENT`
  }

  return col.type
}

async function buildInserts(
  driver: DatabaseDriver,
  table: TableInfo,
): Promise<{ sql: string; rowCount: number }> {
  // Leer todos los datos sin limite
  const result = await driver.execute(`SELECT * FROM "${table.name}"`)

  if (result.rows.length === 0) {
    return { sql: `-- ${table.name}: sin datos`, rowCount: 0 }
  }

  const quoteFn = driver.type === 'mysql' ? (n: string) => `\`${n}\`` : (n: string) => `"${n}"`
  const tableName = quoteFn(table.name)
  const columns = result.columns.map(quoteFn).join(', ')

  const inserts: string[] = [`-- Datos: ${table.name} (${result.rows.length} filas)`]

  for (const row of result.rows) {
    const values = result.columns.map((col) => escapeValue(row[col])).join(', ')
    inserts.push(`INSERT INTO ${tableName} (${columns}) VALUES (${values});`)
  }

  return { sql: inserts.join('\n'), rowCount: result.rows.length }
}

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  if (val instanceof Date) return `'${val.toISOString()}'`
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`
  // String
  return `'${String(val).replace(/'/g, "''")}'`
}

function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.startsWith('--') && line.trim().length > 0)
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ';')
}
