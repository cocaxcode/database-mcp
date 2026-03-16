import { readFile, writeFile } from 'node:fs/promises'
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

/**
 * Anade `.database-mcp/` al .gitignore del proyecto si no esta presente.
 * Crea el archivo si no existe. Retorna true si se modifico/creo el archivo.
 */
export async function ensureGitignore(projectDir: string): Promise<boolean> {
  const gitignorePath = join(projectDir, '.gitignore')

  try {
    const exists = await checkGitignore(projectDir)
    if (exists) return false

    let content = ''
    try {
      content = await readFile(gitignorePath, 'utf-8')
    } catch {
      // Archivo no existe, se creara
    }

    const newline = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
    await writeFile(gitignorePath, `${content}${newline}.database-mcp/\n`, 'utf-8')
    return true
  } catch {
    return false
  }
}
