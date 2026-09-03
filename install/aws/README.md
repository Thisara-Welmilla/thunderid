# ThunderID on AWS EC2

Runs ThunderID on a single EC2 instance behind [Caddy](https://caddyserver.com/), which obtains and
renews a Let's Encrypt certificate for your domain automatically. Images are pushed to Amazon ECR,
so the instance only ever pulls.

This page covers first-time infrastructure setup. For the day-to-day loop of shipping a code
change, and for when the public URL does and does not change, see [DEPLOYING.md](DEPLOYING.md).

## Layout

| Path | Purpose |
|---|---|
| `provision-aws.sh` | Run locally, once. Creates the key pair, security group, IAM role, Elastic IP, and instance. |
| `bootstrap-ec2.sh` | Run once on the instance. Installs Docker and Compose. |
| `deploy.sh` | Run locally. Builds the working tree, pushes to ECR, rolls the instance. |
| `provision-codebuild.sh` | Run locally, once. Creates the CodeBuild project that builds in the cloud. |
| `cloud-deploy.sh` | Run locally. Pushes the branch, then builds and deploys in CodeBuild. |
| `buildspec.yml` | What CodeBuild runs: build, push to ECR, deploy over SSM. |
| `render.sh` | Run on the instance by `deploy.sh`. Fills the domain into the templates. |
| `templates/` | Config with a `__DOMAIN__` placeholder. |
| `rendered/` | Generated on the instance. Not synced, not committed. |
| `docker-compose.yml` | The four services: db-init, setup, server, Caddy. |

## Prerequisites

**On your machine:** Docker with buildx, the AWS CLI, `rsync`, and SSH access. The image build
compiles the Go backend and the React frontend, so give Docker at least 4 GB of memory.

**On AWS**, an ECR repository and an instance:

```bash
aws ecr create-repository --repository-name thunderid --region ap-south-1
AWS_REGION=ap-south-1 ./install/aws/provision-aws.sh
```

`provision-aws.sh` is idempotent: it reuses an existing key pair, security group, role, Elastic IP,
or instance tagged `thunderid` rather than creating a second one, so re-running it is how you repair
a partial setup. It creates:

| Resource | Detail |
|---|---|
| Key pair `thunderid` | Private key saved to `~/.ssh/thunderid-aws.pem` |
| Security group `thunderid-sg` | Inbound `80`/`443` from anywhere, `22` from your current IP only |
| IAM role `thunderid-ec2-role` | `AmazonEC2ContainerRegistryReadOnly`, so the instance pulls without stored credentials |
| Elastic IP | Survives a stop/start, so DNS and the certificate stay valid |
| EC2 instance | Amazon Linux 2023, `t3.small`, 20 GB gp3, IMDSv2 required |

Port `8090` is deliberately never opened: the server is not published on the host, and Caddy is the
only route in.

Finally, a hostname. Either point a DNS `A` record at the Elastic IP, or use
`<dashed-ip>.sslip.io`, which resolves to the matching IP with no DNS setup and still gets a real
Let's Encrypt certificate. Caddy cannot issue a certificate until the name resolves.

## First deployment

Prepare the instance once:

```bash
scp -i ~/.ssh/thunderid-aws.pem install/aws/bootstrap-ec2.sh ec2-user@<ip>:~
ssh -i ~/.ssh/thunderid-aws.pem ec2-user@<ip> 'bash bootstrap-ec2.sh'
# Log out and back in so the docker group applies.
```

Then, from the repository root:

```bash
export AWS_REGION=ap-south-1
export ECR_REPO=<account>.dkr.ecr.ap-south-1.amazonaws.com/thunderid
export THUNDERID_HOST=ec2-user@<ip>
export THUNDERID_DOMAIN=<ip-with-dashes>.sslip.io
export SSH_KEY=~/.ssh/thunderid-aws.pem

./install/aws/deploy.sh
```

ThunderID is then at `https://$THUNDERID_DOMAIN` and the Console at `/console`.

The admin password is generated during setup and printed by the setup container:

```bash
ssh -i $SSH_KEY $THUNDERID_HOST 'cd ~/thunderid && docker compose logs thunderid-setup'
```

## Applying a code change

Re-run the same command. It tags the image from the current commit (suffixed `-dirty-<timestamp>`
when the working tree has uncommitted changes), pushes it, and restarts the server on the new image.

```bash
./install/aws/deploy.sh
```

The database, the generated TLS/JWT/encryption keys, and Caddy's certificates all live in named
volumes, so they survive a redeploy.

Two variants avoid a rebuild:

```bash
SKIP_BUILD=1 ./install/aws/deploy.sh     # config-only change, keep the running image
IMAGE_TAG=<old-tag> ./install/aws/deploy.sh   # roll back to an image already in ECR
```

## Building in the cloud instead

`deploy.sh` builds on your own machine, which needs ~4 GB of memory and re-downloads the whole
dependency tree each time. CodeBuild does the same work on AWS hardware instead:

```bash
AWS_REGION=ap-south-1 \
ECR_REPO=<account>.dkr.ecr.ap-south-1.amazonaws.com/thunderid \
GITHUB_REPO=<owner>/thunderid \
THUNDERID_DOMAIN=<your-domain> \
./install/aws/provision-codebuild.sh
```

That creates a CodeBuild project reading `install/aws/buildspec.yml`, plus a service role scoped to
pushing this one ECR repository and sending an SSM command to this one instance. It also attaches
`AmazonSSMManagedInstanceCore` to the instance role, which is how the build triggers the deploy
without an SSH key ever existing in the cloud.

Then, to ship a change:

```bash
git commit -am "Your change"
./install/aws/cloud-deploy.sh
```

`cloud-deploy.sh` pushes the branch, starts the build on that exact commit, and follows it to
completion, dumping the last 40 log lines if it fails.

**The important difference:** CodeBuild builds what is **pushed to GitHub**, whereas `deploy.sh`
builds your **working tree**. `cloud-deploy.sh` refuses to run with uncommitted changes rather than
silently shipping a stale commit. The build tags the image with the commit SHA, no `-dirty` suffix
is possible, and the instance re-fetches `install/aws/` from that same commit so the Compose file
and templates can never drift from the image.

A public GitHub repository needs no credentials. To have a `git push` trigger a build on its own,
import a GitHub personal access token with `repo` scope and create a webhook:

```bash
aws codebuild import-source-credentials --region ap-south-1 \
    --server-type GITHUB --auth-type PERSONAL_ACCESS_TOKEN --token <your-pat>
aws codebuild create-webhook --region ap-south-1 --project-name thunderid \
    --filter-groups '[[{"type":"EVENT","pattern":"PUSH"},{"type":"HEAD_REF","pattern":"^refs/heads/main$"}]]'
```

Cost: builds are billed per minute. The project uses `BUILD_GENERAL1_MEDIUM` (4 vCPU / 7 GB),
which handles both the Go and frontend builds and costs about half of `LARGE`, putting a first
~18 minute build near $0.18. Local Docker layer caching is enabled, which makes repeat builds
cheaper again. Set `COMPUTE=BUILD_GENERAL1_LARGE` and re-run `provision-codebuild.sh` to trade
money for speed.

## Notes

- `thunderid-db-init` copies the seed database with `cp -rn`, so an existing database is never
  overwritten on redeploy. The quick-start Compose file uses plain `cp -r`, which would replace it.
- The Console and Gate `config.js` files are deliberately **not** overridden. They default to the
  origin they are served from, which is already correct behind Caddy. Replacing them with the
  minimal example from the quick-start README drops the `brand`, `documentation`, and scope
  defaults the image ships, and the Console then fails to render with
  `Cannot destructure property 'favicon' of 't.brand'`.
- Caddy talks to the server over HTTPS using the self-signed certificate that `setup.sh` generates,
  with upstream verification skipped. That hop never leaves the Compose network.
- `templates/deployment.yaml` is a full copy of `backend/cmd/server/deployment.yaml` with the
  hostname, public URL, and passkey origins changed, because the mount replaces the file wholesale.
  When the config schema changes upstream, re-derive it or startup will fail on unmarshal errors.
- The default `email.smtp` block in `templates/deployment.yaml` points at a local dev SMTP server.
  Replace it with real credentials before relying on email OTP or recovery flows.
- Databases default to SQLite on a local volume. That is fine for one instance; moving to RDS
  Postgres means changing the four `database` sections and is worth doing before adding a second
  instance.
- Each deploy re-downloads the full npm and Go dependency trees, because `COPY . .` in the root
  `Dockerfile` precedes the build and there are no BuildKit cache mounts. Adding those, plus
  `node_modules` to `.dockerignore`, would cut repeat builds from roughly 18 minutes to 2-4.
