# Quick Start

## Fastest way

```bash
docker compose up -d --build
```

Open: `http://localhost:3005`

## Optional prebuilt image

If you have a public prebuilt image, set:

```bash
export APK_REBUILDER_IMAGE=hkccr.ccs.tencentyun.com/plugins/apk-rebuilder:latest
./scripts/quick-start.sh
```

If prebuilt pull fails, script falls back to local build automatically.
