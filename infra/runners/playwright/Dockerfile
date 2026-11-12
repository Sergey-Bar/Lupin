FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
# Debian, not Alpine: Playwright's browsers are built against glibc and its `--with-deps`
# installer uses apt. The same pinned base `infra/docker/runner.Dockerfile` uses.
#
# PLAYWRIGHT_VERSION is the exact release the workspace locks (`pnpm-lock.yaml`), and
# manifest.json's `toolVersion` must say the same (`scripts/lib/runner-manifests.test.mjs`).
ARG PLAYWRIGHT_VERSION=1.65.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER root
WORKDIR /automation
COPY manifest.json /automation/manifest.json
# The CLI at the exact version, and Chromium with its system libraries (apt, as root), then the
# browser cache and the job directories handed to the runner user. No secret is baked in.
RUN npm install --global --no-fund --no-audit "@playwright/test@${PLAYWRIGHT_VERSION}" \
  && playwright install --with-deps chromium \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /automation/input /automation/output /automation/home \
  && chown -R 65532:65532 /automation /ms-playwright
ENV HOME=/automation/home
USER 65532:65532
WORKDIR /automation/output
# `docker run <image>` prints the version (what `oci:smoke` checks); `docker run <image> test …`
# runs a suite mounted under /automation/input.
ENTRYPOINT ["playwright"]
CMD ["--version"]
