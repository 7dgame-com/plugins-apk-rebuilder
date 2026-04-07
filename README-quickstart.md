# Quick Start

## Fastest way

```bash
docker compose up -d --build
```

Open: `http://localhost:3007`

## Optional prebuilt image

If you have a public prebuilt image, set:

```bash
export APK_REBUILDER_IMAGE=hkccr.ccs.tencentyun.com/plugins/apk-rebuilder:latest
./scripts/quick-start.sh
```

If prebuilt pull fails, script falls back to local build automatically.

## CI / Deploy

This project also includes:

- `.github/workflows/ci.yml` for install, type-check, build, self-check and Docker build validation
- `.github/workflows/publish-image.yml` for publishing container images
- `deploy/README-ci-deploy.md` for server-side deployment usage
