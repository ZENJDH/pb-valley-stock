import { build } from 'esbuild'
import { resolve } from 'node:path'
await build({
  entryPoints: ['web/server.ts'], outfile: 'web-dist/server.cjs',
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', packages: 'external',
  plugins: [{ name: 'server-secrets', setup(b) {
    b.onResolve({ filter: /^\.\/secrets$/ }, () => ({ path: resolve('web/secrets.ts') }))
  } }]
})
