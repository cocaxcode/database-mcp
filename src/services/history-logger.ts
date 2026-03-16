import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HistoryEntry } from '../lib/types.js'
import { checkGitignore } from '../utils/gitignore-checker.js'

export class HistoryLogger {
  private readonly projectDir: string
  private readonly historyFile: string
  private gitignoreChecked = false
  private gitignoreMissing = false
  private maxEntries = 5000

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.historyFile = join(projectDir, '.database-mcp', 'history.json')
  }

  setMaxEntries(max: number): void {
    this.maxEntries = max
  }

  /**
   * Registra una entrada en el historial.
   * Retorna true si es la primera escritura y falta .gitignore.
   */
  async log(entry: Omit<HistoryEntry, 'id'>): Promise<boolean> {
    await mkdir(join(this.projectDir, '.database-mcp'), { recursive: true })

    const entries = await this.readEntries()
    const newId = entries.length > 0 ? Math.max(...entries.map((e) => e.id)) + 1 : 1

    entries.push({ ...entry, id: newId })

    // Truncar si excede maximo
    const trimmed = entries.length > this.maxEntries
      ? entries.slice(entries.length - this.maxEntries)
      : entries

    await writeFile(this.historyFile, JSON.stringify(trimmed, null, 2), 'utf-8')

    // Verificar gitignore en la primera escritura
    if (!this.gitignoreChecked) {
      this.gitignoreChecked = true
      const hasGitignore = await checkGitignore(this.projectDir)
      this.gitignoreMissing = !hasGitignore
      return this.gitignoreMissing
    }

    return false
  }

  /**
   * Lista entradas del historial con filtros opcionales.
   */
  async list(options?: {
    limit?: number
    type?: string
    connection?: string
    success?: boolean
  }): Promise<HistoryEntry[]> {
    const limit = options?.limit ?? 20
    let entries = await this.readEntries()

    // Filtrar
    if (options?.type) {
      entries = entries.filter((e) => e.type === options.type)
    }
    if (options?.connection) {
      entries = entries.filter((e) => e.connection === options.connection)
    }
    if (options?.success !== undefined) {
      entries = entries.filter((e) => e.success === options.success)
    }

    // Ordenar por timestamp desc y limitar
    return entries.reverse().slice(0, limit)
  }

  /**
   * Limpia entradas del historial.
   * Si se especifica `before`, solo elimina las anteriores a esa fecha.
   * Retorna la cantidad de entradas eliminadas.
   */
  async clear(before?: string): Promise<number> {
    const entries = await this.readEntries()

    if (!before) {
      await writeFile(this.historyFile, '[]', 'utf-8')
      return entries.length
    }

    const beforeDate = new Date(before)
    const remaining = entries.filter((e) => new Date(e.timestamp) >= beforeDate)
    const deleted = entries.length - remaining.length

    await writeFile(this.historyFile, JSON.stringify(remaining, null, 2), 'utf-8')
    return deleted
  }

  private async readEntries(): Promise<HistoryEntry[]> {
    try {
      const content = await readFile(this.historyFile, 'utf-8')
      return JSON.parse(content) as HistoryEntry[]
    } catch {
      return []
    }
  }
}
