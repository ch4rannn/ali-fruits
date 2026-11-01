import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    plugins: [
      cloudflareTest({
        // A small config of its own, so tests never touch deployment settings or built assets.
        wrangler: { configPath: './tests/wrangler.test.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, BOOTSTRAP_TOKEN: 'test-bootstrap-token' } },
      }),
    ],
    test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000 },
  }
})
