# BaiZe Architect — 单进程本地 agent 容器。
# ponytail: 不挂载宿主 ~/.pi,容器自带 pi SDK(npm install)。bailian provider
# 已内联进 cli.ts(createProvider + registerNativeProvider),不再需 extension。
# 目标仓库与产出目录通过 compose volume 挂载,模型鉴权通过 env 透传。
FROM node:22-slim

# better-sqlite3 原生编译(prebuild 未命中 arm64 时回退 node-gyp,slim 无 build tools)。
# git 用于证据快照 head_sha 捕获(node:22-slim 不含 git)。
# 用清华镜像加速 apt(build 容器无法走宿主 127.0.0.1 proxy);unset proxy 避免 127.0.0.1 不可达。
RUN sed -i 's|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's|http://deb.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' /etc/apt/sources.list.d/debian.sources && \
    env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY apt-get update && \
    env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY apt-get install -y --no-install-recommends python3 make g++ git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先拷清单装依赖(layer cache 友好)
COPY agent-runtime/package.json agent-runtime/package-lock.json* ./agent-runtime/
RUN cd agent-runtime && npm install && \
	cd node_modules/better-sqlite3 && npm run build-release && rm -rf prebuilds && \
	cd /app/agent-runtime

# 容器内仓库索引(自动化证据生成):GitNexus(node,tree-sitter native,预计算聚类/impact)
RUN npm install -g gitnexus

# 源码 + .pi(skills) + schemas
COPY agent-runtime ./agent-runtime
COPY .pi ./.pi
COPY schemas ./schemas

# web SPA 构建 → /app/web/dist(gateway WEB_DIST 服务;镜像自带 dist,自包含)
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install
COPY web ./web
RUN cd web && npm run build
WORKDIR /app/agent-runtime

# 开发镜像直接 tsx 跑;生产再 build → node dist/cli.js
ENTRYPOINT ["npx", "tsx", "cli.ts"]
