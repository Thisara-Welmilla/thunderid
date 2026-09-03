#!/usr/bin/env bash
# Copyright 2025 The ThunderID Authors
# SPDX-License-Identifier: Apache-2.0
#
# Creates the AWS resources ThunderID needs: an SSH key pair, a security group, an IAM role
# that allows ECR pulls, an Elastic IP, and the EC2 instance itself. Safe to re-run; it reuses
# anything that already exists rather than creating a second copy.
#
# Usage: AWS_REGION=ap-south-1 ./install/aws/provision-aws.sh

set -euo pipefail

AWS_REGION=${AWS_REGION:-ap-south-1}
NAME=${NAME:-thunderid}
INSTANCE_TYPE=${INSTANCE_TYPE:-t3.small}
DISK_GB=${DISK_GB:-20}
KEY_PATH="$HOME/.ssh/${NAME}-aws.pem"

export AWS_PAGER=""
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "Region ${AWS_REGION}, account $(aws sts get-caller-identity --query Account --output text)"

# --- Existing instance check -------------------------------------------------
EXISTING=$(aws ec2 describe-instances --region "$AWS_REGION" \
    --filters "Name=tag:Name,Values=${NAME}" "Name=instance-state-name,Values=pending,running,stopped" \
    --query 'Reservations[].Instances[0].InstanceId' --output text)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
    say "An instance tagged ${NAME} already exists: ${EXISTING}. Reusing it."
fi

# --- SSH key pair ------------------------------------------------------------
if aws ec2 describe-key-pairs --region "$AWS_REGION" --key-names "$NAME" >/dev/null 2>&1; then
    say "Key pair ${NAME} already exists"
    [ -f "$KEY_PATH" ] || echo "WARNING: ${KEY_PATH} is missing locally. You cannot SSH in without it."
else
    say "Creating key pair ${NAME}, saving the private key to ${KEY_PATH}"
    mkdir -p "$HOME/.ssh"
    aws ec2 create-key-pair --region "$AWS_REGION" --key-name "$NAME" \
        --query KeyMaterial --output text > "$KEY_PATH"
    chmod 400 "$KEY_PATH"
fi

# --- Security group ----------------------------------------------------------
VPC_ID=$(aws ec2 describe-vpcs --region "$AWS_REGION" --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' --output text)
say "Using default VPC ${VPC_ID}"

SG_ID=$(aws ec2 describe-security-groups --region "$AWS_REGION" \
    --filters "Name=group-name,Values=${NAME}-sg" "Name=vpc-id,Values=${VPC_ID}" \
    --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG_ID" = "None" ]; then
    say "Creating security group ${NAME}-sg"
    SG_ID=$(aws ec2 create-security-group --region "$AWS_REGION" \
        --group-name "${NAME}-sg" --description "ThunderID server" --vpc-id "$VPC_ID" \
        --query GroupId --output text)
else
    say "Security group ${NAME}-sg already exists: ${SG_ID}"
fi

MY_IP=$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')
say "Opening 80 and 443 to the internet, 22 to ${MY_IP} only"
for rule in "80:0.0.0.0/0" "443:0.0.0.0/0" "22:${MY_IP}/32"; do
    port=${rule%%:*}; cidr=${rule#*:}
    aws ec2 authorize-security-group-ingress --region "$AWS_REGION" --group-id "$SG_ID" \
        --protocol tcp --port "$port" --cidr "$cidr" >/dev/null 2>&1 \
        && echo "  opened ${port} to ${cidr}" \
        || echo "  ${port} to ${cidr} already allowed"
done

# --- IAM role for ECR pulls --------------------------------------------------
if aws iam get-role --role-name "${NAME}-ec2-role" >/dev/null 2>&1; then
    say "IAM role ${NAME}-ec2-role already exists"
else
    say "Creating IAM role ${NAME}-ec2-role with ECR read access"
    aws iam create-role --role-name "${NAME}-ec2-role" \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "ec2.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }' >/dev/null
    aws iam attach-role-policy --role-name "${NAME}-ec2-role" \
        --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
    aws iam create-instance-profile --instance-profile-name "${NAME}-ec2-profile" >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name "${NAME}-ec2-profile" \
        --role-name "${NAME}-ec2-role"
    echo "  waiting for the instance profile to propagate"
    sleep 15
fi

# --- Instance ----------------------------------------------------------------
if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
    INSTANCE_ID=$EXISTING
    say "Attaching the security group and instance profile to ${INSTANCE_ID}"
    CURRENT_SGS=$(aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[].Instances[].SecurityGroups[].GroupId' --output text)
    case " $CURRENT_SGS " in
        *" $SG_ID "*) echo "  security group already attached" ;;
        *) aws ec2 modify-instance-attribute --region "$AWS_REGION" --instance-id "$INSTANCE_ID" \
               --groups $CURRENT_SGS "$SG_ID" && echo "  security group attached" ;;
    esac
    HAS_PROFILE=$(aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" \
        --query 'Reservations[].Instances[].IamInstanceProfile.Arn' --output text)
    if [ -z "$HAS_PROFILE" ] || [ "$HAS_PROFILE" = "None" ]; then
        aws ec2 associate-iam-instance-profile --region "$AWS_REGION" --instance-id "$INSTANCE_ID" \
            --iam-instance-profile "Name=${NAME}-ec2-profile" >/dev/null
        echo "  instance profile attached"
    else
        echo "  instance profile already attached: ${HAS_PROFILE}"
    fi
else
    # Looked up through EC2 rather than the SSM public parameter, because the
    # AmazonSSMReadOnlyAccess managed policy denies the /aws/ parameter namespace.
    AMI_ID=$(aws ec2 describe-images --region "$AWS_REGION" --owners amazon \
        --filters "Name=name,Values=al2023-ami-2023.*-kernel-6.1-x86_64" \
                  "Name=state,Values=available" \
        --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)
    say "Launching a ${INSTANCE_TYPE} instance from Amazon Linux 2023 (${AMI_ID})"
    INSTANCE_ID=$(aws ec2 run-instances --region "$AWS_REGION" \
        --image-id "$AMI_ID" \
        --instance-type "$INSTANCE_TYPE" \
        --key-name "$NAME" \
        --security-group-ids "$SG_ID" \
        --iam-instance-profile "Name=${NAME}-ec2-profile" \
        --block-device-mappings "[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":${DISK_GB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
        --metadata-options "HttpTokens=required" \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME}}]" \
        --query 'Instances[0].InstanceId' --output text)
    echo "  ${INSTANCE_ID} launched, waiting for it to start"
    aws ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$INSTANCE_ID"
fi

# --- Elastic IP ---------------------------------------------------------------
# The auto-assigned public IP changes across a stop/start, which would break DNS and
# invalidate the TLS certificate. An Elastic IP stays put for the life of the deployment.
ALLOC_ID=$(aws ec2 describe-addresses --region "$AWS_REGION" \
    --filters "Name=tag:Name,Values=${NAME}" \
    --query 'Addresses[0].AllocationId' --output text)
if [ "$ALLOC_ID" = "None" ]; then
    say "Allocating an Elastic IP"
    ALLOC_ID=$(aws ec2 allocate-address --region "$AWS_REGION" --domain vpc \
        --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${NAME}}]" \
        --query AllocationId --output text)
else
    say "Reusing the Elastic IP already tagged ${NAME}"
fi
aws ec2 associate-address --region "$AWS_REGION" \
    --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
PUBLIC_IP=$(aws ec2 describe-addresses --region "$AWS_REGION" \
    --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)

say "Done"
cat <<SUMMARY

  Instance     ${INSTANCE_ID}
  Public IP    ${PUBLIC_IP}
  SSH key      ${KEY_PATH}
  SSH command  ssh -i ${KEY_PATH} ec2-user@${PUBLIC_IP}

Next: point a DNS A record at ${PUBLIC_IP} (or use ${PUBLIC_IP//./-}.sslip.io), then run
install/aws/bootstrap-ec2.sh on the instance and install/aws/deploy.sh from here.
See install/aws/README.md.

SUMMARY
