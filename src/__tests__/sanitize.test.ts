import { describe, it, expect } from 'vitest'
import { sanitizeName } from '../lib/sanitize.js'

describe('sanitizeName', () => {
  it('pasa nombres limpios sin cambio', () => {
    expect(sanitizeName('local-pg')).toBe('local-pg')
  })

  it('convierte a minusculas', () => {
    expect(sanitizeName('MyDatabase')).toBe('mydatabase')
  })

  it('reemplaza caracteres especiales', () => {
    expect(sanitizeName('prod server #1')).toBe('prod-server-1')
  })

  it('colapsa guiones multiples', () => {
    expect(sanitizeName('a---b')).toBe('a-b')
  })

  it('elimina guiones al inicio y final', () => {
    expect(sanitizeName('-test-')).toBe('test')
  })

  it('permite underscore y numeros', () => {
    expect(sanitizeName('db_prod_2')).toBe('db_prod_2')
  })

  it('lanza error con nombre vacio', () => {
    expect(() => sanitizeName('')).toThrow('Nombre invalido')
  })

  it('lanza error con solo caracteres especiales', () => {
    expect(() => sanitizeName('!!!')).toThrow('Nombre invalido')
  })
})
