FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
WORKDIR /app
# pnpm is not named here: Corepack reads `packageManager` from package.json, so the image uses the
# same pnpm the repository does. A pin written in this file went stale (it said 10.30.2 while the
# repository moved to 11) and was a second place to keep in step.
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@lupin/unified-web..." build


FROM nginx:1.31-alpine@sha256:785835ea65db4bba6f021acc0f3be91b0fef76a53fe41f8588c6698d2aed0606 AS runtime
ARG LUPIN_VERSION=dev
ARG LUPIN_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Sergey-Bar/Lupin" \
  org.opencontainers.image.title="lupin-web" \
  org.opencontainers.image.version="${LUPIN_VERSION}" \
  org.opencontainers.image.revision="${LUPIN_REVISION}"
# Unprivileged nginx: the stock image runs as root and writes to
# /var/cache/nginx, /var/run and the pid file. Running as `nginx` with the
# listen port moved to 8080 means the process needs no capabilities at all.
# The pid line is matched by shape and then checked: nginx 1.27 writes `/run/nginx.pid`, the
# old literal `/var/run/nginx.pid` matched nothing, and a read-only container then failed to
# start (ledger MNT-23). `grep -q` fails the build if the rewrite ever stops matching.
RUN chown -R nginx:nginx /var/cache/nginx /var/run /etc/nginx/conf.d \
  && sed -i -E 's|^pid[[:space:]]+[^;]+;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && grep -q '^pid /tmp/nginx.pid;' /etc/nginx/nginx.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
# 8080, not 80: binding a port below 1024 is the only reason the stock image runs
# as root, and dropping to `nginx` removes the reason entirely.
EXPOSE 8080
USER nginx
