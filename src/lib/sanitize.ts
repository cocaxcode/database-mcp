/**
 * Sanitiza un nombre para usarlo como nombre de archivo.
 * Reemplaza caracteres no alfanuméricos por guiones.
 */
export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!sanitized) {
    throw new Error(`Nombre invalido: '${name}'`)
  }

  return sanitized
}
