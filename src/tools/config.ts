import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Storage } from '../lib/storage.js'
import type { RollbackManager } from '../services/rollback-manager.js'
import type { HistoryLogger } from '../services/history-logger.js'
import { DEFAULT_CONFIG } from '../lib/types.js'

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const error = (t: string) => ({ content: [{ type: 'text' as const, text: `Error: ${t}` }], isError: true as const })

export function registerConfigTools(
  server: McpServer,
  storage: Storage,
  rollbackMgr: RollbackManager,
  historyLogger: HistoryLogger,
): void {
  // ── config_get ──
  server.tool(
    'config_get',
    'Muestra la configuracion actual del servidor (limites de rollback e historial).',
    {},
    async () => {
      try {
        const config = await storage.getConfig()
        const lines = [
          'Configuracion actual:',
          '',
          `  max_rollbacks: ${config.maxRollbacks} (default: ${DEFAULT_CONFIG.maxRollbacks})`,
          `  max_history:   ${config.maxHistory} (default: ${DEFAULT_CONFIG.maxHistory})`,
          '',
          'Prioridad: variable de entorno > config guardada > default.',
          'Usa config_set para cambiar los valores.',
        ]
        return text(lines.join('\n'))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── config_set ──
  server.tool(
    'config_set',
    'Modifica la configuracion del servidor. Los cambios se guardan permanentemente.',
    {
      max_rollbacks: z.number().min(10).max(100000).optional().describe('Maximo de snapshots de rollback por proyecto (default: 1000)'),
      max_history: z.number().min(10).max(100000).optional().describe('Maximo de entradas de historial por proyecto (default: 5000)'),
    },
    async ({ max_rollbacks, max_history }) => {
      try {
        const updates: Record<string, number> = {}
        if (max_rollbacks !== undefined) updates.maxRollbacks = max_rollbacks
        if (max_history !== undefined) updates.maxHistory = max_history

        if (Object.keys(updates).length === 0) {
          return error('Debes especificar al menos un valor a cambiar (max_rollbacks o max_history)')
        }

        const config = await storage.setConfig(updates)

        // Aplicar inmediatamente
        rollbackMgr.setMaxSnapshots(config.maxRollbacks)
        historyLogger.setMaxEntries(config.maxHistory)

        const lines = [
          'Configuracion actualizada:',
          '',
          `  max_rollbacks: ${config.maxRollbacks}`,
          `  max_history:   ${config.maxHistory}`,
        ]
        return text(lines.join('\n'))
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
