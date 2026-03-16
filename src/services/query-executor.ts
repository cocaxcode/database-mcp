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
 * Skips injection for set operations (UNION, EXCEPT, INTERSECT) and FETCH FIRST.
 */
function injectLimit(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;$/, '')
  const upper = trimmed.toUpperCase()

  // Don't inject LIMIT on set operations (UNION, EXCEPT, INTERSECT) — could break semantics
  if (/\b(UNION|EXCEPT|INTERSECT)\b/i.test(trimmed)) {
    return trimmed
  }

  // Handle FETCH FIRST (SQL standard, used in PG)
  if (/\bFETCH\s+(FIRST|NEXT)\b/i.test(upper)) {
    return trimmed
  }

  // Handle LIMIT ALL (PostgreSQL)
  if (/\bLIMIT\s+ALL\b/i.test(upper)) {
    return trimmed.replace(/\bLIMIT\s+ALL\b/i, `LIMIT ${limit}`)
  }

  // Buscar LIMIT existente (only at the outermost level — after last closing paren)
  const lastParen = trimmed.lastIndexOf(')')
  const searchArea = lastParen >= 0 ? trimmed.slice(lastParen) : trimmed
  const limitMatch = searchArea.match(/\bLIMIT\s+(\d+)/i)

  if (limitMatch) {
    const existingLimit = parseInt(limitMatch[1], 10)
    const effectiveLimit = Math.min(existingLimit, limit)
    // Replace in the full string at the correct position
    const idx = lastParen >= 0
      ? lastParen + (searchArea.indexOf(limitMatch[0]))
      : trimmed.indexOf(limitMatch[0])
    return trimmed.slice(0, idx) + `LIMIT ${effectiveLimit}` + trimmed.slice(idx + limitMatch[0].length)
  }

  // No hay LIMIT, inyectar
  return `${trimmed} LIMIT ${limit}`
}
