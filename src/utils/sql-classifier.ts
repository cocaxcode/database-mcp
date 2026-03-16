import type { SqlType } from '../lib/types.js'

/**
 * Clasifica una sentencia SQL como read, write o ddl.
 * Elimina comentarios y strings antes de analizar.
 * Default conservador: "write" si no se puede determinar.
 */
export function classifySql(sql: string): SqlType {
  // Eliminar comentarios de linea (-- ...)
  let cleaned = sql.replace(/--[^\n]*/g, '')
  // Eliminar comentarios de bloque (/* ... */)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')
  // Eliminar strings (entre comillas simples)
  cleaned = cleaned.replace(/'[^']*'/g, "''")
  // Eliminar strings (entre comillas dobles)
  cleaned = cleaned.replace(/"[^"]*"/g, '""')

  // Extraer primera palabra significativa
  const trimmed = cleaned.trim()
  const match = trimmed.match(/^(\w+)/i)
  if (!match) return 'write' // conservador

  const keyword = match[1].toUpperCase()

  // DDL
  const ddlKeywords = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME']
  if (ddlKeywords.includes(keyword)) return 'ddl'

  // WITH (CTE) — check body for DML keywords to prevent read-only bypass
  if (keyword === 'WITH') {
    const dmlPattern = /\b(INSERT|UPDATE|DELETE|MERGE)\b/i
    if (dmlPattern.test(cleaned)) return 'write'
    return 'read'
  }

  // Read
  const readKeywords = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'PRAGMA']
  if (readKeywords.includes(keyword)) return 'read'

  // Write
  const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'MERGE', 'UPSERT']
  if (writeKeywords.includes(keyword)) return 'write'

  // Default conservador
  return 'write'
}
