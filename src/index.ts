import 'dotenv/config';
import fs from 'fs';
import app from './app';
import { APK_REBUILDER_MODE, BUILTIN_STANDARD_APK_PATH, HOST, PORT, STRICT_REDIS, STRICT_TOOLCHAIN, validateRuntimeConfig } from './config';
import { ensureRedisReady } from './taskQueue';
import { assertToolchainAvailable } from './toolchain';
import { readStandardPackageConfig } from './plugin/standardPackage';

async function boot(): Promise<void> {
  validateRuntimeConfig();
  if (BUILTIN_STANDARD_APK_PATH && !fs.existsSync(BUILTIN_STANDARD_APK_PATH)) {
    const config = readStandardPackageConfig();
    if (!config.activeStandardId && !config.previousStandardId) {
      throw new Error(
        `[startup] builtin standard APK not found at ${BUILTIN_STANDARD_APK_PATH} and no standard package configured.`
      );
    }
    console.warn(
      `[startup] builtin standard APK not found at ${BUILTIN_STANDARD_APK_PATH}; fallback standard package will be unavailable.`
    );
  }
  if (STRICT_TOOLCHAIN) {
    assertToolchainAvailable();
  }
  if (STRICT_REDIS) {
    await ensureRedisReady();
  }

  app.listen(PORT, HOST, () => {
    console.info(`apk-rebuilder listening on http://${HOST}:${PORT} (mode=${APK_REBUILDER_MODE})`);
  });
}

boot().catch((error) => {
  console.error('[startup] failed to boot', error);
  process.exit(1);
});
