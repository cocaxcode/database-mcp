import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Storage } from './lib/storage.js'
import { ConnectionManager } from './services/connection-manager.js'
import { RollbackManager } from './services/rollback-manager.js'
import { HistoryLogger } from './services/history-logger.js'
import { DumpManager } from './services/dump-manager.js'
import { registerConnectionTools } from './tools/connection.js'
import { registerSchemaTools } from './tools/schema.js'
import { registerQueryTools } from './tools/query.js'
import { registerRollbackTools } from './tools/rollback.js'
import { registerHistoryTools } from './tools/history.js'
import { registerConfigTools } from './tools/config.js'
import { registerDumpTools } from './tools/dump.js'
import { registerInspectTools } from './tools/inspect.js'
import { QueryCache } from './services/query-cache.js'
import { registerSchemaResources } from './resources/schema.js'
import { ensureGitignore } from './utils/gitignore-checker.js'

declare const __PKG_VERSION__: string
const VERSION = typeof __PKG_VERSION__ !== 'undefined' ? __PKG_VERSION__ : '0.0.0'

/**
 * Crea y configura el MCP server con todos los tools registrados.
 * Exportada como factory para testabilidad con InMemoryTransport.
 */
const INSTRUCTIONS = `database-mcp conecta con bases de datos PostgreSQL, MySQL y SQLite desde tu asistente AI.

FLUJO TÍPICO:
1. Crea un grupo con conn_group_create y añade scopes con conn_group_add_scope.
2. Crea conexiones con conn_create (siempre pertenecen a un grupo).
3. La primera conexion de un grupo se marca como default automaticamente.
4. Explora el schema con search_schema (3 niveles: names, summary, full).
5. Ejecuta consultas de lectura con execute_query (auto-LIMIT 100).
6. Ejecuta mutaciones con execute_mutation (crea snapshot de rollback automatico).

GRUPOS Y CONEXIONES:
- Todas las conexiones pertenecen a un GRUPO. No existen conexiones globales.
- Un grupo tiene N scopes (directorios) que comparten sus conexiones.
- conn_list filtra automaticamente: si el CWD esta en un scope de un grupo, solo muestra conexiones de ese grupo.
- Cada grupo tiene una conexion DEFAULT (persiste entre sesiones) y una ACTIVE (de sesion).
- conn_switch cambia el active de sesion (no persiste). conn_set_default cambia el default (persiste).
- Al crear una conexion: PREGUNTA al usuario a que grupo pertenece.

COMPORTAMIENTO:
- conn_delete y rollback_apply requieren confirm: true para ejecutar.
- execute_query inyecta LIMIT automaticamente si no existe.
- execute_mutation en modo read-only es bloqueada. Cambia el modo con conn_set.
- Los rollback snapshots permiten revertir mutaciones recientes.
- db_dump exporta a SQL, db_restore es destructivo (DROP + CREATE).`

export function createServer(storageDir?: string, projectDir?: string): McpServer {
  const server = new McpServer({
    name: 'database-mcp',
    version: VERSION,
  }, {
    instructions: INSTRUCTIONS,
  })

  const effectiveProjectDir = projectDir ?? process.cwd()

  const storage = new Storage(storageDir)
  const manager = new ConnectionManager(storage)
  const rollbackMgr = new RollbackManager(effectiveProjectDir)
  const historyLogger = new HistoryLogger(effectiveProjectDir)
  const dumpMgr = new DumpManager(effectiveProjectDir)
  const queryCache = new QueryCache(storage.baseDir)

  // Asegurar que .database-mcp/ esta en .gitignore del proyecto
  ensureGitignore(effectiveProjectDir).catch((e) => {
    console.error(`database-mcp: no se pudo actualizar .gitignore: ${e instanceof Error ? e.message : String(e)}`)
  })

  // Cargar config y aplicar limites
  const applyConfig = async () => {
    const config = await storage.getConfig()
    rollbackMgr.setMaxSnapshots(config.maxRollbacks)
    historyLogger.setMaxEntries(config.maxHistory)
  }
  applyConfig().catch(() => {})

  // Registrar tools
  registerConnectionTools(server, storage, manager)
  registerSchemaTools(server, manager)
  registerQueryTools(server, storage, manager, rollbackMgr, historyLogger, queryCache)
  registerRollbackTools(server, rollbackMgr, manager)
  registerHistoryTools(server, historyLogger)
  registerConfigTools(server, storage, rollbackMgr, historyLogger)
  registerDumpTools(server, storage, manager, dumpMgr)
  registerInspectTools(server, queryCache)

  // Registrar resources
  registerSchemaResources(server, manager)

  return server
}
