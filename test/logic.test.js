import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS, listLogs, planTrim, pruneBackups, resolveConfig } from '../lib/index.js'

test('配置：默认值齐全，非法值被忽略，sessionsRoot 有兜底', () => {
  const resolved = resolveConfig({})
  assert.equal(resolved.keepWindows, DEFAULTS.keepWindows)
  assert.ok(resolved.sessionsRoot.endsWith(path.join('.dsh', 'sessions')), '默认指向 ~/.dsh/sessions')
  const custom = resolveConfig({ keepWindows: 2, minRatio: 0.5, dryRun: true, minDroppableEvents: -5, keepWindowsBad: 1 })
  assert.equal(custom.keepWindows, 2)
  assert.equal(custom.minRatio, 0.5)
  assert.equal(custom.dryRun, true)
  assert.equal(custom.minDroppableEvents, DEFAULTS.minDroppableEvents, '负数不接受')
})

test('判定：窗口不够不裁', () => {
  const config = resolveConfig({})
  const plan = planTrim({ events: 1000, windows: 3, droppable: 900, modelBefore: 10, modelAfter: 10 }, config)
  assert.equal(plan.should, false)
  assert.match(plan.reason, /只有 3 个窗口/)
})

test('判定：可丢弃条数或占比不够不裁', () => {
  const config = resolveConfig({})
  assert.equal(planTrim({ events: 10000, windows: 8, droppable: 499, modelBefore: 10, modelAfter: 10 }, config).should, false)
  const lowRatio = planTrim({ events: 100000, windows: 8, droppable: 600, modelBefore: 10, modelAfter: 10 }, config)
  assert.equal(lowRatio.should, false)
  assert.match(lowRatio.reason, /占比/)
})

test('判定：模型视图会变就保守跳过', () => {
  const config = resolveConfig({})
  const plan = planTrim({ events: 10000, windows: 8, droppable: 5000, modelBefore: 900, modelAfter: 800 }, config)
  assert.equal(plan.should, false)
  assert.match(plan.reason, /模型视图会变/)
  const allowed = planTrim({ events: 10000, windows: 8, droppable: 5000, modelBefore: 900, modelAfter: 800 }, resolveConfig({ requireModelUnchanged: false }))
  assert.equal(allowed.should, true)
})

test('判定：都满足就裁，并说明理由', () => {
  const plan = planTrim({ events: 29497, windows: 10, droppable: 20116, modelBefore: 1000, modelAfter: 1000 }, resolveConfig({}))
  assert.equal(plan.should, true)
  assert.match(plan.reason, /窗口 10 → 3/)
  assert.match(plan.reason, /68\.2%/)
})

test('列举：只认会话日志文件名，目录结构不对就跳过', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compact-list-'))
  const workspace = path.join(root, '--Users-x--')
  const session = path.join(workspace, 'session-aaaa')
  fs.mkdirSync(session, { recursive: true })
  fs.writeFileSync(path.join(session, 'session.v4.jsonl.zstd'), 'x')
  fs.writeFileSync(path.join(session, 'session.lock'), '')
  fs.writeFileSync(path.join(session, 'session.v4.jsonl.zstd.precompact-2026'), 'backup')
  fs.writeFileSync(path.join(workspace, 'loose.txt'), 'x')
  const logs = listLogs(root)
  assert.deepEqual(logs, [path.join(session, 'session.v4.jsonl.zstd')], '备份和锁文件不算会话日志')
})

test('备份清理：只留最新 N 份，且只动自己命名的那批', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-compact-prune-'))
  const log = path.join(dir, 'session.v4.jsonl.zstd')
  fs.writeFileSync(log, 'x')
  for (const stamp of ['2026-01-01', '2026-01-02', '2026-01-03']) fs.writeFileSync(`${log}.precompact-${stamp}`, stamp)
  fs.writeFileSync(`${log}.broken-2026-01-01`, '别人的备份，不许动')
  const removed = pruneBackups(log, 1)
  assert.deepEqual(removed, ['session.v4.jsonl.zstd.precompact-2026-01-01', 'session.v4.jsonl.zstd.precompact-2026-01-02'])
  assert.equal(fs.existsSync(`${log}.precompact-2026-01-03`), true, '最新的留着')
  assert.equal(fs.existsSync(`${log}.broken-2026-01-01`), true, '不碰别人命名的文件')
})
