// 用 esbuild 把备件链路测试打包成 node 可执行的 ESM，再直接跑。
// 测试入口：scripts/spare-service.test.ts
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSync } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const outfile = resolve(here, '../node_modules/.cache/spare-service.test.mjs')

buildSync({
  entryPoints: [resolve(here, 'spare-service.test.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  alias: { '@': resolve(here, '../src') },
  logLevel: 'warning',
})

execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
