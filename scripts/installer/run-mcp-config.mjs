import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configure } from './mcp-config.mjs'

const agentDir = path.dirname(fileURLToPath(import.meta.url))
const { USERPROFILE: profileDir } = process.env
const mode = process.argv[2]
if (!['local', 'sync', 'remove'].includes(mode)) throw Error('Invalid installer MCP operation')
if (mode !== 'local' && !profileDir) throw Error('USERPROFILE is missing')
configure(mode, process.execPath, agentDir, profileDir)
