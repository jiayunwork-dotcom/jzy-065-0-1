# syntax=docker/dockerfile:1

# ---------- 依赖 ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 构建 ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
# tsc 产出 dist，并把 schema.sql 一并拷入 dist/persistence
RUN npm run build

# ---------- 运行镜像（生产依赖 + 编译产物） ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV STORAGE=postgres
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "dist/app.js"]

# ---------- 测试镜像（含 devDependencies，对构建后的同一份 src 跑测试） ----------
FROM node:20-bookworm-slim AS test
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.test.json ./
COPY src ./src
COPY test ./test
# 默认跑全部测试；PG 集成用例由 RUN_PG_TESTS=1 开启（见 docker-compose.yml）
CMD ["npm", "test"]
