# syntax=docker/dockerfile:1

# ── API Lyko System (Express + MySQL) ────────────────────────────────────────
# Image de production : dépendances de prod uniquement, exécution non-root,
# migrations SQL jouées au démarrage (voir docker-entrypoint.sh).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` reproductible ; `--omit=dev` retire nodemon & co.
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini : PID 1 correct (propagation des signaux, pas de zombies).
RUN apk add --no-cache tini

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# Répertoire des fichiers téléversés (logos, cachets, signatures) — monté sur
# un volume nommé en production pour survivre aux redéploiements.
RUN mkdir -p uploads && chown -R node:node /app

USER node
EXPOSE 4000

# Healthcheck applicatif (le reverse-proxy et Compose s'y fient).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
