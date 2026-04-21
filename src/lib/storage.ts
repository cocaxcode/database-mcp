import { mkdir, readFile, writeFile, readdir, unlink, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sanitizeName } from './sanitize.js'
import type { Connection, ConnectionListItem, ConnectionGroup, ServerConfig } from './types.js'
import { DEFAULT_CONFIG } from './types.js'

/** Limpia los activos de sesión al arrancar el server */
export async function clearSessionActives(): Promise<void> {
  const baseDir = process.env.DATABASE_MCP_DIR ?? join(homedir(), '.database-mcp')
  const projectConnsFile = join(baseDir, 'project-conns.json')
  try {
    await unlink(projectConnsFile)
  } catch {
    // No existe, ok
  }
}

export class Storage {
  public readonly baseDir: string
  private readonly connectionsDir: string
  private readonly projectConnsFile: string
  private readonly groupsDir: string
  private readonly configFile: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.env.DATABASE_MCP_DIR ?? join(homedir(), '.database-mcp')
    this.connectionsDir = join(this.baseDir, 'connections')
    this.groupsDir = join(this.baseDir, 'groups')
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
    const cwdGroup = await this.getGroupForPath(process.cwd())

    const allConns = await Promise.all(
      files.map((file) => this.readJson<Connection>(join(this.connectionsDir, file))),
    )

    // Filtrar por grupo del CWD
    const filtered = allConns
      .filter((conn): conn is Connection => conn !== null)
      .filter((conn) => cwdGroup ? conn.group === cwdGroup.name : true)

    return filtered.map((conn) => ({
      name: conn.name,
      type: conn.type,
      mode: conn.mode,
      active: conn.name === activeConn,
      default: cwdGroup ? cwdGroup.default === conn.name : false,
      group: conn.group,
      database: conn.database ?? conn.filepath ?? this.extractDbFromDsn(conn.dsn),
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

    // Limpiar default del grupo
    if (conn.group) {
      const group = await this.getGroup(conn.group)
      if (group?.default === name) {
        group.default = undefined
        group.updatedAt = new Date().toISOString()
        await this.saveGroup(group)
      }
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

    conn.name = newName
    conn.updatedAt = new Date().toISOString()

    const newPath = join(this.connectionsDir, `${sanitizeName(newName)}.json`)
    await this.writeJson(newPath, conn)
    await unlink(join(this.connectionsDir, `${sanitizeName(oldName)}.json`))

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

    // Actualizar default del grupo
    if (conn.group) {
      const group = await this.getGroup(conn.group)
      if (group?.default === oldName) {
        group.default = newName
        group.updatedAt = new Date().toISOString()
        await this.saveGroup(group)
      }
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
    const projectPath = project ?? process.cwd()
    const group = await this.getGroupForPath(projectPath)

    // 1. Activo de sesión — solo si pertenece al grupo del CWD
    const projectConns = await this.getProjectConns()
    const sessionConn = projectConns[projectPath]
    if (sessionConn) {
      const conn = await this.getConnection(sessionConn)
      if (conn && (!group || conn.group === group.name)) {
        return sessionConn
      }
    }

    // 2. Default del grupo
    if (group?.default) {
      const conn = await this.getConnection(group.default)
      if (conn) return group.default
    }

    // 3. Sin grupo → ninguna activa
    return null
  }

  async setActiveConnection(name: string, project?: string): Promise<void> {
    const conn = await this.getConnection(name)
    if (!conn) {
      throw new Error(`Conexion '${name}' no encontrada`)
    }

    // Guardar como activo de sesión por proyecto
    const projectPath = project ?? process.cwd()
    const projectConns = await this.getProjectConns()
    projectConns[projectPath] = name
    await this.ensureDir('')
    await this.writeJson(this.projectConnsFile, projectConns)
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

  // ── Connection Groups ──

  async createGroup(name: string): Promise<ConnectionGroup> {
    await this.ensureDir('groups')
    const existing = await this.getGroup(name)
    if (existing) {
      throw new Error(`El grupo '${name}' ya existe`)
    }
    const now = new Date().toISOString()
    const group: ConnectionGroup = { name, scopes: [], createdAt: now, updatedAt: now }
    await this.saveGroup(group)
    return group
  }

  async getGroup(name: string): Promise<ConnectionGroup | null> {
    const filePath = join(this.groupsDir, `${sanitizeName(name)}.json`)
    return this.readJson<ConnectionGroup>(filePath)
  }

  async listGroups(): Promise<ConnectionGroup[]> {
    await this.ensureDir('groups')
    const files = await this.listJsonFiles(this.groupsDir)
    const groups = await Promise.all(
      files.map((file) => this.readJson<ConnectionGroup>(join(this.groupsDir, file))),
    )
    return groups.filter((g): g is ConnectionGroup => g !== null)
  }

  async deleteGroup(name: string): Promise<void> {
    const group = await this.getGroup(name)
    if (!group) {
      throw new Error(`Grupo '${name}' no encontrado`)
    }
    await unlink(join(this.groupsDir, `${sanitizeName(name)}.json`))
  }

  async addScopeToGroup(groupName: string, scope: string): Promise<void> {
    const group = await this.getGroup(groupName)
    if (!group) {
      throw new Error(`Grupo '${groupName}' no encontrado`)
    }
    const normalized = scope.replace(/\\/g, '/')
    if (!group.scopes.includes(normalized)) {
      group.scopes.push(normalized)
      group.updatedAt = new Date().toISOString()
      await this.saveGroup(group)
    }
  }

  async removeScopeFromGroup(groupName: string, scope: string): Promise<void> {
    const group = await this.getGroup(groupName)
    if (!group) {
      throw new Error(`Grupo '${groupName}' no encontrado`)
    }
    const normalized = scope.replace(/\\/g, '/')
    group.scopes = group.scopes.filter((s) => s !== normalized)
    group.updatedAt = new Date().toISOString()
    await this.saveGroup(group)
  }

  async getGroupForPath(path: string): Promise<ConnectionGroup | null> {
    const normalized = path.replace(/\\/g, '/')
    const groups = await this.listGroups()
    for (const group of groups) {
      for (const scope of group.scopes) {
        if (normalized === scope || normalized.startsWith(scope + '/')) {
          return group
        }
      }
    }
    return null
  }

  async setGroupDefault(groupName: string, connName: string): Promise<void> {
    const group = await this.getGroup(groupName)
    if (!group) {
      throw new Error(`Grupo '${groupName}' no encontrado`)
    }
    const conn = await this.getConnection(connName)
    if (!conn) {
      throw new Error(`Conexion '${connName}' no encontrada`)
    }
    if (conn.group !== groupName) {
      throw new Error(`La conexion '${connName}' no pertenece al grupo '${groupName}'`)
    }
    group.default = connName
    group.updatedAt = new Date().toISOString()
    await this.saveGroup(group)
  }

  async setConnectionGroup(connName: string, groupName: string): Promise<void> {
    const conn = await this.getConnection(connName)
    if (!conn) {
      throw new Error(`Conexion '${connName}' no encontrada`)
    }
    // Limpiar default del grupo anterior si era el default
    if (conn.group) {
      const oldGroup = await this.getGroup(conn.group)
      if (oldGroup?.default === connName) {
        oldGroup.default = undefined
        oldGroup.updatedAt = new Date().toISOString()
        await this.saveGroup(oldGroup)
      }
    }
    // Crear grupo si no existe
    const group = await this.getGroup(groupName)
    if (!group) {
      await this.createGroup(groupName)
    }
    conn.group = groupName
    conn.updatedAt = new Date().toISOString()
    const filePath = join(this.connectionsDir, `${sanitizeName(connName)}.json`)
    await this.writeJson(filePath, conn)
  }

  private async saveGroup(group: ConnectionGroup): Promise<void> {
    await this.ensureDir('groups')
    const filePath = join(this.groupsDir, `${sanitizeName(group.name)}.json`)
    await this.writeJson(filePath, group)
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

  /** Extrae el nombre de la DB de un DSN (postgresql://user:pass@host:5432/dbname) */
  private extractDbFromDsn(dsn?: string): string | undefined {
    if (!dsn) return undefined
    try {
      // Formato: protocol://user:pass@host:port/database
      const match = dsn.match(/\/([^/?]+)(?:\?|$)/)
      return match?.[1]
    } catch {
      return undefined
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
