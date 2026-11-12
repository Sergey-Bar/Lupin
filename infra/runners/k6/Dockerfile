FROM grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8
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
