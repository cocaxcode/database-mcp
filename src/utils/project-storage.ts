import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureGitignore } from './gitignore-checker.js'

/** Proyectos ya procesados en esta sesion (evita I/O repetido en cada escritura). */
const handled = new Set<string>()

/**
 * Crea `{projectDir}/.database-mcp/` (y subcarpeta opcional) bajo demanda y,
 * solo en ese momento, anade `.database-mcp/` al .gitignore del proyecto.
 *
 * El .gitignore NO se toca en el arranque del server: si el proyecto nunca
 * escribe historial, rollbacks ni dumps, el repo queda intacto.
 *
 * @param projectDir Raiz del proyecto
 * @param subdir Subcarpeta opcional dentro de `.database-mcp/` (ej. 'dumps')
 * @returns Ruta absoluta de la carpeta creada
 */
export async function ensureProjectStorage(projectDir: string, subdir?: string): Promise<string> {
  const baseDir = join(projectDir, '.database-mcp')
  const target = subdir ? join(baseDir, subdir) : baseDir

  await mkdir(target, { recursive: true })

  if (!handled.has(projectDir)) {
    handled.add(projectDir)
    try {
      await ensureGitignore(projectDir)
    } catch (e) {
      console.error(
        `database-mcp: no se pudo actualizar .gitignore: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  return target
}

/** Solo para tests: limpia la memoria de proyectos ya procesados. */
export function resetProjectStorageCache(): void {
  handled.clear()
}
