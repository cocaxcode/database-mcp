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
import { registerSchemaResources } from './resources/schema.js'

const VERSION = '0.1.0'

/**
 * Crea y configura el MCP server con todos los tools registrados.
 * Exportada como factory para testabilidad con InMemoryTransport.
 */
export function createServer(storageDir?: string, projectDir?: string): McpServer {
  const server = new McpServer({
    name: 'database-mcp',
    version: VERSION,
  })

  const effectiveProjectDir = projectDir ?? process.cwd()

  const storage = new Storage(storageDir)
  const manager = new ConnectionManager(storage)
  const rollbackMgr = new RollbackManager(effectiveProjectDir)
  const historyLogger = new HistoryLogger(effectiveProjectDir)
  const dumpMgr = new DumpManager(effectiveProjectDir)

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
  registerQueryTools(server, storage, manager, rollbackMgr, historyLogger)
  registerRollbackTools(server, rollbackMgr, manager)
  registerHistoryTools(server, historyLogger)
  registerConfigTools(server, storage, rollbackMgr, historyLogger)
  registerDumpTools(server, storage, manager, dumpMgr)

  // Registrar resources
  registerSchemaResources(server, manager)

  return server
}
