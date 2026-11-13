FROM nginx:1.31-alpine@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11
ARG LUPIN_VERSION=dev
ARG LUPIN_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Sergey-Bar/Lupin" \
  org.opencontainers.image.title="lupin-edge" \
  org.opencontainers.image.version="${LUPIN_VERSION}" \
  org.opencontainers.image.revision="${LUPIN_REVISION}"
# Unprivileged, on 8080, for the same reasons as web.Dockerfile: the stock image
# runs as root only because it binds 80, and the only capability it needs
# afterwards is none.
# The pid line is matched by shape and then checked: nginx 1.27 writes `/run/nginx.pid`, the
# old literal `/var/run/nginx.pid` matched nothing, and a read-only container then failed to
# start (ledger MNT-23). `grep -q` fails the build if the rewrite ever stops matching.
# `openssl` is the certificate CLI `start lan-cert` runs in this image; nginx itself links
# libssl and needs nothing more.
RUN apk add --no-cache openssl \
  && chown -R nginx:nginx /var/cache/nginx /var/run /etc/nginx/conf.d \
  && sed -i -E 's|^pid[[:space:]]+[^;]+;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
  && grep -q '^pid /tmp/nginx.pid;' /etc/nginx/nginx.conf
COPY infra/nginx/edge.conf /etc/nginx/conf.d/default.conf
# HTTPS when a LAN certificate is mounted (see the script), and the CLI that issues one.
COPY infra/nginx/40-lupin-tls.sh /docker-entrypoint.d/40-lupin-tls.sh
COPY infra/nginx/lupin-lan-cert.sh /usr/local/bin/lupin-lan-cert
RUN chmod 0755 /docker-entrypoint.d/40-lupin-tls.sh /usr/local/bin/lupin-lan-cert
EXPOSE 8080 8443
USER nginx
# `/edge-health` rather than `/`: with TLS on, every other plain-HTTP path redirects
# (ledger MNT-197). The compose file states the same check with a start period.
HEALTHCHECK --interval=10s --timeout=5s --retries=20 CMD wget -q -O /dev/null http://127.0.0.1:8080/edge-health || exit 1
