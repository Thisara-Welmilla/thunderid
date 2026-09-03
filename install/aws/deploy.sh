#!/usr/bin/env bash
# Copyright 2025 The ThunderID Authors
# SPDX-License-Identifier: Apache-2.0
#
# Builds the current working tree into a linux/amd64 image, pushes it to Amazon ECR,
# and rolls the EC2 deployment onto it. Run from the repository root on your own machine.
#
#   AWS_REGION=ap-south-1 \
#   ECR_REPO=760660183958.dkr.ecr.ap-south-1.amazonaws.com/thunderid \
#   THUNDERID_HOST=ec2-user@13.233.49.44 \
#   THUNDERID_DOMAIN=13-233-49-44.sslip.io \
#   SSH_KEY=~/.ssh/thunderid-aws.pem \
#   ./install/aws/deploy.sh
#
# SKIP_BUILD=1 rolls the Compose and config changes without rebuilding, keeping the image
# the instance already runs. IMAGE_TAG=<tag> pins an existing tag, for a rollback.

set -euo pipefail

: "${AWS_REGION:?set AWS_REGION}"
: "${ECR_REPO:?set ECR_REPO, e.g. <account>.dkr.ecr.<region>.amazonaws.com/thunderid}"
: "${THUNDERID_HOST:?set THUNDERID_HOST, e.g. ec2-user@1.2.3.4}"
: "${THUNDERID_DOMAIN:?set THUNDERID_DOMAIN, e.g. id.example.com}"

SSH_OPTS=()
if [ -n "${SSH_KEY:-}" ]; then
    SSH_OPTS=(-i "${SSH_KEY/#\~/$HOME}")
fi
ssh_run() { ssh "${SSH_OPTS[@]}" "$THUNDERID_HOST" "$@"; }

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Tag from the commit, marked dirty when the working tree carries uncommitted changes,
# so a redeployed tag is never silently different from the last one.
TAG=$(git rev-parse --short HEAD)
if ! git diff --quiet || ! git diff --cached --quiet; then
    TAG="${TAG}-dirty-$(date +%Y%m%d%H%M%S)"
fi
IMAGE="${ECR_REPO}:${TAG}"

if [ -n "${IMAGE_TAG:-}" ]; then
    IMAGE="${ECR_REPO}:${IMAGE_TAG}"
    echo "==> Using the existing image ${IMAGE}"
elif [ -n "${SKIP_BUILD:-}" ]; then
    IMAGE=$(ssh_run 'grep THUNDERID_IMAGE ~/thunderid/.env | cut -d= -f2')
    echo "==> Skipping the build, keeping ${IMAGE}"
else
    echo "==> Building ${IMAGE} (linux/amd64) from the current working tree"
    aws ecr get-login-password --region "$AWS_REGION" \
        | docker login --username AWS --password-stdin "${ECR_REPO%%/*}"
    docker buildx build --platform linux/amd64 -t "$IMAGE" --push .
fi

echo "==> Syncing deployment files to ${THUNDERID_HOST}"
ssh_run 'mkdir -p ~/thunderid'
rsync -a --delete -e "ssh ${SSH_OPTS[*]}" \
    --exclude rendered --exclude .env \
    install/aws/ "${THUNDERID_HOST}:thunderid/"

echo "==> Rolling ${THUNDERID_HOST} onto ${IMAGE##*:}"
ssh_run "
    set -euo pipefail
    cd ~/thunderid
    THUNDERID_DOMAIN='${THUNDERID_DOMAIN}' THUNDERID_IMAGE='${IMAGE}' ./render.sh
    aws ecr get-login-password --region '${AWS_REGION}' \
        | docker login --username AWS --password-stdin '${ECR_REPO%%/*}'
    docker compose pull
    docker compose up -d --remove-orphans
"

echo "==> Deployed ${IMAGE##*:} to https://${THUNDERID_DOMAIN}"
