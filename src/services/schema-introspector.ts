import type { DatabaseDriver } from '../drivers/interface.js'
import type { TableInfo, ColumnInfo, ForeignKeyInfo, IndexInfo, DetailLevel } from '../lib/types.js'
import { assertSafeIdentifier } from '../utils/sql-escape.js'

/**
 * Introspection de schema multi-dialecto.
 */
export class SchemaIntrospector {
  /**
   * Obtiene la lista de tablas (y opcionalmente vistas).
   */
  static async getTables(
    driver: DatabaseDriver,
    options?: { schema?: string; objectType?: 'table' | 'view' | 'all'; pattern?: string; detailLevel?: DetailLevel },
  ): Promise<TableInfo[]> {
    const detailLevel = options?.detailLevel ?? 'summary'
    const objectType = options?.objectType ?? 'all'
    const pattern = options?.pattern

    // Validate schema name if provided
    if (options?.schema) assertSafeIdentifier(options.schema, 'schema')

    let tables: TableInfo[]

    switch (driver.type) {
      case 'sqlite':
        tables = await getSQLiteTables(driver, objectType)
        break
      case 'postgresql':
        tables = await getPostgresTables(driver, options?.schema ?? 'public', objectType)
        break
      case 'mysql':
        tables = await getMySQLTables(driver, objectType)
        break
      default:
        throw new Error(`Dialecto no soportado: ${driver.type}`)
    }

    // Filtrar por patron (escape regex metacharacters to prevent ReDoS)
    if (pattern) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped.replace(/%/g, '.*').replace(/_/g, '.'), 'i')
      tables = tables.filter((t) => regex.test(t.name))
    }

    // Si solo names, devolver nombres
    if (detailLevel === 'names') {
      return tables.map((t) => ({ name: t.name, schema: t.schema, type: t.type }))
    }

    // Para summary y full, obtener columnas
    if (detailLevel === 'summary' || detailLevel === 'full') {
      for (const table of tables) {
        table.columns = await SchemaIntrospector.getColumns(driver, table.name, options?.schema)
        if (detailLevel === 'full') {
          table.foreignKeys = await SchemaIntrospector.getForeignKeys(driver, table.name, options?.schema)
          table.indexes = await SchemaIntrospector.getIndexes(driver, table.name, options?.schema)
        }
      }
    }

    return tables
  }

  /**
   * Obtiene las columnas de una tabla.
   */
  static async getColumns(driver: DatabaseDriver, tableName: string, schema?: string): Promise<ColumnInfo[]> {
    assertSafeIdentifier(tableName, 'tabla')
    if (schema) assertSafeIdentifier(schema, 'schema')
    switch (driver.type) {
      case 'sqlite':
        return getSQLiteColumns(driver, tableName)
      case 'postgresql':
        return getPostgresColumns(driver, tableName, schema ?? 'public')
      case 'mysql':
        return getMySQLColumns(driver, tableName)
      default:
        return []
    }
  }

  /**
   * Obtiene las foreign keys de una tabla.
   */
  static async getForeignKeys(driver: DatabaseDriver, tableName: string, schema?: string): Promise<ForeignKeyInfo[]> {
    assertSafeIdentifier(tableName, 'tabla')
    if (schema) assertSafeIdentifier(schema, 'schema')
    switch (driver.type) {
      case 'sqlite':
        return getSQLiteForeignKeys(driver, tableName)
      case 'postgresql':
        return getPostgresForeignKeys(driver, tableName, schema ?? 'public')
      case 'mysql':
        return getMySQLForeignKeys(driver, tableName)
      default:
        return []
    }
  }

  /**
   * Obtiene los indices de una tabla.
   */
  static async getIndexes(driver: DatabaseDriver, tableName: string, schema?: string): Promise<IndexInfo[]> {
    assertSafeIdentifier(tableName, 'tabla')
    if (schema) assertSafeIdentifier(schema, 'schema')
    switch (driver.type) {
      case 'sqlite':
        return getSQLiteIndexes(driver, tableName)
      case 'postgresql':
        return getPostgresIndexes(driver, tableName, schema ?? 'public')
      case 'mysql':
        return getMySQLIndexes(driver, tableName)
      default:
        return []
    }
  }
}

// ── SQLite ──

async function getSQLiteTables(driver: DatabaseDriver, objectType: string): Promise<TableInfo[]> {
  const types: string[] = []
  if (objectType === 'table' || objectType === 'all') types.push("'table'")
  if (objectType === 'view' || objectType === 'all') types.push("'view'")

  const result = await driver.execute(
    `SELECT name, type FROM sqlite_master WHERE type IN (${types.join(',')}) AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  )
  return result.rows.map((r) => ({
    name: r.name as string,
    type: r.type as 'table' | 'view',
  }))
}

async function getSQLiteColumns(driver: DatabaseDriver, tableName: string): Promise<ColumnInfo[]> {
  // tableName already validated by assertSafeIdentifier in caller
  const result = await driver.execute(`PRAGMA table_info("${tableName}")`)
  return result.rows.map((r) => ({
    name: r.name as string,
    type: r.type as string,
    nullable: (r.notnull as number) === 0,
    defaultValue: r.dflt_value as string | undefined,
    isPrimaryKey: (r.pk as number) > 0,
  }))
}

async function getSQLiteForeignKeys(driver: DatabaseDriver, tableName: string): Promise<ForeignKeyInfo[]> {
  const result = await driver.execute(`PRAGMA foreign_key_list("${tableName}")`)
  return result.rows.map((r) => ({
    column: r.from as string,
    referencedTable: r.table as string,
    referencedColumn: r.to as string,
  }))
}

async function getSQLiteIndexes(driver: DatabaseDriver, tableName: string): Promise<IndexInfo[]> {
  const result = await driver.execute(`PRAGMA index_list("${tableName}")`)
  const indexes: IndexInfo[] = []

  for (const row of result.rows) {
    const indexName = row.name as string
    // Index names from PRAGMA are safe (generated by SQLite)
    const colResult = await driver.execute(`PRAGMA index_info("${indexName}")`)
    indexes.push({
      name: indexName,
      columns: colResult.rows.map((c) => c.name as string),
      unique: (row.unique as number) === 1,
    })
  }

  return indexes
}

// ── PostgreSQL ──

async function getPostgresTables(driver: DatabaseDriver, schema: string, objectType: string): Promise<TableInfo[]> {
  const types: string[] = []
  if (objectType === 'table' || objectType === 'all') types.push("'BASE TABLE'")
  if (objectType === 'view' || objectType === 'all') types.push("'VIEW'")

  // schema already validated by assertSafeIdentifier
  const result = await driver.execute(
    `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = '${schema}' AND table_type IN (${types.join(',')}) ORDER BY table_name`,
  )
  return result.rows.map((r) => ({
    name: r.table_name as string,
    schema,
    type: (r.table_type as string) === 'BASE TABLE' ? 'table' as const : 'view' as const,
  }))
}

async function getPostgresColumns(driver: DatabaseDriver, tableName: string, schema: string): Promise<ColumnInfo[]> {
  const result = await driver.execute(
    `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
     CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN true ELSE false END as is_pk
     FROM information_schema.columns c
     LEFT JOIN information_schema.key_column_usage kcu ON c.column_name = kcu.column_name AND c.table_name = kcu.table_name AND c.table_schema = kcu.table_schema
     LEFT JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name AND tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = kcu.table_schema
     WHERE c.table_name = '${tableName}' AND c.table_schema = '${schema}'
     ORDER BY c.ordinal_position`,
  )
  return result.rows.map((r) => ({
    name: r.column_name as string,
    type: r.data_type as string,
    nullable: (r.is_nullable as string) === 'YES',
    defaultValue: r.column_default as string | undefined,
    isPrimaryKey: (r.is_pk as boolean) === true,
  }))
}

async function getPostgresForeignKeys(driver: DatabaseDriver, tableName: string, schema: string): Promise<ForeignKeyInfo[]> {
  const result = await driver.execute(
    `SELECT kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column, tc.constraint_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = '${tableName}' AND tc.table_schema = '${schema}'`,
  )
  return result.rows.map((r) => ({
    column: r.column_name as string,
    referencedTable: r.referenced_table as string,
    referencedColumn: r.referenced_column as string,
    constraintName: r.constraint_name as string,
  }))
}

async function getPostgresIndexes(driver: DatabaseDriver, tableName: string, schema: string): Promise<IndexInfo[]> {
  const result = await driver.execute(
    `SELECT i.relname AS index_name, ix.indisunique AS is_unique, array_agg(a.attname ORDER BY k.n) AS columns
     FROM pg_class t
     JOIN pg_index ix ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE t.relname = '${tableName}' AND n.nspname = '${schema}'
     GROUP BY i.relname, ix.indisunique`,
  )
  return result.rows.map((r) => ({
    name: r.index_name as string,
    columns: Array.isArray(r.columns) ? r.columns as string[] : [r.columns as string],
    unique: r.is_unique as boolean,
  }))
}

// ── MySQL ──

async function getMySQLTables(driver: DatabaseDriver, objectType: string): Promise<TableInfo[]> {
  const types: string[] = []
  if (objectType === 'table' || objectType === 'all') types.push("'BASE TABLE'")
  if (objectType === 'view' || objectType === 'all') types.push("'VIEW'")

  const result = await driver.execute(
    `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE IN (${types.join(',')}) ORDER BY TABLE_NAME`,
  )
  return result.rows.map((r) => ({
    name: (r.TABLE_NAME ?? r.table_name) as string,
    type: ((r.TABLE_TYPE ?? r.table_type) as string) === 'BASE TABLE' ? 'table' as const : 'view' as const,
  }))
}

async function getMySQLColumns(driver: DatabaseDriver, tableName: string): Promise<ColumnInfo[]> {
  const result = await driver.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
     FROM information_schema.COLUMNS
     WHERE TABLE_NAME = '${tableName}' AND TABLE_SCHEMA = DATABASE()
     ORDER BY ORDINAL_POSITION`,
  )
  return result.rows.map((r) => ({
    name: (r.COLUMN_NAME ?? r.column_name) as string,
    type: (r.DATA_TYPE ?? r.data_type) as string,
    nullable: ((r.IS_NULLABLE ?? r.is_nullable) as string) === 'YES',
    defaultValue: (r.COLUMN_DEFAULT ?? r.column_default) as string | undefined,
    isPrimaryKey: ((r.COLUMN_KEY ?? r.column_key) as string) === 'PRI',
  }))
}

async function getMySQLForeignKeys(driver: DatabaseDriver, tableName: string): Promise<ForeignKeyInfo[]> {
  const result = await driver.execute(
    `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_NAME = '${tableName}' AND TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
  )
  return result.rows.map((r) => ({
    column: (r.COLUMN_NAME ?? r.column_name) as string,
    referencedTable: (r.REFERENCED_TABLE_NAME ?? r.referenced_table_name) as string,
    referencedColumn: (r.REFERENCED_COLUMN_NAME ?? r.referenced_column_name) as string,
    constraintName: (r.CONSTRAINT_NAME ?? r.constraint_name) as string,
  }))
}

async function getMySQLIndexes(driver: DatabaseDriver, tableName: string): Promise<IndexInfo[]> {
  const result = await driver.execute(
    `SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
     FROM information_schema.STATISTICS
     WHERE TABLE_NAME = '${tableName}' AND TABLE_SCHEMA = DATABASE()
     GROUP BY INDEX_NAME, NON_UNIQUE`,
  )
  return result.rows.map((r) => ({
    name: (r.INDEX_NAME ?? r.index_name) as string,
    columns: ((r.columns as string) ?? '').split(','),
    unique: ((r.NON_UNIQUE ?? r.non_unique) as number) === 0,
  }))
}
