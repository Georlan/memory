# PARES: produção única (React build + API SQLite na mesma origem).
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
# Cloudflare Pages não usa este Dockerfile; o Railway tem login habilitado.
ENV VITE_AUTH_ENABLED=true
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
EXPOSE 3001
# Railway volumes podem ser montados com permissões de root; manter escrita em /data.
CMD ["node", "server/index.mjs"]
