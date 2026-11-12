FROM ghcr.io/zaproxy/zaproxy:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af
# The tool is the base image: ZAP and `zap-baseline.py` are installed at the pinned tag and
# digest. No secret is baked in; the target arrives at run time.
USER root
WORKDIR /automation
COPY manifest.json /automation/manifest.json
COPY zap-entrypoint.sh /automation/bin/zap-entrypoint.sh
# uid 65532 needs a passwd entry, or Java's user.home is `?` and ZAP cannot create its home,
# and the upstream Firefox profile, or the client add-on hangs on `firefox -CreateProfile`.
# ZAP's own state goes to /tmp/zap, so the manifest's read-only root needs only a /tmp tmpfs
# and, for a scan, a writable /zap/wrk for the report.
RUN mkdir -p /automation/input /automation/output /automation/home /zap/wrk \
  && cp -a /home/zap/.mozilla /automation/home/.mozilla \
  && chmod 0555 /automation/bin/zap-entrypoint.sh \
  && chown -R 65532:65532 /automation /zap/wrk \
  && echo 'lupin:x:65532:65532::/automation/home:/sbin/nologin' >> /etc/passwd
USER 65532:65532
WORKDIR /zap/wrk
# `docker run <image>` prints the version; `docker run <image> -t <url> -x report.xml -m 1 -I`
# runs the baseline scan and nothing else (see zap-entrypoint.sh).
ENTRYPOINT ["/automation/bin/zap-entrypoint.sh"]
