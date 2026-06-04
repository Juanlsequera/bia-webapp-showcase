# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 · builder
#   Instala TODAS las deps (dev incluidas), compila @bia/types y la API.
#   dist/ se genera aquí y se copia al runner explícitamente porque está en
#   .gitignore (pnpm deploy --prod no la incluiría sola).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Activar pnpm via corepack (viene en Node 20)
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# ── Manifests primero → capa cacheada hasta que cambien los lock files ───────
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY tooling/typescript/              tooling/typescript/
COPY packages/types/package.json      packages/types/package.json
COPY packages/ui/package.json         packages/ui/package.json
COPY apps/api/package.json            apps/api/package.json
COPY apps/web/package.json            apps/web/package.json
COPY apps/superadmin/package.json     apps/superadmin/package.json
COPY apps/landing/package.json        apps/landing/package.json

RUN pnpm install --frozen-lockfile

# ── Código fuente ─────────────────────────────────────────────────────────────
COPY packages/types/   packages/types/
COPY apps/api/         apps/api/

# ── Compilar: tipos compartidos primero, luego NestJS ─────────────────────────
RUN pnpm --filter=@bia/types build && \
    pnpm --filter=api build

# ── Instalar solo prod deps en /standalone (sin dev, sin fuente del frontend) ─
# pnpm deploy resuelve el workspace graph y deja un directorio auto-contenido.
RUN pnpm deploy --filter=api --prod /standalone

# dist/ está en .gitignore → pnpm deploy no la incluye → copiamos explícito
RUN cp -r /app/apps/api/dist /standalone/dist

# @bia/types: pnpm deploy ya lo resuelve como workspace dep.
# Copiamos dist/ solo si no está presente (por si pnpm deploy usó symlinks en alguna versión).
RUN mkdir -p /standalone/node_modules/@bia/types/dist && \
    cp -rn /app/packages/types/dist/. /standalone/node_modules/@bia/types/dist/ 2>/dev/null || true


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 · runner
#   Imagen mínima: solo prod deps + dist compilado. Sin fuente, sin dev tools.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Usuario no-root (buena práctica de seguridad)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copiar el resultado del builder
COPY --from=builder --chown=appuser:appgroup /standalone/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /standalone/dist         ./dist
COPY --from=builder --chown=appuser:appgroup /standalone/package.json ./package.json

# Variables de entorno de producción
# PORT es inyectada por Render/Railway/Fly. Fallback a 3000 para otros deploys.
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

USER appuser

# NestJS compila a dist/main.js
CMD ["node", "dist/main"]
