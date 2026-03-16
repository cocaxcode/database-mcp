import type { DatabaseDriver } from '../drivers/interface.js'
import type { QueryResult } from '../lib/types.js'
import { classifySql } from '../utils/sql-classifier.js'

/**
 * Ejecuta una consulta read-only. Inyecta LIMIT si no existe.
 */
export async function executeRead(
  driver: DatabaseDriver,
  sql: string,
  params?: unknown[],
  limit?: number,
): Promise<QueryResult> {
  const sqlType = classifySql(sql)
  if (sqlType !== 'read') {
    throw new Error('execute_query solo acepta consultas de lectura (SELECT, SHOW, etc.)')
  }

  const effectiveLimit = limit ?? 100
  const finalSql = injectLimit(sql, effectiveLimit)

  return driver.execute(finalSql, params)
}

/**
 * Ejecuta una mutacion (INSERT, UPDATE, DELETE, DDL).
 * No maneja elicitation ni rollback — eso lo hace el tool handler.
 */
export async function executeMutation(
  driver: DatabaseDriver,
  sql: string,
  params?: unknown[],
): Promise<QueryResult> {
  const sqlType = classifySql(sql)
  if (sqlType === 'read') {
    throw new Error('execute_mutation no acepta consultas de lectura. Usa execute_query.')
  }

  return driver.execute(sql, params)
}

/**
 * Ejecuta EXPLAIN sobre una consulta.
 */
export async function executeExplain(
  driver: DatabaseDriver,
  sql: string,
  params?: unknown[],
  analyze?: boolean,
): Promise<QueryResult> {
  let explainSql: string

  switch (driver.type) {
    case 'postgresql':
      explainSql = analyze
        ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
        : `EXPLAIN (FORMAT JSON) ${sql}`
      break
    case 'mysql':
      explainSql = analyze
        ? `EXPLAIN ANALYZE ${sql}`
        : `EXPLAIN FORMAT=JSON ${sql}`
      break
    case 'sqlite':
      explainSql = `EXPLAIN QUERY PLAN ${sql}`
      break
    default:
      explainSql = `EXPLAIN ${sql}`
  }

  return driver.execute(explainSql, params)
}

/**
 * Inyecta o ajusta LIMIT en una consulta SELECT.
 */
function injectLimit(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;$/, '')

  // Buscar LIMIT existente
  const limitMatch = trimmed.match(/\bLIMIT\s+(\d+)/i)
  if (limitMatch) {
    const existingLimit = parseInt(limitMatch[1], 10)
    const effectiveLimit = Math.min(existingLimit, limit)
    return trimmed.replace(/\bLIMIT\s+\d+/i, `LIMIT ${effectiveLimit}`)
  }

  // No hay LIMIT, inyectar
  return `${trimmed} LIMIT ${limit}`
}
