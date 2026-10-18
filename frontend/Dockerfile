# AUREX web (Next.js standalone server).
# Build:  docker build -t aurex-web --build-arg AUREX_API_URL=http://api:8000 ./frontend
# AUREX_API_URL is baked into the /api/* rewrite at build time (next.config.ts), so it must name the API
# as reachable from the web container.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


FROM node:22-alpine AS build
WORKDIR /app
ARG AUREX_API_URL=http://api:8000
ENV AUREX_API_URL=${AUREX_API_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 10001 aurex && adduser -S -u 10001 -G aurex aurex

COPY --from=build --chown=aurex:aurex /app/public ./public
COPY --from=build --chown=aurex:aurex /app/.next/standalone ./
COPY --from=build --chown=aurex:aurex /app/.next/static ./.next/static

USER aurex
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
