/**
 * Shared MCP tool response helpers.
 */

export const text = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
})

export const error = (t: string) => ({
  content: [{ type: 'text' as const, text: `Error: ${t}` }],
  isError: true as const,
})
