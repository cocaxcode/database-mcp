/**
 * Shared SQL escape/quote utilities.
 * Used by rollback-manager, dump-manager, and schema-introspector.
 */

// Regex for safe SQL identifiers (table names, column names, schema names)
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Validates that a SQL identifier is safe (no injection risk).
 * Throws if the identifier contains invalid characters.
 */
export function assertSafeIdentifier(name: string, label = 'identifier'): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Nombre de ${label} invalido: "${name}". Solo se permiten letras, numeros y guion bajo.`)
  }
}

/**
 * Quotes a SQL identifier with the appropriate quote character for the dialect.
 * Validates the identifier first to prevent SQL injection.
 */
export function quoteIdentifier(name: string, dialect: string): string {
  assertSafeIdentifier(name)
  return dialect === 'mysql' ? `\`${name}\`` : `"${name}"`
}

/**
 * Returns a quote function for the given dialect.
 */
export function quoteFn(dialect: string): (name: string) => string {
  return (name: string) => quoteIdentifier(name, dialect)
}

/**
 * Escapes a value for use in a SQL statement.
 * Handles null, numbers, booleans, dates, objects (JSON/JSONB), and strings.
 */
export function escapeValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return `'${value.toISOString()}'`
  // Objects and arrays (jsonb, json columns) — serialize as JSON string
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  // Strings — escape single quotes and backslashes
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}
