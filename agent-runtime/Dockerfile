# BaiZe Architect — 一次性、自闭环的容器测试镜像。
# 应用、Web、技能、工具和固定仓库全部打入镜像；运行数据只写容器 tmpfs。
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
RUN npm install -g gitnexus@1.6.6 --registry=https://registry.npmmirror.com

# 应用源码、技能、Schema、固定测试仓库与测试入口。
COPY --chown=node:node agent-runtime ./agent-runtime
COPY --chown=node:node .pi ./.pi
COPY --chown=node:node schemas ./schemas
COPY --chown=node:node fixtures ./fixtures
COPY --chown=node:node --chmod=755 scripts/smoke-gateway.mjs ./scripts/smoke-gateway.mjs

# web SPA 构建 → /app/web/dist(gateway WEB_DIST 服务;镜像自带 dist,自包含)
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install
COPY web ./web
RUN cd web && npm run build && chown -R node:node /app/web
WORKDIR /app/agent-runtime

# 开发镜像直接 tsx 跑;生产再 build → node dist/cli.js
ENTRYPOINT ["npx", "tsx", "cli.ts"]
