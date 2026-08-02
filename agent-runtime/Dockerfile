# BaiZe Architect — 单进程本地 agent 容器。
# ponytail: 不挂载宿主 ~/.pi,容器自带 pi SDK(npm install)。bailian provider
# 已内联进 cli.ts(createProvider + registerNativeProvider),不再需 extension。
# 目标仓库与产出目录通过 compose volume 挂载,模型鉴权通过 env 透传。
FROM node:22-slim

WORKDIR /app

# 先拷清单装依赖(layer cache 友好)
COPY agent-runtime/package.json agent-runtime/package-lock.json* ./agent-runtime/
RUN cd agent-runtime && npm install

# 源码 + .pi(skills) + schemas
COPY agent-runtime ./agent-runtime
COPY .pi ./.pi
COPY schemas ./schemas

WORKDIR /app/agent-runtime

# 开发镜像直接 tsx 跑;生产再 build → node dist/cli.js
ENTRYPOINT ["npx", "tsx", "cli.ts"]
