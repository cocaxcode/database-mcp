import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseDriver } from '../drivers/interface.js'
import type { RollbackSnapshot, QueryResult } from '../lib/types.js'
import { extractTableAndWhere } from '../utils/sql-parser-light.js'
import { classifySql } from '../utils/sql-classifier.js'
import { escapeValue, quoteIdentifier, assertSafeIdentifier } from '../utils/sql-escape.js'
import { assertSafePath } from '../utils/path-guard.js'

const SNAPSHOT_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/

export class RollbackManager {
  private readonly rollbackDir: string
  private maxSnapshots = 1000

  constructor(projectDir: string) {
    this.rollbackDir = join(projectDir, '.database-mcp', 'rollbacks')
  }

  setMaxSnapshots(max: number): void {
    this.maxSnapshots = max
  }

  /**
   * Captura un snapshot ANTES de ejecutar una mutacion.
   * Retorna el ID del snapshot.
   */
  async snapshot(
    sql: string,
    params: unknown[] | undefined,
    connection: string,
    driver: DatabaseDriver,
  ): Promise<string> {
    await mkdir(this.rollbackDir, { recursive: true })

    const sqlType = classifySql(sql)
    const parsed = extractTableAndWhere(sql)
    const timestamp = new Date().toISOString()
    const id = `${timestamp.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`

    const snap: RollbackSnapshot = {
      id,
      sql,
      params,
      connection,
      type: sqlType === 'ddl' ? 'ddl' : this.detectDmlType(sql),
      table: parsed?.table,
      timestamp,
    }

    // Capturar filas afectadas para UPDATE y DELETE (pre-mutation state)
    if (parsed?.table && (snap.type === 'update' || snap.type === 'delete')) {
      try {
        assertSafeIdentifier(parsed.table, 'tabla')
        const q = quoteIdentifier(parsed.table, driver.type)
        const selectSql = parsed.where
          ? `SELECT * FROM ${q} WHERE ${parsed.where} LIMIT 10000`
          : `SELECT * FROM ${q} LIMIT 10000`
        const result = await driver.execute(selectSql)
        snap.affectedRows = result.rows
      } catch {
        // Si no se puede capturar, continuar sin pre-state
      }
    }

    const filePath = join(this.rollbackDir, `${id}.json`)
    await writeFile(filePath, JSON.stringify(snap, null, 2), 'utf-8')

    // Truncar si excede maximo
    await this.truncate()

    return id
  }

  /**
   * Completa un snapshot de INSERT capturando los datos insertados.
   * Debe llamarse DESPUES de ejecutar el INSERT para obtener los IDs/datos insertados.
   */
  async completeInsertSnapshot(
    id: string,
    driver: DatabaseDriver,
  ): Promise<void> {
    const snap = await this.get(id)
    if (!snap || snap.type !== 'insert' || !snap.table) return

    try {
      const parsed = extractTableAndWhere(snap.sql)
      if (!parsed?.table) return

      assertSafeIdentifier(parsed.table, 'tabla')
      const q = quoteIdentifier(parsed.table, driver.type)

      // Estrategia: obtener la ultima fila insertada
      let insertedRows: Record<string, unknown>[] = []

      if (driver.type === 'sqlite') {
        const lastId = await driver.execute('SELECT last_insert_rowid() as id')
        const rowId = lastId.rows[0]?.id
        if (rowId !== undefined) {
          const result = await driver.execute(`SELECT * FROM ${q} WHERE rowid = ?`, [rowId])
          insertedRows = result.rows
        }
      } else if (driver.type === 'postgresql') {
        const cols = await driver.execute(
          `SELECT column_name FROM information_schema.columns WHERE table_name = '${parsed.table}' AND table_schema = 'public' ORDER BY ordinal_position LIMIT 1`,
        )
        const firstCol = (cols.rows[0]?.column_name as string) ?? 'id'
        assertSafeIdentifier(firstCol, 'columna')
        const colQ = quoteIdentifier(firstCol, driver.type)
        const result = await driver.execute(
          `SELECT * FROM ${q} ORDER BY ${colQ} DESC LIMIT 1`,
        )
        insertedRows = result.rows
      } else if (driver.type === 'mysql') {
        const lastId = await driver.execute('SELECT LAST_INSERT_ID() as id')
        const rowId = lastId.rows[0]?.id
        if (rowId !== undefined && Number(rowId) > 0) {
          const result = await driver.execute(`SELECT * FROM ${q} WHERE id = ?`, [rowId])
          insertedRows = result.rows
        }
        if (!insertedRows.length) {
          const cols = await driver.execute(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME = '${parsed.table}' AND TABLE_SCHEMA = DATABASE() ORDER BY ORDINAL_POSITION LIMIT 1`,
          )
          const firstCol = ((cols.rows[0]?.COLUMN_NAME ?? cols.rows[0]?.column_name) as string) ?? 'id'
          assertSafeIdentifier(firstCol, 'columna')
          const colQ = quoteIdentifier(firstCol, driver.type)
          const result = await driver.execute(
            `SELECT * FROM ${q} ORDER BY ${colQ} DESC LIMIT 1`,
          )
          insertedRows = result.rows
        }
      }

      if (insertedRows.length > 0) {
        snap.insertedRows = insertedRows
        const filePath = join(this.rollbackDir, `${id}.json`)
        await writeFile(filePath, JSON.stringify(snap, null, 2), 'utf-8')
      }
    } catch {
      // Si falla la captura post-insert, el rollback quedara sin datos
    }
  }

  /**
   * Lista snapshots disponibles.
   */
  async list(options?: { limit?: number; connection?: string }): Promise<RollbackSnapshot[]> {
    const limit = options?.limit ?? 20

    try {
      const files = await readdir(this.rollbackDir)
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort().reverse()

      const snapshots: RollbackSnapshot[] = []
      for (const file of jsonFiles) {
        if (snapshots.length >= limit) break

        try {
          const content = await readFile(join(this.rollbackDir, file), 'utf-8')
          const snap = JSON.parse(content) as RollbackSnapshot

          if (options?.connection && snap.connection !== options.connection) continue
          snapshots.push(snap)
        } catch {
          // Archivo corrupto, ignorar
        }
      }

      return snapshots
    } catch {
      return []
    }
  }

  /**
   * Obtiene un snapshot por ID.
   */
  async get(id: string): Promise<RollbackSnapshot | null> {
    try {
      // Validate ID format to prevent path traversal
      if (!SNAPSHOT_ID_PATTERN.test(id)) {
        return null
      }
      const filePath = assertSafePath(this.rollbackDir, `${id}.json`)
      const content = await readFile(filePath, 'utf-8')
      return JSON.parse(content) as RollbackSnapshot
    } catch {
      return null
    }
  }

  /**
   * Aplica un rollback: genera y ejecuta el SQL inverso.
   */
  async apply(id: string, driver: DatabaseDriver): Promise<QueryResult> {
    const snap = await this.get(id)
    if (!snap) {
      throw new Error(`Rollback '${id}' no encontrado`)
    }

    if (snap.type === 'ddl') {
      throw new Error(
        `Rollback automatico no disponible para operaciones DDL (${snap.sql.substring(0, 50)}...). Necesitas recrear la estructura manualmente.`,
      )
    }

    const reverseSql = this.generateReverseSql(snap, driver.type)
    if (!reverseSql.length) {
      throw new Error('No se puede generar SQL inverso para este rollback (sin datos suficientes)')
    }

    // Ejecutar todas las sentencias inversas
    let lastResult: QueryResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: 0,
      executionTimeMs: 0,
    }

    for (const sql of reverseSql) {
      lastResult = await driver.execute(sql)
    }

    return lastResult
  }

  /**
   * Genera el SQL inverso para un snapshot.
   */
  generateReverseSql(snap: RollbackSnapshot, dialect = 'postgresql'): string[] {
    if (!snap.table) return []

    try {
      assertSafeIdentifier(snap.table, 'tabla')
    } catch {
      return []
    }

    const tbl = quoteIdentifier(snap.table, dialect)

    switch (snap.type) {
      case 'insert':
        // INSERT → DELETE las filas insertadas
        if (!snap.insertedRows?.length) return []
        return snap.insertedRows.map((row) => {
          const columns = Object.keys(row)
          const pkCol = columns[0]
          const pkQ = quoteIdentifier(pkCol, dialect)
          return `DELETE FROM ${tbl} WHERE ${pkQ} = ${escapeValue(row[pkCol])}`
        })

      case 'delete':
        // DELETE → INSERT las filas capturadas
        if (!snap.affectedRows?.length) return []
        return snap.affectedRows.map((row) => {
          const columns = Object.keys(row)
          const colNames = columns.map((c) => quoteIdentifier(c, dialect)).join(', ')
          const values = columns.map((c) => escapeValue(row[c])).join(', ')
          return `INSERT INTO ${tbl} (${colNames}) VALUES (${values})`
        })

      case 'update':
        // UPDATE → UPDATE con los valores anteriores
        if (!snap.affectedRows?.length) return []
        return snap.affectedRows.map((row) => {
          const columns = Object.keys(row)
          const pkCol = columns[0]
          const pkQ = quoteIdentifier(pkCol, dialect)
          const setClauses = columns
            .filter((c) => c !== pkCol)
            .map((c) => `${quoteIdentifier(c, dialect)} = ${escapeValue(row[c])}`)
          return `UPDATE ${tbl} SET ${setClauses.join(', ')} WHERE ${pkQ} = ${escapeValue(row[pkCol])}`
        })

      default:
        return []
    }
  }

  private detectDmlType(sql: string): 'insert' | 'update' | 'delete' | 'ddl' {
    const keyword = sql.trim().split(/\s+/)[0].toUpperCase()
    if (keyword === 'INSERT') return 'insert'
    if (keyword === 'UPDATE') return 'update'
    if (keyword === 'DELETE') return 'delete'
    return 'ddl'
  }

  private async truncate(): Promise<void> {
    try {
      const files = await readdir(this.rollbackDir)
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort()

      if (jsonFiles.length > this.maxSnapshots) {
        const toDelete = jsonFiles.slice(0, jsonFiles.length - this.maxSnapshots)
        for (const file of toDelete) {
          await unlink(join(this.rollbackDir, file))
        }
      }
    } catch {
      // Ignorar errores de truncado
    }
  }
}
