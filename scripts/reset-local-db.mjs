// Deletes the local development database so it can be rebuilt from the migrations.
// It only touches the local Wrangler state folder. It cannot reach staging or production.
import { rmSync } from 'node:fs'

rmSync('.wrangler/state/v3/d1', { recursive: true, force: true })
console.log('Local D1 database removed.')
