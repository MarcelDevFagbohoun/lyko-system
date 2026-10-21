# syntax=docker/dockerfile:1

# ── Web Africa Immo Management (Next.js 15, App Router, sortie standalone) ───────────────
# IMPORTANT : `NEXT_PUBLIC_API_URL` est figée dans le bundle client AU BUILD.
# Elle doit être passée en --build-arg (voir compose.prod.yml) et pointer sur
# l'URL publique HTTPS de l'API (ex. https://api.mondomaine.tld).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ARG NEXT_PUBLIC_CONTACT_WHATSAPP
ENV NEXT_PUBLIC_CONTACT_WHATSAPP=${NEXT_PUBLIC_CONTACT_WHATSAPP}
ARG NEXT_PUBLIC_CONTACT_EMAIL
ENV NEXT_PUBLIC_CONTACT_EMAIL=${NEXT_PUBLIC_CONTACT_EMAIL}
ARG NEXT_PUBLIC_LEGAL_NAME
ENV NEXT_PUBLIC_LEGAL_NAME=${NEXT_PUBLIC_LEGAL_NAME}
ARG NEXT_PUBLIC_LEGAL_RCCM
ENV NEXT_PUBLIC_LEGAL_RCCM=${NEXT_PUBLIC_LEGAL_RCCM}
ARG NEXT_PUBLIC_LEGAL_IFU
ENV NEXT_PUBLIC_LEGAL_IFU=${NEXT_PUBLIC_LEGAL_IFU}
ARG NEXT_PUBLIC_LEGAL_ADDRESS
ENV NEXT_PUBLIC_LEGAL_ADDRESS=${NEXT_PUBLIC_LEGAL_ADDRESS}
ARG NEXT_PUBLIC_LEGAL_DIRECTOR
ENV NEXT_PUBLIC_LEGAL_DIRECTOR=${NEXT_PUBLIC_LEGAL_DIRECTOR}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN apk add --no-cache tini

# Sortie standalone : serveur minimal + node_modules réduit, + les assets
# statiques et le dossier public (non inclus dans standalone).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
