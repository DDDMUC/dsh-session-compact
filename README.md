# dsh-session-compact

启动时自动裁掉空闲会话的历史窗口：只保留最后 N 个窗口，把模型早已看不到的那部分从日志里切掉，**裁剪结果先过宿主自己的三层校验器，验不过就不落盘**。

## 为什么需要它

DSH 的会话日志是只增不减的，而宿主的压缩是**累积**的：每个检查点覆盖前一个，所以更早的窗口对模型早已不可见——它们还压在日志里、还占着对话区的长度。实测一个长会话：

```
裁剪前   13.2 MB   29,497 事件   10 个窗口
裁剪后    4.8 MB    9,302 事件    3 个窗口
模型视图  1000 → 1000（完全不变）
```

**模型看到的内容一条都没少**，少掉的只是"已经折叠进摘要里的旧窗口"。

## 为什么要在"启动时"做

宿主只要打开过某个会话（侧栏点开、标签页恢复），就会持有它的 `session.lock`，**直到进程退出**——切换对话、关掉标签页都不会释放。此时改文件会被随后的写入覆盖。

于是"宿主刚启动、会话还没被打开"是唯一稳定可用的窗口。本插件就在这个窗口里扫一遍。

## 它做什么

1. 列出会话根目录下的所有 `session.v*.jsonl.zstd`；
2. **跳过被持有的**（`session.lock` 被打开）——正在用的会话永远不碰；
3. 试算：裁到 `keepWindows` 会丢多少条、**模型视图会不会变**；
4. 过阈值才动手（条数、占比、模型视图不变）；
5. **先验后写**：裁剪结果写到暂存文件，用宿主自己的校验器验六项——格式层（`dsh-session-format-v3-to-v4`）、会话层（`dsh-session` 的 `adoptSessionEvent` + `foldSurface`）、交叉引用、inbox 投影、结构、标题。任何一项不过就删掉暂存文件，原文件一个字节都不动；
6. 通过才把原文件改名成 `<日志>.precompact-<时间戳>`，暂存文件上位；
7. 按 `backupKeep` 清理旧备份（只动自己命名的那批）。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `scanOnBoot` | `true` | 启动时自动扫一遍 |
| `keepWindows` | `3` | 保留最后几个窗口（只数带检查点的对话窗） |
| `minDroppableEvents` | `500` | 可丢弃事件数低于它就跳过 |
| `minRatio` | `0.2` | 可丢弃占比低于它就跳过 |
| `requireModelUnchanged` | `true` | 模型视图会变就保守跳过 |
| `dryRun` | `false` | 只报告不落盘 |
| `backupKeep` | `1` | 每个日志保留几份备份（`0` = 全留） |
| `sessionsRoot` | `~/.dsh/sessions` | 会话根目录 |

## 路由（仅本机）

```
GET  /api/dsh-session-compact/status   上次扫描结果 + 生效配置
POST /api/dsh-session-compact/run      立刻再扫一遍
```

想手动裁一次又不想等重启：关掉那个会话的标签页（若宿主仍未释放，就退出宿主后在终端跑 `dsh-edit-turn` 的 `tools/compact-session.mjs --apply`）。

## 出问题怎么回退

裁剪前的原文件都在旁边：

```sh
cd ~/.dsh/sessions/<工作区目录>/<会话目录>/
mv session.v4.jsonl.zstd.precompact-<时间戳> session.v4.jsonl.zstd
```

备份是本插件**改名**出来的，不是复制，所以恢复就是改回名字。

## 裁剪内核的来源

`lib/vendor/` 里的三个文件由 `scripts/sync-vendor.mjs` 从
[dsh-edit-turn](https://github.com/DDDMUC/dsh-edit-turn) 的 `tools/` 复制而来（那份 `tools/`
不随 npm 包发布，所以必须复制进来）：

- `compact-session.mjs` —— 窗口裁剪与引用重编（切点退到 `turn/start`、轮次步骤重编号、所有 `*Seq`/`*Seqs`/`*Range` 交叉引用统一重编、compaction 记账按表面现算……）
- `verify-session-log.mjs` —— 六项校验
- `host-libs.mjs` —— 从 `app.asar` 按需取出宿主的校验器（数据段起点是 `8 + headerSize`）

源改了就跑一次 `npm run sync:vendor`。

## 已知边界

- 裁剪**只改日志**：对话区里更早的窗口就看不到了（这是裁剪的语义）。模型侧无损失。
- 被宿主持有的会话一律跳过，所以"启动时没被打开的会话"才会被裁；宿主若恢复了标签页，那些会话要等下一次启动。
- 每次扫描要读全部日志（实测 92 个会话约 20 秒，在启动后台跑）。

## English

Compacts idle DSH session logs at startup: keeps the last N windows and drops the ones the model can no longer see. Every result is validated with the host's own format, session and projection validators before it is written; a failed validation leaves the original file untouched. Sessions held by the host (`session.lock`) are always skipped, and the original is kept as `<log>.precompact-<stamp>`.
