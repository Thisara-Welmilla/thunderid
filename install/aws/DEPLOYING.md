# Uploading Code Changes to the Cloud

How a code change gets from your working tree to the running ThunderID server on AWS, and when
the public URL changes.

For first-time infrastructure setup, see [README.md](README.md).

## Two ways to ship

| | `deploy.sh` | `cloud-deploy.sh` |
|---|---|---|
| Where the image is built | Your machine | AWS CodeBuild |
| What gets built | Your **working tree**, uncommitted edits included | The commit **pushed to GitHub** |
| Image tag | `<sha>-dirty-<timestamp>` when the tree is dirty | `<sha>` |
| Needs ~4 GB free RAM locally | Yes | No |
| Re-downloads dependencies over your connection | Yes, every build | No |
| Cost | Free | About $0.18 per build |

Use `cloud-deploy.sh` normally. Reach for `deploy.sh` when you want to test something you have not
committed yet.

## Uploading a change

```bash
git add -A
git commit -m "Describe the change"
./install/aws/cloud-deploy.sh
```

That is the whole loop. The script:

1. Refuses to run if the working tree is dirty, because CodeBuild builds the pushed commit and
   would silently ship stale code.
2. Pushes the current branch to `origin`.
3. Starts a CodeBuild run pinned to that exact commit SHA.
4. Follows the build, printing each phase, and dumps the last 40 log lines if it fails.

Inside the build, CodeBuild compiles the image, pushes it to ECR tagged with the commit SHA, then
sends an SSM command telling the instance to pull and restart. No SSH key exists anywhere in the
cloud; the deploy runs through the instance's own IAM role.

Set the region once per shell, or export it in your shell profile:

```bash
export AWS_REGION=ap-south-1
```

### Watching a build in the console

The script prints a CodeBuild console link. You can also list recent builds:

```bash
aws codebuild list-builds-for-project --project-name thunderid --max-items 5
```

## Does the URL change?

**No.** Redeploying never changes the URL, however many times you do it. Three separate things
hold it in place:

| What | Why it holds |
|---|---|
| `THUNDERID_DOMAIN` | Pinned as a CodeBuild project environment variable. The build passes it to `render.sh`, which stamps it into `deployment.yaml`, `cors.yaml`, and the `Caddyfile`. Nothing derives it dynamically. |
| Elastic IP | Allocated to your account and associated with the instance. A deploy restarts containers, not the instance, so the address cannot move. With an `sslip.io` hostname, the name *is* the IP, so a stable IP means a stable name. |
| Caddy's certificate | Lives in the `caddy-data` volume, which deploys do not touch. No re-issuance, so no Let's Encrypt rate-limit risk. |

Your data survives too. The database, the generated TLS/JWT/encryption keys, the Direct Auth
Secret, and the setup sentinel all live in named volumes that a redeploy leaves alone, so **your
admin password does not change either**.

### What does change the URL

| Action | Effect |
|---|---|
| Changing `THUNDERID_DOMAIN` | Intentional move to a new hostname. See below. |
| Releasing the Elastic IP | The instance falls back to an ephemeral public IP, which changes on stop/start. An `sslip.io` name built from the old IP stops resolving to your server. |
| Terminating and recreating the instance | New instance, and the Elastic IP must be re-associated. |
| `docker compose down -v` on the instance | Wipes every volume: database, keys, certificates. The URL survives, but the admin password, all data, and the certificate are regenerated. |

Stopping and starting the instance is safe. That is the whole point of the Elastic IP.

### Moving to a different hostname on purpose

To switch from the `sslip.io` placeholder to a real domain:

1. Add a DNS `A` record for the new hostname pointing at the Elastic IP, and wait for it to
   resolve. Caddy cannot get a certificate until it does.
2. Re-run the CodeBuild provisioning with the new value, which updates the pinned variable:

   ```bash
   AWS_REGION=ap-south-1 \
   ECR_REPO=<account>.dkr.ecr.ap-south-1.amazonaws.com/thunderid \
   GITHUB_REPO=<owner>/thunderid \
   THUNDERID_DOMAIN=id.example.com \
   ./install/aws/provision-codebuild.sh
   ```

3. Deploy. The build re-renders every config file for the new hostname and Caddy requests a fresh
   certificate on first request.

   ```bash
   ./install/aws/cloud-deploy.sh
   ```

Existing tokens issued under the old issuer stop validating, because the OIDC issuer is derived
from the public URL. Anyone signed in will need to sign in again.

## Rolling back

Every build tags its image with the commit SHA, so any previous build is still in ECR. Roll back
without rebuilding:

```bash
IMAGE_TAG=<old-sha> \
AWS_REGION=ap-south-1 \
ECR_REPO=<account>.dkr.ecr.ap-south-1.amazonaws.com/thunderid \
THUNDERID_HOST=ec2-user@<ip> \
THUNDERID_DOMAIN=<your-domain> \
SSH_KEY=~/.ssh/thunderid-aws.pem \
./install/aws/deploy.sh
```

List what is available:

```bash
aws ecr describe-images --repository-name thunderid --region ap-south-1 \
    --query 'sort_by(imageDetails,&imagePushedAt)[].[imageTags[0],imagePushedAt]' --output table
```

`SKIP_BUILD=1` in place of `IMAGE_TAG` keeps the running image and only re-applies the Compose and
config files, which is the fast path for a config-only change.

## Troubleshooting

**`cloud-deploy.sh` refuses to start, reporting uncommitted changes.** Working as intended. Commit
them, or use `deploy.sh` to build the working tree locally.

**The build fails during the frontend step, with a killed process.** The CodeBuild compute type ran
out of memory. Raise it and re-provision:

```bash
COMPUTE=BUILD_GENERAL1_LARGE ... ./install/aws/provision-codebuild.sh
```

**The build succeeds but the deploy step fails.** The SSM command output is printed in the build
log. Check that the instance is registered with SSM:

```bash
aws ssm describe-instance-information \
    --query 'InstanceInformationList[].[InstanceId,PingStatus]' --output table
```

**The site serves a certificate warning.** Caddy could not complete an ACME challenge, usually
because DNS does not resolve to the instance yet or port 80 is closed. Port 80 must stay open;
Let's Encrypt uses it for validation. Check Caddy's log:

```bash
ssh -i ~/.ssh/thunderid-aws.pem ec2-user@<ip> 'cd ~/thunderid && docker compose logs caddy --tail 50'
```

**The Console loads but the admin password stopped working.** `setup.sh` regenerates it, and it is
guarded by `database/.thunderid-setup-complete` so it runs only once. If that sentinel was deleted,
a new password was generated. Find it in the setup log:

```bash
ssh -i ~/.ssh/thunderid-aws.pem ec2-user@<ip> 'cd ~/thunderid && docker compose logs thunderid-setup'
```

**The Console renders a blank page.** Almost always a runtime config problem. The Console and Gate
`config.js` files are deliberately not overridden, because they default to the origin they are
served from. Overriding them with a partial config drops the `brand` key the Console requires and
it fails to mount.

## A note on secrets

Do not commit your AWS account ID, instance ID, admin password, or Direct Auth Secret to a public
repository. This deployment's concrete values live in `install/aws/.env` on the instance and in
your AWS console. The scripts take them as environment variables for exactly this reason.
