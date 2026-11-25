import '../../mcp/register-ts.mjs'

const { createCloudServer, main } = await import('./http.mjs')
export { createCloudServer }
await main()
