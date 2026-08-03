# T09 — SQLite 选型:node:sqlite vs better-sqlite3

## Question

BaiZe gateway(Node 22,容器 `node:22-slim`)用哪个 SQLite 存设计资产库(requirements/scenarios/use-cases/functions)?对比 node:sqlite(内置)与 better-sqlite3(原生依赖),给出选型。

## Findings

### 实测环境

- 宿主 Node `v22.23.1`;Docker daemon 未运行,容器内活体验证未执行,改用静态验证(见下)。

### node:sqlite(Node 22 状态)

- 22.5.0 引入,需 `--experimental-sqlite`;**22.13.0 起无需 flag**(23.4.0 同步移除),但仍为 experimental。Node 24+ 为 Stability 1.2 Release Candidate(v25.7.0 起),至今未标 Stable(nodejs/node#57445 仍 open)。
- 宿主实测:`require('node:sqlite')` 无 flag 直接加载,打印 `ExperimentalWarning: SQLite is an experimental feature`;`DatabaseSync` 的 exec/prepare/run/get 全部正常工作。
- API 面(实测 `Object.keys`):`DatabaseSync`、`StatementSync`、`constants`、`backup`。仅同步 API,够用但小。
- 容器:`node:22-slim` 跟随最新 22.x(≥22.13),同样无 flag 可用,但每次启动打 ExperimentalWarning。

### better-sqlite3(构建/prebuild 状态)

- 最新版 13.0.2,`engines: node >=22`,活跃维护,成熟(同步 SQLite 的事实标准)。
- **关键实测**:`npm pack better-sqlite3@13.0.2 --dry-run` 显示 tarball 内置 N-API prebuilds:`linux-x64`、`linux-arm64`、`linuxmusl-x64/arm64`、darwin、win32 全覆盖;且 package.json **无 install script**(v13 起不再走 prebuild-install/node-gyp 下载)。
- 结论:`node:22-slim` 里 `npm install better-sqlite3` 直接取 prebuilt `.node`,**不需要 python/make/g++**,slim 镜像零额外构建成本。

## Recommendation

**better-sqlite3(v13)**。

理由:gateway 持久化设计数据,要用就用 Stable 的;node:sqlite 在 Node 22 上仍是 Stability 1.1(experimental,可能随 patch 变更,且每次启动刷 ExperimentalWarning)。而选 better-sqlite3 的传统顾虑(slim 容器要装编译工具链)在 v13 已不存在——prebuilds 打进 tarball,安装即取,无 node-gyp。T02 store.ts 用它即可,无需 Dockerfile 改动。

升级路径:待项目 Node 升到 node:sqlite 标 Stable 的版本(当前 24/25 仍只是 1.2 RC),且想零依赖时,可迁到 node:sqlite——两者 API 形态相近(prepare/run/get),store.ts 单点封装即可切换。

## Risks

- better-sqlite3 是 native dep:Node 大版本升级(22→24)需等对应 prebuild 发布;N-API prebuild 通常跨大版本可用,风险低。
- 同步 API 阻塞事件循环——本场景(小规模本地库、低频读写)可接受;高并发时考虑 worker 或换 async 方案。
- node:sqlite 若坚持用:锁死 Node minor 版本,接受 experimental 状态与警告日志。
- 容器活体验证未做(Docker daemon 未运行);prebuild 结论基于 tarball 静态验证,置信度高,CI 首次构建即为最终确认。
