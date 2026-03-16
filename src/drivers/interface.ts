import type { QueryResult } from '../lib/types.js'

export interface DatabaseDriver {
  /** Establece la conexion */
  connect(): Promise<void>
  /** Cierra la conexion */
  disconnect(): Promise<void>
  /** Indica si la conexion esta activa */
  isConnected(): boolean
  /** Ejecuta una sentencia SQL con parametros opcionales */
  execute(sql: string, params?: unknown[]): Promise<QueryResult>
  /** Tipo de base de datos */
  readonly type: 'postgresql' | 'mysql' | 'sqlite'
}
