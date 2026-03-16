import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ConnectionManager } from '../services/connection-manager.js'
import type { RollbackManager } from '../services/rollback-manager.js'
import type { HistoryLogger } from '../services/history-logger.js'
import type { Storage } from '../lib/storage.js'
import { executeRead, executeMutation, executeExplain } from '../services/query-executor.js'
import { classifySql } from '../utils/sql-classifier.js'
import { formatQueryResult } from '../utils/result-formatter.js'

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const error = (t: string) => ({ content: [{ type: 'text' as const, text: `Error: ${t}` }], isError: true as const })

export function registerQueryTools(
  server: McpServer,
  storage: Storage,
  manager: ConnectionManager,
  rollbackMgr: RollbackManager,
  historyLogger: HistoryLogger,
): void {
  // ── execute_query ──
  server.tool(
    'execute_query',
    'Ejecuta una consulta de lectura (SELECT, SHOW, etc.). Inyecta LIMIT automaticamente.',
    {
      sql: z.string().describe('Consulta SQL de lectura'),
      params: z.array(z.unknown()).optional().describe('Parametros para prepared statement'),
      limit: z.number().optional().describe('Limite de filas (default: 100)'),
    },
    async (params) => {
      try {
        const driver = await manager.getActiveDriver()
        const connName = manager.getActiveConnectionName() ?? 'unknown'
        const start = performance.now()

        try {
          const result = await executeRead(driver, params.sql, params.params, params.limit)
          const executionTimeMs = Math.round(performance.now() - start)

          await historyLogger.log({
            sql: params.sql,
            params: params.params,
            type: 'read',
            connection: connName,
            timestamp: new Date().toISOString(),
            executionTimeMs,
            rowCount: result.rowCount,
            success: true,
          })

          return text(formatQueryResult(result))
        } catch (e) {
          const executionTimeMs = Math.round(performance.now() - start)
          await historyLogger.log({
            sql: params.sql,
            params: params.params,
            type: 'read',
            connection: connName,
            timestamp: new Date().toISOString(),
            executionTimeMs,
            success: false,
            error: e instanceof Error ? e.message : String(e),
          })
          return error(e instanceof Error ? e.message : String(e))
        }
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── execute_mutation ──
  server.tool(
    'execute_mutation',
    'Ejecuta una mutacion (INSERT, UPDATE, DELETE, DDL). Pide confirmacion y crea snapshot para rollback.',
    {
      sql: z.string().describe('Sentencia SQL de escritura'),
      params: z.array(z.unknown()).optional().describe('Parametros para prepared statement'),
    },
    async (params) => {
      try {
        const driver = await manager.getActiveDriver()
        const connName = manager.getActiveConnectionName() ?? 'unknown'

        // Verificar modo read-write
        const activeConnName = await storage.getActiveConnection()
        if (activeConnName) {
          const conn = await storage.getConnection(activeConnName)
          if (conn?.mode === 'read-only') {
            return error(`La conexion '${activeConnName}' esta en modo read-only. Cambia a read-write con conn_set.`)
          }
        }

        const sqlType = classifySql(params.sql)

        const start = performance.now()

        // Snapshot pre-mutation
        let rollbackId: string | undefined
        try {
          rollbackId = await rollbackMgr.snapshot(params.sql, params.params, connName, driver)
        } catch {
          // Si falla el snapshot, continuar sin rollback
        }

        try {
          const result = await executeMutation(driver, params.sql, params.params)
          const executionTimeMs = Math.round(performance.now() - start)

          // Completar snapshot de INSERT con datos post-insert
          if (rollbackId && sqlType !== 'ddl') {
            try {
              await rollbackMgr.completeInsertSnapshot(rollbackId, driver)
            } catch {
              // No bloquear si falla la captura post-insert
            }
          }

          await historyLogger.log({
            sql: params.sql,
            params: params.params,
            type: sqlType === 'ddl' ? 'ddl' : 'write',
            connection: connName,
            timestamp: new Date().toISOString(),
            executionTimeMs,
            affectedRows: result.affectedRows,
            success: true,
          })

          const rollbackMsg = rollbackId ? `\nRollback disponible: ${rollbackId}` : ''
          return text(formatQueryResult(result) + rollbackMsg)
        } catch (e) {
          const executionTimeMs = Math.round(performance.now() - start)
          await historyLogger.log({
            sql: params.sql,
            params: params.params,
            type: sqlType === 'ddl' ? 'ddl' : 'write',
            connection: connName,
            timestamp: new Date().toISOString(),
            executionTimeMs,
            success: false,
            error: e instanceof Error ? e.message : String(e),
          })
          return error(e instanceof Error ? e.message : String(e))
        }
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── explain_query ──
  server.tool(
    'explain_query',
    'Muestra el plan de ejecucion de una consulta (EXPLAIN). Sin ANALYZE por defecto.',
    {
      sql: z.string().describe('Consulta SQL a analizar'),
      params: z.array(z.unknown()).optional().describe('Parametros'),
      analyze: z.boolean().default(false).describe('Ejecutar ANALYZE (ojo: ejecuta la query realmente)'),
    },
    async (params) => {
      try {
        const driver = await manager.getActiveDriver()
        const connName = manager.getActiveConnectionName() ?? 'unknown'
        const start = performance.now()

        try {
          const result = await executeExplain(driver, params.sql, params.params, params.analyze)
          const executionTimeMs = Math.round(performance.now() - start)

          await historyLogger.log({
            sql: `EXPLAIN ${params.sql}`,
            params: params.params,
            type: 'explain',
            connection: connName,
            timestamp: new Date().toISOString(),
            executionTimeMs,
            success: true,
          })

          return text(formatQueryResult(result))
        } catch (e) {
          const executionTimeMs = Math.round(performance.now() - start)
          await historyLogger.log({
            sql: `EXPLAIN ${params.sql}`,
            params: params.params,
            type: 'explain',
            connection: connName,
            timestamp: new Date().toISOString(),
            executionTimeMs,
            success: false,
            error: e instanceof Error ? e.message : String(e),
          })
          return error(e instanceof Error ? e.message : String(e))
        }
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )
}
