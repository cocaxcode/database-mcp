import { resolve, relative } from 'node:path'

/**
 * Validates that a filename does not escape the given base directory.
 * Prevents path traversal attacks (e.g., "../../etc/passwd").
 */
export function assertSafePath(baseDir: string, filename: string): string {
  const resolved = resolve(baseDir, filename)
  const rel = relative(baseDir, resolved)

  // If the relative path starts with ".." or is absolute, it's outside the base
  if (rel.startsWith('..') || resolve(rel) === rel) {
    throw new Error(`Ruta invalida: "${filename}" intenta acceder fuera del directorio permitido`)
  }

  return resolved
}
