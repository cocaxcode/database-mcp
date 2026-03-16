import type { Storage } from '../lib/storage.js'
import type { DatabaseDriver } from '../drivers/interface.js'
import { resolveDriver } from '../drivers/registry.js'

/**
 * Gestiona la conexion activa, lazy connect, y cache del driver.
 */
export class ConnectionManager {
  private readonly storage: Storage
  private activeDriver: DatabaseDriver | null = null
  private activeConnName: string | null = null

  constructor(storage: Storage) {
    this.storage = storage
  }

  /**
   * Obtiene el driver activo. Si no hay driver conectado o la conexion cambio,
   * resuelve la conexion activa, crea el driver y conecta.
   */
  async getActiveDriver(project?: string): Promise<DatabaseDriver> {
    const connName = await this.storage.getActiveConnection(project)
    if (!connName) {
      throw new Error('No hay conexion activa. Usa conn_create y conn_switch para configurar una.')
    }

    // Si ya tenemos el driver correcto y conectado, reutilizar
    if (this.activeDriver && this.activeConnName === connName && this.activeDriver.isConnected()) {
      return this.activeDriver
    }

    // Desconectar driver anterior si hay
    await this.disconnectActive()

    const conn = await this.storage.getConnection(connName)
    if (!conn) {
      throw new Error(`Conexion '${connName}' no encontrada en storage`)
    }

    const driver = resolveDriver(conn)
    await driver.connect()

    this.activeDriver = driver
    this.activeConnName = connName
    return driver
  }

  /**
   * Desconecta el driver activo.
   */
  async disconnectActive(): Promise<void> {
    if (this.activeDriver?.isConnected()) {
      await this.activeDriver.disconnect()
    }
    this.activeDriver = null
    this.activeConnName = null
  }

  /**
   * Nombre de la conexion activa en cache.
   */
  getActiveConnectionName(): string | null {
    return this.activeConnName
  }

  /**
   * Indica si hay un driver conectado.
   */
  isConnected(): boolean {
    return this.activeDriver?.isConnected() ?? false
  }
}
