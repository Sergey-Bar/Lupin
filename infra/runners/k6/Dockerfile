FROM grafana/k6:2.4.0@sha256:d41bb79cd8de5a7ad619b53570e3712633e8bff0937010a5c6c57a4747e7a276
# The tool is the base image: k6 is already installed at the pinned tag and digest. Nothing is
# added but the job directories, and no secret is baked in; a job's target and script arrive
# at run time (`apps/runner/src/k6-execution.ts` builds the argv).
USER root
WORKDIR /automation
COPY manifest.json /automation/manifest.json
RUN mkdir -p /automation/input /automation/output && chown -R 65532:65532 /automation
USER 65532:65532
WORKDIR /automation/output
# `docker run <image>` prints the version (what `oci:smoke` checks); `docker run <image> run …`
# runs a script. The entrypoint is k6 itself, not a shell.
ENTRYPOINT ["k6"]
CMD ["version"]
