#!/usr/bin/env bash
# Runs DiveDay's CI runners on this Mac, inside Docker, until you press Ctrl-C.
# CI sends its lint, typecheck, safeguards and unit jobs here whenever one of
# these runners is online, and to GitHub when none is
# (scripts/ci-runner-pick.mjs). The why and the one-time setup:
# docs/engineering/mac-ci-runner-runbook.md.
#
# Each runner is a fresh container that takes exactly one job and is thrown
# away (`--ephemeral` and `docker run --rm`). The one thing jobs share is the
# pnpm package store, a Docker volume this script wipes every time it starts.
# The GitHub token stays on this Mac: a container sees only a one-hour
# registration token, and unsets it before the job runs.
#
# What keeps a stranger's code off this Mac is the repository setting "Require
# approval for all external contributors" (docs/engineering/mac-ci-runner-runbook.md),
# not this script: a pull request can rewrite the workflow that picks a runner.
#
#   scripts/mac-runner/start.sh            # 4 runners
#   RUNNERS=2 scripts/mac-runner/start.sh  # fewer, on a smaller Mac
set -euo pipefail

REPO="AaronBuxbaum/diveday"
LABEL="diveday-mac"
RUNNERS="${RUNNERS:-4}"
# Per runner. Unit shards and typecheck want about 3 GB each.
MEMORY="${MEMORY:-4g}"
CPUS="${CPUS:-2}"
# GitHub's own runner image (Ubuntu 24.04, multi-arch: native on Apple silicon).
# `latest` on purpose: GitHub refuses runners more than a few releases old, and
# a pinned tag would stop registering without warning.
IMAGE="ghcr.io/actions/actions-runner:latest"
TOKEN_FILE="${DIVEDAY_RUNNER_TOKEN_FILE:-$HOME/.config/diveday/runner-token}"

if ! command -v docker > /dev/null 2>&1 || ! docker info > /dev/null 2>&1; then
  echo "Docker isn't running. Start Docker Desktop or OrbStack, then run this again." >&2
  exit 1
fi
if [ ! -s "$TOKEN_FILE" ]; then
  echo "No token at $TOKEN_FILE. Make one as the runbook says (docs/engineering/mac-ci-runner-runbook.md), then run this again." >&2
  exit 1
fi
# The token goes to curl in a file, not on its command line, where `ps` shows it.
HEADERS="$(mktemp)"
chmod 600 "$HEADERS"
printf 'Authorization: Bearer %s\nAccept: application/vnd.github+json\n' "$(tr -d '[:space:]' < "$TOKEN_FILE")" > "$HEADERS"

docker pull --quiet "$IMAGE" > /dev/null
# The pnpm store is shared between runners so a job does not download every
# package again. Wiped on every start, so nothing a job left in it outlives
# this session, and handed to the runner user by a throwaway root container,
# so the runners themselves never need root.
docker volume rm diveday-runner-pnpm > /dev/null 2>&1 || true
docker volume create diveday-runner-pnpm > /dev/null
docker run --rm --user root -v diveday-runner-pnpm:/pnpm-store "$IMAGE" chown runner:runner /pnpm-store

registration_token() {
  curl -fsS --max-time 20 -X POST -H @"$HEADERS" \
    "https://api.github.com/repos/$REPO/actions/runners/registration-token" \
    | sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p'
}

lane() {
  local n="$1"
  while true; do
    local reg
    reg="$(registration_token || true)"
    if [ -z "$reg" ]; then
      echo "runner $n: GitHub refused a registration token; trying again in 60s." >&2
      sleep 60
      continue
    fi
    # A runner registers with --disableupdate, so take a newer image when
    # GitHub has published one rather than let an old runner be refused.
    docker pull --quiet "$IMAGE" > /dev/null 2>&1 || true
    # no-new-privileges turns off the image's passwordless sudo, so a job stays
    # the unprivileged runner user. The limits keep one job from starving the rest.
    docker run --rm --name "diveday-runner-$n" \
      --security-opt no-new-privileges --cap-drop ALL \
      --memory "$MEMORY" --cpus "$CPUS" --pids-limit 4096 \
      -e REG_TOKEN="$reg" -e REPO="$REPO" -e LABEL="$LABEL" -e RUNNER_NAME="$LABEL-$n" \
      -e npm_config_store_dir=/pnpm-store \
      -v diveday-runner-pnpm:/pnpm-store \
      "$IMAGE" bash -c '
        set -e
        ./config.sh --unattended --ephemeral --replace --disableupdate \
          --url "https://github.com/$REPO" --token "$REG_TOKEN" \
          --name "$RUNNER_NAME" --labels "$LABEL" --work _work > /dev/null
        unset REG_TOKEN
        exec ./run.sh' \
      || sleep 10
  done
}

stop() {
  trap - INT TERM
  echo "Stopping runners; CI goes back to GitHub's runners."
  for n in $(seq 1 "$RUNNERS"); do docker rm -f "diveday-runner-$n" > /dev/null 2>&1 || true; done
  rm -f "$HEADERS"
  kill 0
}
trap stop INT TERM

echo "Starting $RUNNERS runners for $REPO. Leave this window open; Ctrl-C stops them."
for n in $(seq 1 "$RUNNERS"); do lane "$n" & done
wait
