import { describe, it, expect } from 'vitest'
import { extractTableAndWhere } from '../utils/sql-parser-light.js'

describe('extractTableAndWhere', () => {
  it('extrae tabla de INSERT INTO', () => {
    const result = extractTableAndWhere('INSERT INTO users (name) VALUES ($1)')
    expect(result).toEqual({ table: 'users' })
  })

  it('extrae tabla y WHERE de UPDATE', () => {
    const result = extractTableAndWhere('UPDATE users SET name = $1 WHERE id = 1')
    expect(result).toEqual({ table: 'users', where: 'id = 1' })
  })

  it('extrae tabla y WHERE de DELETE', () => {
    const result = extractTableAndWhere('DELETE FROM users WHERE active = false')
    expect(result).toEqual({ table: 'users', where: 'active = false' })
  })

  it('extrae tabla de DELETE sin WHERE', () => {
    const result = extractTableAndWhere('DELETE FROM users')
    expect(result).toEqual({ table: 'users', where: undefined })
  })

  it('extrae tabla de UPDATE sin WHERE', () => {
    const result = extractTableAndWhere('UPDATE users SET name = $1')
    expect(result).toEqual({ table: 'users', where: undefined })
  })

  it('retorna null para SELECT', () => {
    expect(extractTableAndWhere('SELECT * FROM users')).toBeNull()
  })

  it('retorna null para DDL', () => {
    expect(extractTableAndWhere('CREATE TABLE test (id INTEGER)')).toBeNull()
    expect(extractTableAndWhere('DROP TABLE test')).toBeNull()
  })

  it('soporta backticks', () => {
    const result = extractTableAndWhere('INSERT INTO `users` (name) VALUES ($1)')
    expect(result).toEqual({ table: 'users' })
  })

  it('soporta comillas dobles', () => {
    const result = extractTableAndWhere('INSERT INTO "users" (name) VALUES ($1)')
    expect(result).toEqual({ table: 'users' })
  })

  it('ignora comentarios', () => {
    const result = extractTableAndWhere('-- comentario\nINSERT INTO users (name) VALUES ($1)')
    expect(result).toEqual({ table: 'users' })
  })
})
