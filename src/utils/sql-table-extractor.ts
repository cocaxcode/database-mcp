/**
 * Extrae nombres de tablas referenciadas en una sentencia SQL.
 * Soporta SELECT (FROM/JOIN), INSERT, UPDATE, DELETE.
 * No pretende ser un parser completo — cubre el 95% de los casos.
 */
export function extractTablesFromSql(sql: string): string[] {
  // Limpiar comentarios y strings
  let cleaned = sql.replace(/--[^\n]*/g, '')
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')
  cleaned = cleaned.replace(/'[^']*'/g, "''")

  const tables = new Set<string>()
  const ident = /(?:`(\w+)`|"(\w+)"|(\w+))(?:\.(?:`(\w+)`|"(\w+)"|(\w+)))?/

  // FROM / JOIN patterns
  const fromJoinRegex = new RegExp(
    `(?:FROM|JOIN|INTO|UPDATE)\\s+${ident.source}`,
    'gi',
  )
  let match: RegExpExecArray | null
  while ((match = fromJoinRegex.exec(cleaned)) !== null) {
    const table = extractTableName(match, 1)
    if (table && !isKeyword(table)) {
      tables.add(table.toLowerCase())
    }
  }

  return [...tables]
}

function extractTableName(match: RegExpExecArray, offset: number): string | undefined {
  const first = match[offset] ?? match[offset + 1] ?? match[offset + 2]
  const second = match[offset + 3] ?? match[offset + 4] ?? match[offset + 5]
  // If schema.table, return table part
  return second ?? first
}

const SQL_KEYWORDS = new Set([
  'select', 'set', 'values', 'where', 'order', 'group', 'having',
  'limit', 'offset', 'union', 'except', 'intersect', 'as', 'on',
  'and', 'or', 'not', 'in', 'exists', 'between', 'like', 'is',
  'null', 'true', 'false', 'case', 'when', 'then', 'else', 'end',
  'inner', 'outer', 'left', 'right', 'cross', 'full', 'natural',
  'using', 'lateral', 'table', 'index', 'view', 'database',
])

function isKeyword(word: string): boolean {
  return SQL_KEYWORDS.has(word.toLowerCase())
}
