/**
 * 把 `dsh-edit-turn/tools/` 里的裁剪内核同步到本插件的 `lib/vendor/`。
 *
 * 为什么是"复制"而不是"依赖"：裁剪内核（`compact-session.mjs`）和校验器
 * （`verify-session-log.mjs`）住在 dsh-edit-turn 的 `tools/` 下，而 `tools/` **不随
 * npm 包发布**（`files` 只含 `lib/`）——插件装到别人机器上时那两个文件根本不存在。
 * 所以这里复制一份进来，并改掉两处相对导入（在 `tools/` 下是 `./lib/host-libs.mjs`，
 * 复制到同一层之后是 `./host-libs.mjs`）。
 *
 * 跑法：`node scripts/sync-vendor.mjs`（发版前跑一次；源改了这里就要重跑）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(here, '..')
const source = path.resolve(pluginRoot, '..', 'dsh-edit-turn', 'tools')
const target = path.join(pluginRoot, 'lib', 'vendor')

/** 要同步的文件：源路径（相对 tools/）→ 目标文件名 + 需要替换的导入。 */
const FILES = [
  { from: 'compact-session.mjs', to: 'compact-session.mjs', rewrites: [] },
  { from: 'lib/host-libs.mjs', to: 'host-libs.mjs', rewrites: [] },
  {
    from: 'verify-session-log.mjs',
    to: 'verify-session-log.mjs',
    rewrites: [
      [`from './lib/host-libs.mjs'`, `from './host-libs.mjs'`],
      [`from './compact-session.mjs'`, `from './compact-session.mjs'`],
    ],
  },
]

fs.mkdirSync(target, { recursive: true })
for (const file of FILES) {
  const from = path.join(source, file.from)
  if (!fs.existsSync(from)) throw new Error(`源文件不存在：${from}`)
  let text = fs.readFileSync(from, 'utf8')
  // shebang 必须是文件第一行；这里会在前面加一行来源注释，所以把它去掉（作为模块导入
  // 时 shebang 本来也没有意义，但留在第二行会直接语法错误）。
  text = text.replace(/^#![^\n]*\n/, '')
  for (const [before, after] of file.rewrites) text = text.replaceAll(before, after)
  const header = `// 由 scripts/sync-vendor.mjs 从 dsh-edit-turn/tools/${file.from} 复制，请勿手改。\n`
  fs.writeFileSync(path.join(target, file.to), header + text)
  console.log(`✔ ${file.from} → lib/vendor/${file.to}`)
}
console.log(`\n共 ${FILES.length} 个文件。源目录：${source}`)
