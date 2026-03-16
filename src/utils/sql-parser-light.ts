export interface ParsedDml {
  table: string
  where?: string
}

// Matches: table, `table`, "table", schema.table, `schema`.`table`, "schema"."table"
const TABLE_PATTERN = /(?:`(\w+)`|"(\w+)"|(\w+))(?:\.(?:`(\w+)`|"(\w+)"|(\w+)))?/

/**
 * Extracts the table name from a matched TABLE_PATTERN.
 * If schema.table, returns only the table part.
 */
function extractTable(match: RegExpMatchArray, offset: number): string {
  const first = match[offset] ?? match[offset + 1] ?? match[offset + 2]
  const second = match[offset + 3] ?? match[offset + 4] ?? match[offset + 5]
  // If both parts matched, second is the table (first is schema)
  return second ?? first
}

/**
 * Extrae el nombre de tabla y clausula WHERE de un DML simple.
 * Retorna null para DDL o SQL que no se puede parsear.
 *
 * Soporta:
 * - INSERT INTO table ...
 * - INSERT INTO schema.table ...
 * - UPDATE table SET ... WHERE ...
 * - DELETE FROM table WHERE ...
 */
export function extractTableAndWhere(sql: string): ParsedDml | null {
  // Limpiar comentarios
  let cleaned = sql.replace(/--[^\n]*/g, '')
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')
  cleaned = cleaned.trim()

  // INSERT INTO [schema.]table
  const insertMatch = cleaned.match(new RegExp(`^INSERT\\s+INTO\\s+${TABLE_PATTERN.source}`, 'i'))
  if (insertMatch) {
    return { table: extractTable(insertMatch, 1) }
  }

  // UPDATE [schema.]table SET ... WHERE ...
  const updateMatch = cleaned.match(new RegExp(`^UPDATE\\s+${TABLE_PATTERN.source}`, 'i'))
  if (updateMatch) {
    const table = extractTable(updateMatch, 1)
    const whereMatch = cleaned.match(/\bWHERE\s+([\s\S]+)$/i)
    return { table, where: whereMatch?.[1]?.trim() }
  }

  // DELETE FROM [schema.]table WHERE ...
  const deleteMatch = cleaned.match(new RegExp(`^DELETE\\s+FROM\\s+${TABLE_PATTERN.source}`, 'i'))
  if (deleteMatch) {
    const table = extractTable(deleteMatch, 1)
    const whereMatch = cleaned.match(/\bWHERE\s+([\s\S]+)$/i)
    return { table, where: whereMatch?.[1]?.trim() }
  }

  return null
}
