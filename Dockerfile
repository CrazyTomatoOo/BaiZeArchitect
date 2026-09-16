FROM node:22-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV HOME=/tmp
ENV PI_CODING_AGENT_DIR=/app/.pi-agent

CMD ["node", "dist/cli.js"]
