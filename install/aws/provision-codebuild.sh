#!/usr/bin/env bash
# Copyright 2025 The ThunderID Authors
# SPDX-License-Identifier: Apache-2.0
#
# Sets up AWS CodeBuild so images are built in the cloud instead of on a laptop, then
# deployed to the EC2 instance over SSM. Safe to re-run.
#
# Usage:
#   AWS_REGION=ap-south-1 \
#   ECR_REPO=760660183958.dkr.ecr.ap-south-1.amazonaws.com/thunderid \
#   GITHUB_REPO=IsuruUvi/thunderid \
#   THUNDERID_DOMAIN=13-233-49-44.sslip.io \
#   ./install/aws/provision-codebuild.sh

set -euo pipefail

AWS_REGION=${AWS_REGION:-ap-south-1}
NAME=${NAME:-thunderid}
BRANCH=${BRANCH:-main}
# MEDIUM (4 vCPU / 7 GB) handles the Go and frontend builds comfortably at half the
# per-minute cost of LARGE. Override with COMPUTE=BUILD_GENERAL1_LARGE for faster builds.
COMPUTE=${COMPUTE:-BUILD_GENERAL1_MEDIUM}

: "${ECR_REPO:?set ECR_REPO}"
: "${GITHUB_REPO:?set GITHUB_REPO, e.g. IsuruUvi/thunderid}"
: "${THUNDERID_DOMAIN:?set THUNDERID_DOMAIN}"

export AWS_PAGER=""
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
INSTANCE_ID=$(aws ec2 describe-instances --region "$AWS_REGION" \
    --filters "Name=tag:Name,Values=${NAME}" "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[0].InstanceId' --output text)
[ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "None" ] || { echo "No running instance tagged ${NAME}"; exit 1; }
say "Account ${ACCOUNT}, region ${AWS_REGION}, instance ${INSTANCE_ID}"

# --- Let the instance be managed by SSM, so CodeBuild can trigger the deploy -----------
say "Granting the instance role SSM managed-instance access"
aws iam attach-role-policy --role-name "${NAME}-ec2-role" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
echo "  attached (idempotent)"

# --- CodeBuild service role ------------------------------------------------------------
ROLE="${NAME}-codebuild-role"
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    say "IAM role ${ROLE} already exists"
else
    say "Creating IAM role ${ROLE}"
    aws iam create-role --role-name "$ROLE" \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "codebuild.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }' >/dev/null
fi

say "Writing the ${ROLE} permissions policy"
aws iam put-role-policy --role-name "$ROLE" --policy-name "${NAME}-codebuild-policy" \
    --policy-document "{
        \"Version\": \"2012-10-17\",
        \"Statement\": [
            {
                \"Sid\": \"Logs\",
                \"Effect\": \"Allow\",
                \"Action\": [\"logs:CreateLogGroup\", \"logs:CreateLogStream\", \"logs:PutLogEvents\"],
                \"Resource\": \"arn:aws:logs:${AWS_REGION}:${ACCOUNT}:log-group:/aws/codebuild/${NAME}*\"
            },
            {
                \"Sid\": \"EcrAuth\",
                \"Effect\": \"Allow\",
                \"Action\": \"ecr:GetAuthorizationToken\",
                \"Resource\": \"*\"
            },
            {
                \"Sid\": \"EcrPush\",
                \"Effect\": \"Allow\",
                \"Action\": [
                    \"ecr:BatchCheckLayerAvailability\",
                    \"ecr:CompleteLayerUpload\",
                    \"ecr:InitiateLayerUpload\",
                    \"ecr:PutImage\",
                    \"ecr:UploadLayerPart\",
                    \"ecr:BatchGetImage\",
                    \"ecr:GetDownloadUrlForLayer\"
                ],
                \"Resource\": \"arn:aws:ecr:${AWS_REGION}:${ACCOUNT}:repository/${NAME}\"
            },
            {
                \"Sid\": \"DeployViaSsm\",
                \"Effect\": \"Allow\",
                \"Action\": [\"ssm:SendCommand\"],
                \"Resource\": [
                    \"arn:aws:ec2:${AWS_REGION}:${ACCOUNT}:instance/${INSTANCE_ID}\",
                    \"arn:aws:ssm:${AWS_REGION}::document/AWS-RunShellScript\"
                ]
            },
            {
                \"Sid\": \"ReadSsmResult\",
                \"Effect\": \"Allow\",
                \"Action\": [\"ssm:GetCommandInvocation\", \"ssm:ListCommandInvocations\"],
                \"Resource\": \"*\"
            }
        ]
    }"
echo "  policy written"

# --- CodeBuild project -----------------------------------------------------------------
ENV_VARS="[
    {\"name\":\"ECR_REPO\",\"value\":\"${ECR_REPO}\"},
    {\"name\":\"INSTANCE_ID\",\"value\":\"${INSTANCE_ID}\"},
    {\"name\":\"THUNDERID_DOMAIN\",\"value\":\"${THUNDERID_DOMAIN}\"},
    {\"name\":\"GITHUB_REPO\",\"value\":\"${GITHUB_REPO}\"}
]"
ENVIRONMENT="{
    \"type\": \"LINUX_CONTAINER\",
    \"image\": \"aws/codebuild/amazonlinux2-x86_64-standard:5.0\",
    \"computeType\": \"${COMPUTE}\",
    \"privilegedMode\": true,
    \"environmentVariables\": ${ENV_VARS}
}"
SOURCE="{
    \"type\": \"GITHUB\",
    \"location\": \"https://github.com/${GITHUB_REPO}.git\",
    \"buildspec\": \"install/aws/buildspec.yml\",
    \"gitCloneDepth\": 1,
    \"reportBuildStatus\": false
}"

if aws codebuild batch-get-projects --region "$AWS_REGION" --names "$NAME" \
        --query 'projects[0].name' --output text 2>/dev/null | grep -q "^${NAME}$"; then
    say "Updating CodeBuild project ${NAME}"
    aws codebuild update-project --region "$AWS_REGION" --name "$NAME" \
        --source "$SOURCE" --source-version "$BRANCH" \
        --artifacts '{"type":"NO_ARTIFACTS"}' \
        --environment "$ENVIRONMENT" \
        --service-role "arn:aws:iam::${ACCOUNT}:role/${ROLE}" \
        --timeout-in-minutes 60 \
        --cache '{"type":"LOCAL","modes":["LOCAL_DOCKER_LAYER_CACHE","LOCAL_SOURCE_CACHE"]}' \
        --query 'project.name' --output text
else
    say "Creating CodeBuild project ${NAME}"
    aws codebuild create-project --region "$AWS_REGION" --name "$NAME" \
        --source "$SOURCE" --source-version "$BRANCH" \
        --artifacts '{"type":"NO_ARTIFACTS"}' \
        --environment "$ENVIRONMENT" \
        --service-role "arn:aws:iam::${ACCOUNT}:role/${ROLE}" \
        --timeout-in-minutes 60 \
        --cache '{"type":"LOCAL","modes":["LOCAL_DOCKER_LAYER_CACHE","LOCAL_SOURCE_CACHE"]}' \
        --query 'project.name' --output text
fi

say "Done"
cat <<SUMMARY

Build and deploy the pushed ${BRANCH} branch:

  aws codebuild start-build --region ${AWS_REGION} --project-name ${NAME}

Follow it:

  aws codebuild batch-get-builds --region ${AWS_REGION} --ids <build-id> \\
      --query 'builds[0].{phase:currentPhase,status:buildStatus}'

Or use install/aws/cloud-deploy.sh, which pushes, starts the build, and tails the log.

SUMMARY
