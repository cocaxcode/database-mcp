export interface ParsedDml {
  table: string
  where?: string
}

/**
 * Extrae el nombre de tabla y clausula WHERE de un DML simple.
 * Retorna null para DDL o SQL que no se puede parsear.
 *
 * Soporta:
 * - INSERT INTO table ...
 * - UPDATE table SET ... WHERE ...
 * - DELETE FROM table WHERE ...
 */
export function extractTableAndWhere(sql: string): ParsedDml | null {
  // Limpiar comentarios
  let cleaned = sql.replace(/--[^\n]*/g, '')
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')
  cleaned = cleaned.trim()

  // INSERT INTO table
  const insertMatch = cleaned.match(/^INSERT\s+INTO\s+(?:`?(\w+)`?|"?(\w+)"?)/i)
  if (insertMatch) {
    return { table: insertMatch[1] ?? insertMatch[2] }
  }

  // UPDATE table SET ... WHERE ...
  const updateMatch = cleaned.match(/^UPDATE\s+(?:`?(\w+)`?|"?(\w+)"?)/i)
  if (updateMatch) {
    const table = updateMatch[1] ?? updateMatch[2]
    const whereMatch = cleaned.match(/\bWHERE\s+([\s\S]+)$/i)
    return { table, where: whereMatch?.[1]?.trim() }
  }

  // DELETE FROM table WHERE ...
  const deleteMatch = cleaned.match(/^DELETE\s+FROM\s+(?:`?(\w+)`?|"?(\w+)"?)/i)
  if (deleteMatch) {
    const table = deleteMatch[1] ?? deleteMatch[2]
    const whereMatch = cleaned.match(/\bWHERE\s+([\s\S]+)$/i)
    return { table, where: whereMatch?.[1]?.trim() }
  }

  return null
}
