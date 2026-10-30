FROM node:24.22.1-alpine AS build
WORKDIR /src
# Corepack reads `packageManager` from package.json, so the image uses the repository's pnpm.
RUN corepack enable
COPY . .
# Build the worker and its workspace dependencies, then write only what it runs to /out
# (`deploy --prod`; see api.Dockerfile).
RUN pnpm install --frozen-lockfile \
  && pnpm --filter "@lupin/worker..." build \
  && pnpm --filter "@lupin/worker" --prod deploy --legacy /out


FROM node:24.22.1-alpine AS runtime
ARG LUPIN_VERSION=dev
ARG LUPIN_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Sergey-Bar/Lupin" \
  org.opencontainers.image.title="lupin-worker" \
  org.opencontainers.image.version="${LUPIN_VERSION}" \
  org.opencontainers.image.revision="${LUPIN_REVISION}"
WORKDIR /app
COPY --from=build --chown=node:node /out ./
ENV NODE_ENV=production
# The artifact volume mounts here and must be writable by `node`.
RUN mkdir -p /var/lib/lupin/artifacts \
  && chown -R node:node /var/lib/lupin
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
