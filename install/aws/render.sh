#!/usr/bin/env bash
# Copyright 2025 The ThunderID Authors
# SPDX-License-Identifier: Apache-2.0
#
# Renders the config templates for this deployment's domain. Runs on the EC2 instance.
# Usage: THUNDERID_DOMAIN=id.example.com THUNDERID_IMAGE=<ecr-uri>:<tag> ./render.sh

set -euo pipefail
cd "$(dirname "$0")"

: "${THUNDERID_DOMAIN:?set THUNDERID_DOMAIN, e.g. id.example.com}"
: "${THUNDERID_IMAGE:?set THUNDERID_IMAGE, e.g. 1234.dkr.ecr.ap-south-1.amazonaws.com/thunderid:abc1234}"

mkdir -p rendered
for template in templates/*; do
    sed "s|__DOMAIN__|${THUNDERID_DOMAIN}|g" "$template" > "rendered/$(basename "$template")"
done

printf 'THUNDERID_IMAGE=%s\nTHUNDERID_DOMAIN=%s\n' "$THUNDERID_IMAGE" "$THUNDERID_DOMAIN" > .env

echo "Rendered config for ${THUNDERID_DOMAIN} using ${THUNDERID_IMAGE}"
