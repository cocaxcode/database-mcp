import { mkdir, readFile, writeFile, readdir, unlink, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sanitizeName } from './sanitize.js'
import type { Connection, ConnectionListItem, ServerConfig } from './types.js'
import { DEFAULT_CONFIG } from './types.js'

export class Storage {
  private readonly baseDir: string
  private readonly connectionsDir: string
  private readonly activeConnFile: string
  private readonly projectConnsFile: string
  private readonly configFile: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.env.DATABASE_MCP_DIR ?? join(homedir(), '.database-mcp')
    this.connectionsDir = join(this.baseDir, 'connections')
    this.activeConnFile = join(this.baseDir, 'active-conn')
    this.projectConnsFile = join(this.baseDir, 'project-conns.json')
    this.configFile = join(this.baseDir, 'config.json')
  }

  // ── Connections ──

  async createConnection(conn: Connection): Promise<void> {
    await this.ensureDir('connections')
    const filePath = join(this.connectionsDir, `${sanitizeName(conn.name)}.json`)

    // Verificar que no exista
    const existing = await this.readJson<Connection>(filePath)
    if (existing) {
      throw new Error(`La conexion '${conn.name}' ya existe`)
    }

    await this.writeJson(filePath, conn)
  }

  async getConnection(name: string): Promise<Connection | null> {
    const filePath = join(this.connectionsDir, `${sanitizeName(name)}.json`)
    return this.readJson<Connection>(filePath)
  }

  async listConnections(): Promise<ConnectionListItem[]> {
    await this.ensureDir('connections')
    const files = await this.listJsonFiles(this.connectionsDir)
    const activeConn = await this.getActiveConnection()

    const allConns = await Promise.all(
      files.map((file) => this.readJson<Connection>(join(this.connectionsDir, file))),
    )

    return allConns
      .filter((conn): conn is Connection => conn !== null)
      .map((conn) => ({
        name: conn.name,
        type: conn.type,
        mode: conn.mode,
        active: conn.name === activeConn,
        database: conn.database ?? conn.filepath,
      }))
  }

  async updateConnection(name: string, updates: Partial<Omit<Connection, 'name' | 'createdAt'>>): Promise<void> {
    const conn = await this.getConnection(name)
    if (!conn) {
      throw new Error(`Conexion '${name}' no encontrada`)
    }

    Object.assign(conn, updates, { updatedAt: new Date().toISOString() })
    const filePath = join(this.connectionsDir, `${sanitizeName(name)}.json`)
    await this.writeJson(filePath, conn)
  }

  async deleteConnection(name: string): Promise<void> {
    const conn = await this.getConnection(name)
    if (!conn) {
      throw new Error(`Conexion '${name}' no encontrada`)
    }

    await unlink(join(this.connectionsDir, `${sanitizeName(name)}.json`))

    // Limpiar active-conn global si era el activo
    try {
      const globalActive = await readFile(this.activeConnFile, 'utf-8')
      if (globalActive.trim() === name) {
        await unlink(this.activeConnFile)
      }
    } catch {
      // No hay active-conn global
    }

    // Limpiar project-conns
    const projectConns = await this.getProjectConns()
    let changed = false
    for (const [project, connName] of Object.entries(projectConns)) {
      if (connName === name) {
        delete projectConns[project]
        changed = true
      }
    }
    if (changed) {
      await this.writeJson(this.projectConnsFile, projectConns)
    }
  }

  async renameConnection(oldName: string, newName: string): Promise<void> {
    const conn = await this.getConnection(oldName)
    if (!conn) {
      throw new Error(`Conexion '${oldName}' no encontrada`)
    }

    const existing = await this.getConnection(newName)
    if (existing) {
      throw new Error(`Ya existe una conexion con el nombre '${newName}'`)
    }

    // Crear con nuevo nombre y eliminar anterior
    conn.name = newName
    conn.updatedAt = new Date().toISOString()

    const newPath = join(this.connectionsDir, `${sanitizeName(newName)}.json`)
    await this.writeJson(newPath, conn)
    await unlink(join(this.connectionsDir, `${sanitizeName(oldName)}.json`))

    // Actualizar active-conn global si era el activo
    try {
      const globalActive = await readFile(this.activeConnFile, 'utf-8')
      if (globalActive.trim() === oldName) {
        await writeFile(this.activeConnFile, newName, 'utf-8')
      }
    } catch {
      // No hay active-conn global
    }

    // Actualizar project-conns
    const projectConns = await this.getProjectConns()
    let changed = false
    for (const [project, connName] of Object.entries(projectConns)) {
      if (connName === oldName) {
        projectConns[project] = newName
        changed = true
      }
    }
    if (changed) {
      await this.writeJson(this.projectConnsFile, projectConns)
    }
  }

  async duplicateConnection(name: string, newName: string): Promise<void> {
    const conn = await this.getConnection(name)
    if (!conn) {
      throw new Error(`Conexion '${name}' no encontrada`)
    }

    const existing = await this.getConnection(newName)
    if (existing) {
      throw new Error(`La conexion '${newName}' ya existe`)
    }

    const now = new Date().toISOString()
    const duplicate: Connection = {
      ...conn,
      name: newName,
      createdAt: now,
      updatedAt: now,
    }

    await this.ensureDir('connections')
    const filePath = join(this.connectionsDir, `${sanitizeName(newName)}.json`)
    await this.writeJson(filePath, duplicate)
  }

  // ── Active Connection ──

  async getActiveConnection(project?: string): Promise<string | null> {
    // Primero buscar conexion especifica del proyecto
    const projectPath = project ?? process.cwd()
    const projectConns = await this.getProjectConns()
    const projectConn = projectConns[projectPath]
    if (projectConn) {
      const conn = await this.getConnection(projectConn)
      if (conn) return projectConn
    }

    // Fallback a conexion global
    try {
      const content = await readFile(this.activeConnFile, 'utf-8')
      return content.trim() || null
    } catch {
      return null
    }
  }

  async setActiveConnection(name: string, project?: string): Promise<void> {
    const conn = await this.getConnection(name)
    if (!conn) {
      throw new Error(`Conexion '${name}' no encontrada`)
    }

    if (project) {
      const projectConns = await this.getProjectConns()
      projectConns[project] = name
      await this.ensureDir('')
      await this.writeJson(this.projectConnsFile, projectConns)
    } else {
      await this.ensureDir('')
      await writeFile(this.activeConnFile, name, 'utf-8')
    }
  }

  async clearProjectConnection(project: string): Promise<boolean> {
    const projectConns = await this.getProjectConns()
    if (!(project in projectConns)) return false
    delete projectConns[project]
    await this.writeJson(this.projectConnsFile, projectConns)
    return true
  }

  async listProjectConnections(): Promise<Record<string, string>> {
    return this.getProjectConns()
  }

  private async getProjectConns(): Promise<Record<string, string>> {
    return (await this.readJson<Record<string, string>>(this.projectConnsFile)) ?? {}
  }

  // ── Config ──

  /**
   * Obtiene la config resuelta: env var > config guardada > default.
   */
  async getConfig(): Promise<ServerConfig> {
    const saved = (await this.readJson<Partial<ServerConfig>>(this.configFile)) ?? {}

    return {
      maxRollbacks: parsePositiveInt(process.env.DATABASE_MCP_MAX_ROLLBACKS) ?? saved.maxRollbacks ?? DEFAULT_CONFIG.maxRollbacks,
      maxHistory: parsePositiveInt(process.env.DATABASE_MCP_MAX_HISTORY) ?? saved.maxHistory ?? DEFAULT_CONFIG.maxHistory,
    }
  }

  async setConfig(updates: Partial<ServerConfig>): Promise<ServerConfig> {
    await this.ensureDir('')
    const current = (await this.readJson<Partial<ServerConfig>>(this.configFile)) ?? {}
    const merged = { ...current, ...updates }
    await this.writeJson(this.configFile, merged)
    return this.getConfig()
  }

  // ── Internal ──

  private async ensureDir(subdir: string): Promise<void> {
    const dir = subdir ? join(this.baseDir, subdir) : this.baseDir
    await mkdir(dir, { recursive: true })
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const content = await readFile(filePath, 'utf-8')
      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    // Restrict file permissions for connection files (may contain secrets)
    if (filePath.includes('connections')) {
      try {
        await chmod(filePath, 0o600)
      } catch {
        // chmod not supported on Windows, ignore
      }
    }
  }

  private async listJsonFiles(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir)
      return entries.filter((f) => f.endsWith('.json')).sort()
    } catch {
      return []
    }
  }
}

/** Parse a string as a positive integer, returning undefined if invalid or <= 0 */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = parseInt(value, 10)
  if (isNaN(n) || n <= 0) {
    console.error(`database-mcp: valor de configuracion invalido: "${value}" (se esperaba un entero positivo)`)
    return undefined
  }
  return n
}
