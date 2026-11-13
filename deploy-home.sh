#!/usr/bin/env bash
set -euo pipefail

# Deploy only client/public/home.html from the active staging branch.
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-staging}"

if [[ $# -ne 1 || -z "$1" ]]; then
  printf 'Usage: %s "commit message"\n' "$0" >&2
  exit 2
fi

branch="$(git branch --show-current)"
if [[ "$branch" != "$BRANCH" ]]; then
  printf 'Refusing to deploy: expected branch %s, found %s\n' "$BRANCH" "${branch:-detached HEAD}" >&2
  exit 1
fi

if ! git diff --cached --quiet; then
  printf 'Refusing to deploy: the Git index already has staged changes. Unstage/review them first.\n' >&2
  exit 1
fi

other_changes="$(git diff --name-only -- . ':(exclude)client/public/home.html')"
if [[ -n "$other_changes" ]]; then
  printf 'Refusing to deploy: other tracked files have changes:\n%s\n' "$other_changes" >&2
  exit 1
fi

if git diff --quiet -- client/public/home.html; then
  printf 'No unstaged change found in client/public/home.html; nothing to deploy.\n' >&2
  exit 1
fi

git add -- client/public/home.html
git commit -m "$1"
git push origin "$BRANCH"

ssh deploy@2.24.99.27 \
  "cd \"\$HOME/surveil-me-not\" && git pull --ff-only origin $BRANCH && docker compose -p surveil -f deploy-surveil.yml --profile proxy up -d --build && docker compose -p surveil -f deploy-surveil.yml --profile proxy ps"
