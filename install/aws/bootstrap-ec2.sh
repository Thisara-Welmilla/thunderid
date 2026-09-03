#!/usr/bin/env bash
# Copyright 2025 The ThunderID Authors
# SPDX-License-Identifier: Apache-2.0
#
# One-time preparation of an Amazon Linux 2023 EC2 instance. Run once, as the default user.
# Requires an instance profile with AmazonEC2ContainerRegistryReadOnly attached.

set -euo pipefail

sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

# Docker Compose v2 as a CLI plugin
COMPOSE_VERSION=v2.32.4
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fsSL \
    "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

echo "Done. Log out and back in so the docker group membership takes effect."
