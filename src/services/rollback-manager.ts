import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseDriver } from '../drivers/interface.js'
import type { RollbackSnapshot, QueryResult } from '../lib/types.js'
import { extractTableAndWhere } from '../utils/sql-parser-light.js'
import { classifySql } from '../utils/sql-classifier.js'

const MAX_SNAPSHOTS = 500

export class RollbackManager {
  private readonly rollbackDir: string

  constructor(projectDir: string) {
    this.rollbackDir = join(projectDir, '.database-mcp', 'rollbacks')
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

    // Capturar filas afectadas para UPDATE y DELETE
    if (parsed?.table && (snap.type === 'update' || snap.type === 'delete')) {
      try {
        const selectSql = parsed.where
          ? `SELECT * FROM "${parsed.table}" WHERE ${parsed.where}`
          : `SELECT * FROM "${parsed.table}"`
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
      const content = await readFile(join(this.rollbackDir, `${id}.json`), 'utf-8')
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

    const reverseSql = this.generateReverseSql(snap)
    if (!reverseSql.length) {
      throw new Error('No se puede generar SQL inverso para este rollback')
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
  generateReverseSql(snap: RollbackSnapshot): string[] {
    if (!snap.table) return []

    switch (snap.type) {
      case 'insert':
        // INSERT → no tenemos pre-state, pero si tenemos insertedIds podriamos hacer DELETE
        // Por ahora, retornar vacio si no hay info suficiente
        return []

      case 'delete':
        // DELETE → INSERT las filas capturadas
        if (!snap.affectedRows?.length) return []
        return snap.affectedRows.map((row) => {
          const columns = Object.keys(row)
          const values = columns.map((c) => escapeValue(row[c]))
          return `INSERT INTO "${snap.table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${values.join(', ')})`
        })

      case 'update':
        // UPDATE → UPDATE con los valores anteriores
        if (!snap.affectedRows?.length) return []
        return snap.affectedRows.map((row) => {
          const columns = Object.keys(row)
          // Intentar usar la PK para el WHERE (primer campo como heuristica)
          const pkCol = columns[0]
          const setClauses = columns
            .filter((c) => c !== pkCol)
            .map((c) => `"${c}" = ${escapeValue(row[c])}`)
          return `UPDATE "${snap.table}" SET ${setClauses.join(', ')} WHERE "${pkCol}" = ${escapeValue(row[pkCol])}`
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

      if (jsonFiles.length > MAX_SNAPSHOTS) {
        const toDelete = jsonFiles.slice(0, jsonFiles.length - MAX_SNAPSHOTS)
        for (const file of toDelete) {
          await unlink(join(this.rollbackDir, file))
        }
      }
    } catch {
      // Ignorar errores de truncado
    }
  }
}

function escapeValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  // Escapar comillas simples
  return `'${String(value).replace(/'/g, "''")}'`
}
