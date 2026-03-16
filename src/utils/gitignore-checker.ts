import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Comprueba si `.database-mcp/` esta en el .gitignore del proyecto.
 * Retorna true si esta presente, false si no existe el archivo o no contiene el patron.
 */
export async function checkGitignore(projectDir: string): Promise<boolean> {
  try {
    const content = await readFile(join(projectDir, '.gitignore'), 'utf-8')
    return content.split('\n').some((line) => {
      const trimmed = line.trim()
      return trimmed === '.database-mcp/' || trimmed === '.database-mcp'
    })
  } catch {
    return false
  }
}
