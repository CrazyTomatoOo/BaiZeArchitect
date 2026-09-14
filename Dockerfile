FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV HOME=/tmp
ENV PI_CODING_AGENT_DIR=/app/.pi-agent

CMD ["node", "dist/cli.js"]
