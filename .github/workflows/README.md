# GitHub Actions Workflows

This directory contains automated workflows for CI/CD.

## Workflows

### `publish-docker.yml` - Build and Publish Docker Image

**Triggers:**

- ✅ **Every push to `main` branch** - Automatically builds and publishes `latest` tag
- ✅ **Version tags** (e.g., `v1.0.0`) - Creates versioned releases
- ✅ **Pull requests** - Builds image to verify (doesn't publish)
- ✅ **Manual trigger** - Run from Actions tab

**What it does:**

1. Checks out code
2. Sets up multi-architecture build (AMD64 + ARM64)
3. Logs into GitHub Container Registry
4. Builds Docker image for both architectures
5. Pushes to `ghcr.io/jasonwaters/rental-calendar-sync`
6. Creates build attestation for security
7. Generates summary with pull commands

**Auto-generated tags:**

- `latest` - Always points to the most recent build from `main`
- `main` - Tracks the main branch
- `v1.0.0`, `v1.0`, `v1` - Semantic version tags (when you push `v1.0.0` tag)
- `main-sha-abc1234` - Specific commit SHAs

## Usage

### Automatic Publishing (Default)

Every time you push to `main`, a new image is automatically built and published:

```bash
git add .
git commit -m "Update reservations sync"
git push origin main
```

GitHub Actions will automatically:

1. Build the image
2. Push to `ghcr.io/jasonwaters/rental-calendar-sync:latest`
3. Show summary in the Actions tab

### Manual Publishing

You can also trigger a build manually:

1. Go to [Actions tab](../../actions)
2. Select "Build and Publish Docker Image"
3. Click "Run workflow"
4. Select branch and click "Run workflow"

### Creating Version Releases

To create a versioned release:

```bash
# Create and push a version tag
git tag v1.0.0
git push origin v1.0.0
```

This creates:

- `ghcr.io/jasonwaters/rental-calendar-sync:v1.0.0`
- `ghcr.io/jasonwaters/rental-calendar-sync:v1.0`
- `ghcr.io/jasonwaters/rental-calendar-sync:v1`
- `ghcr.io/jasonwaters/rental-calendar-sync:latest`

### Testing on Pull Requests

When you create a pull request, the workflow:

- ✅ Builds the image to verify it works
- ❌ Does NOT publish to registry
- Shows build status in PR

## Monitoring

### View Build Status

- **Badge:** Add to README: `![Docker](https://github.com/jasonwaters/rental-calendar-sync/actions/workflows/publish-docker.yml/badge.svg)`
- **Actions tab:** See all workflow runs at [Actions](../../actions)
- **Packages:** View published images at [Packages](../../../packages)

### Check Latest Build

```bash
# Pull latest image
docker pull ghcr.io/jasonwaters/rental-calendar-sync:latest

# Check metadata
docker inspect ghcr.io/jasonwaters/rental-calendar-sync:latest
```

## Permissions

The workflow uses `GITHUB_TOKEN` which is automatically provided by GitHub Actions. No additional secrets needed!

**Required permissions:**

- `contents: read` - Read repository code
- `packages: write` - Push to GitHub Container Registry
- `attestations: write` - Create build provenance
- `id-token: write` - Generate attestations

## Troubleshooting

### Build fails on push

Check the [Actions tab](../../actions) for error messages. Common issues:

- Dockerfile syntax error
- Missing dependencies in `package.json`
- Network timeout during build

### Image not updating on Synology

Your Synology pulls the `latest` tag. After GitHub Actions publishes a new version:

```bash
# On Synology NAS
docker pull ghcr.io/jasonwaters/rental-calendar-sync:latest
docker images | grep rental-calendar-sync  # Verify new image date
```

Or update your scheduled task to always pull latest:

```bash
docker pull ghcr.io/jasonwaters/rental-calendar-sync:latest
docker run --rm ...
```

## Benefits of Automated CI/CD

✅ **Consistent builds** - Same environment every time
✅ **Fast updates** - Push code, get new image automatically
✅ **Version tracking** - Git tags create versioned releases
✅ **Security** - Build attestations for supply chain security
✅ **Multi-arch** - Supports AMD64 and ARM64 automatically
✅ **No local setup** - No need for buildx or manual publishing
✅ **PR validation** - Test builds before merging

## Local Testing

For local testing, you can still build Docker images manually:

```bash
# Build and test locally
docker build -t rental-calendar-sync:test .
docker run --rm -v "$(pwd)/.env:/app/.env:ro" -v "$(pwd)/output:/data" rental-calendar-sync:test npm run sync

# Clean up
docker rmi rental-calendar-sync:test
```

But for publishing, just push to `main` and let GitHub Actions handle it!
