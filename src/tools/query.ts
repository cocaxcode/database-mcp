import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ConnectionManager } from '../services/connection-manager.js'
import type { RollbackManager } from '../services/rollback-manager.js'
import type { HistoryLogger } from '../services/history-logger.js'
import type { QueryCache } from '../services/query-cache.js'
import type { Storage } from '../lib/storage.js'
import { executeRead, executeMutation, executeExplain } from '../services/query-executor.js'
import { classifySql } from '../utils/sql-classifier.js'
import { text, error } from '../lib/response.js'
import { extractTablesFromSql } from '../utils/sql-table-extractor.js'
import { SchemaIntrospector } from '../services/schema-introspector.js'
import type { DatabaseDriver } from '../drivers/interface.js'
import {
  compressQueryResult,
  formatCompressedResult,
  makeQueryCallId,
} from '../utils/compress-query.js'
import { QueryVerbosityShape } from '../lib/query-schemas.js'

/**
 * Obtiene el schema resumido de las tablas referenciadas en un SQL.
 * Silencia errores para no bloquear la query principal.
 */
async function getSchemaContext(driver: DatabaseDriver, sql: string): Promise<string> {
  try {
    const tableNames = extractTablesFromSql(sql)
    if (tableNames.length === 0) return ''

    const schemas: string[] = []
    for (const tableName of tableNames) {
      try {
        const columns = await SchemaIntrospector.getColumns(driver, tableName)
        if (columns.length > 0) {
          const cols = columns.map((c) => {
            const parts = [c.name, c.type]
            if (c.isPrimaryKey) parts.push('PK')
            if (!c.nullable) parts.push('NOT NULL')
            return parts.join(' ')
          })
          schemas.push(`${tableName}(${cols.join(', ')})`)
        }
      } catch {
        // Tabla no encontrada o error de permisos — ignorar
      }
    }

    if (schemas.length === 0) return ''
    return `\n\n--- Schema de tablas referenciadas ---\n${schemas.join('\n')}`
  } catch {
    return ''
  }
}

export function registerQueryTools(
  server: McpServer,
  storage: Storage,
  manager: ConnectionManager,
  rollbackMgr: RollbackManager,
  historyLogger: HistoryLogger,
  queryCache: QueryCache,
): void {
  // ── execute_query ──
  server.tool(
    'execute_query',
    'Ejecuta una consulta de lectura (SELECT, SHOW, etc.). Inyecta LIMIT automaticamente. El result se comprime por defecto (verbosity=normal, celdas truncadas a 500 bytes) para ahorrar tokens; usa inspect_last_query con el call_id para recuperar el result completo sin re-ejecutar.',
    {
      sql: z.string().describe('Consulta SQL de lectura'),
      params: z.array(z.unknown()).optional().describe('Parametros para prepared statement'),
      limit: z.number().optional().describe('Limite de filas (default: 100)'),
      include_schema_context: z
        .boolean()
        .optional()
        .describe(
          "Añade un resumen del schema de las tablas referenciadas al final del output (default: true para 'full'/'normal', false para 'minimal'). Ponlo a false si ya conoces el schema.",
        ),
      ...QueryVerbosityShape,
    },
    async (params) => {
      try {
        const driver = await manager.getActiveDriver()
        const connName = manager.getActiveConnectionName() ?? 'unknown'
        const start = performance.now()

        try {
          const result = await executeRead(driver, params.sql, params.params, params.limit)
          const executionTimeMs = Math.round(performance.now() - start)
          result.executionTimeMs = executionTimeMs

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

          const callId = makeQueryCallId()
          await queryCache.save(callId, params.sql, connName, result)

          const compressed = compressQueryResult(result, {
            verbosity: params.verbosity,
            only_columns: params.only_columns,
            max_cell_bytes: params.max_cell_bytes,
            max_rows_in_response: params.max_rows_in_response,
            call_id: callId,
          })

          const verbosity = params.verbosity ?? 'normal'
          const includeSchema =
            params.include_schema_context ?? verbosity !== 'minimal'
          const schemaCtx = includeSchema ? await getSchemaContext(driver, params.sql) : ''
          return text(formatCompressedResult(compressed, schemaCtx))
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
          const schemaCtx = await getSchemaContext(driver, params.sql)
          const errMsg = e instanceof Error ? e.message : String(e)
          return error(errMsg + schemaCtx)
        }
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e))
      }
    },
  )

  // ── execute_mutation ──
  server.tool(
    'execute_mutation',
    'Ejecuta una mutacion (INSERT, UPDATE, DELETE, DDL). Pide confirmacion y crea snapshot para rollback. El result se comprime por defecto — para mutations usa verbosity=minimal si solo te interesa affectedRows.',
    {
      sql: z.string().describe('Sentencia SQL de escritura'),
      params: z.array(z.unknown()).optional().describe('Parametros para prepared statement'),
      ...QueryVerbosityShape,
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
          result.executionTimeMs = executionTimeMs

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

          const callId = makeQueryCallId()
          await queryCache.save(callId, params.sql, connName, result)

          const compressed = compressQueryResult(result, {
            verbosity: params.verbosity,
            only_columns: params.only_columns,
            max_cell_bytes: params.max_cell_bytes,
            max_rows_in_response: params.max_rows_in_response,
            call_id: callId,
          })

          const rollbackMsg = rollbackId ? `\nRollback disponible: ${rollbackId}` : ''
          const schemaCtx = await getSchemaContext(driver, params.sql)
          return text(formatCompressedResult(compressed, rollbackMsg + schemaCtx))
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
          const schemaCtx = await getSchemaContext(driver, params.sql)
          const errMsg = e instanceof Error ? e.message : String(e)
          return error(errMsg + schemaCtx)
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
      ...QueryVerbosityShape,
    },
    async (params) => {
      try {
        const driver = await manager.getActiveDriver()
        const connName = manager.getActiveConnectionName() ?? 'unknown'
        const start = performance.now()

        try {
          const result = await executeExplain(driver, params.sql, params.params, params.analyze)
          const executionTimeMs = Math.round(performance.now() - start)
          result.executionTimeMs = executionTimeMs

          await historyLogger.log({
            sql: `EXPLAIN ${params.sql}`,
            params: params.params,
            type: 'explain',
            connection: connName,
            timestamp: new Date().toISOString(),
            executionTimeMs,
            success: true,
          })

          const callId = makeQueryCallId()
          await queryCache.save(callId, `EXPLAIN ${params.sql}`, connName, result)

          const compressed = compressQueryResult(result, {
            verbosity: params.verbosity,
            only_columns: params.only_columns,
            max_cell_bytes: params.max_cell_bytes,
            max_rows_in_response: params.max_rows_in_response,
            call_id: callId,
          })

          return text(formatCompressedResult(compressed))
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
