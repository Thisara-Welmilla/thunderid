#!/usr/bin/env bash
# Copyright 2025 The ThunderID Authors
# SPDX-License-Identifier: Apache-2.0
#
# Pushes the current branch, then builds and deploys it in AWS CodeBuild, following the
# build until it finishes. Nothing is built locally.
#
# Usage: AWS_REGION=ap-south-1 ./install/aws/cloud-deploy.sh

set -euo pipefail

AWS_REGION=${AWS_REGION:-ap-south-1}
PROJECT=${PROJECT:-thunderid}
export AWS_PAGER=""

BRANCH=$(git rev-parse --abbrev-ref HEAD)

# CodeBuild builds what is on GitHub, not the working tree, so refuse to deploy silently
# stale code when there are uncommitted changes.
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "You have uncommitted changes. CodeBuild builds the pushed commit, so they would" >&2
    echo "not be included. Commit them first, or use install/aws/deploy.sh to build locally." >&2
    git status --short >&2
    exit 1
fi

echo "==> Pushing ${BRANCH}"
git push origin "$BRANCH"
SHA=$(git rev-parse HEAD)

echo "==> Starting the build for ${SHA:0:9}"
BUILD_ID=$(aws codebuild start-build --region "$AWS_REGION" \
    --project-name "$PROJECT" --source-version "$SHA" \
    --query 'build.id' --output text)
echo "    ${BUILD_ID}"
echo "    console: https://${AWS_REGION}.console.aws.amazon.com/codesuite/codebuild/projects/${PROJECT}/build/${BUILD_ID//:/%3A}"

PHASE=""
while true; do
    read -r STATUS NEW_PHASE < <(aws codebuild batch-get-builds --region "$AWS_REGION" --ids "$BUILD_ID" \
        --query 'builds[0].[buildStatus,currentPhase]' --output text)
    if [ "$NEW_PHASE" != "$PHASE" ]; then
        PHASE=$NEW_PHASE
        echo "    ${PHASE}"
    fi
    [ "$STATUS" = "IN_PROGRESS" ] || break
    sleep 15
done

echo "==> Build ${STATUS}"
if [ "$STATUS" != "SUCCEEDED" ]; then
    echo "Last 40 log lines:"
    GROUP=$(aws codebuild batch-get-builds --region "$AWS_REGION" --ids "$BUILD_ID" \
        --query 'builds[0].logs.groupName' --output text)
    STREAM=$(aws codebuild batch-get-builds --region "$AWS_REGION" --ids "$BUILD_ID" \
        --query 'builds[0].logs.streamName' --output text)
    aws logs get-log-events --region "$AWS_REGION" --log-group-name "$GROUP" \
        --log-stream-name "$STREAM" --limit 40 --query 'events[].message' --output text
    exit 1
fi
