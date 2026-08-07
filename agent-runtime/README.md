# BaiZe Agent Runtime

单进程设计 agent 入口(`cli.ts`),跑 architect + critic 两 phase 产出 Design Package。
容器内 gitnexus 产结构化证据(generateEvidence),evidence / gene 注入 architect prompt。
**完整架构与用法见根 [`README.md`](../README.md)。**

## 运行(经根 `run.sh`,推荐)

```sh
cd .. && DASHSCOPE_API_KEY=... ./scripts/run.sh lws "你的需求"
```

## 直接跑(容器,开发用)

```sh
docker compose run --rm -v "$PWD/../lws:/repo" \
  baize --repo /repo --repo-id lws --requirement "需求"
```

## CLI 参数

```
baize --repo <path> [--repo-id id] [--requirement <text|--requirement-file f>] [--commit sha]
```

## 模块

| 文件 | 职责 |
| --- | --- |
| `cli.ts` | 入口:architect(`submit_plan`)+ critic(`record_critique`)两 phase + evidence/evolver 注入 + design-package 归档 |
| `evidence.ts` | 容器内 gitnexus 证据生成(`generateEvidence`:gitnexus analyze + extract-architecture.cjs → EvidenceDoc),cli.ts + gateway.ts 共享 |
| `evidence-candidates.ts` | `submit_plan` 后的确定性证据门禁:防路径逃逸、验证文件/符号、按源码归一化行号;无有效证据即终止 |
| `evolver-client.ts` | evolver-mcp stdio JSON-RPC 客户端(手写,未装 MCP SDK);`getEvolverClient` lazy-spawn(`BAIZE_EVOLVER=1`),`detached:true`+`SIGKILL` 进程组(防容器不退) |
| `distill-gene.ts` | design-package → `evolver_distill_conversation` → gene 落 `EVOLVER_HOME/assets`(手动跑,原 `evolve.sh` 已移除) |
| `Dockerfile` | `node:22-slim` + `npm install` pi SDK + COPY `.pi/skills` + `schemas` |

## 关键 env(继承 `compose.yaml`)

- `BAIZE_PROJECT_ROOT`(`/app`)— `.pi/skills` 所在
- `BAIZE_OUT_DIR`(`/app/out`)— design package 产出
- `BAIZE_EVIDENCE_DIR`(`/evidence`)— gitnexus `evidence.json`(容器内写)
- `RUNTIME_MODEL_PROVIDER` / `RUNTIME_MODEL_ID`(`bailian` / `glm-5.2`)
- `BAIZE_EVOLVER=1` — 启用容器内 evolver-mcp(`evolver_recall` 工具)
- `EVOLVER_HOME`(`/evolver-home`)— gene store(挂载 `./evolver-home`)

## 设计要点

- `createAgentSession({cwd: repoPath, model, modelRuntime, resourceLoader, tools, customTools})`
  — pi SDK;architect 的 `customTools` 含 `submit_plan`(`defineTool`,8 字段 schema),LLM
  调一次产结构化 plan(非 markdown 文本)。
- LLM 未调 `submit_plan` → `fallbackPlan` 兜底(evidence 空)。
- evidence 注入:`generateEvidence(repoPath, repoId)` 容器内 gitnexus 产 `/evidence/<repoId>.json` →
  `evidenceToPromptBlock` 渲染 hotspots/boundaries/clusters + 历史设计包 → prepend
  architect prompt。`read`/`grep` 仍负责行号精度(gitnexus 给结构,read/grep 给行)。
- evolver:`evolverRecallTool`(`defineTool`)`execute` 调 `getEvolverClient()` →
  `evolver_recall` → 返本机已审核 gene(空则提示先 `distill`)。
- bailian provider 内联 `createProvider`+`registerNativeProvider`(绕过 extension
  `registerProvider` 不可查 catalog);用 `modelRuntime.getModel`(非 deprecated `getModel`)。

## 开发

```sh
npm install && npx tsc --noEmit   # 类型检查
```

> 旧 HTTP adapter(`server.ts`,`POST /runtime/plan`,anthropic)已废弃——见 git 历史与
> 根 `README.md` 的 refactor 说明。
