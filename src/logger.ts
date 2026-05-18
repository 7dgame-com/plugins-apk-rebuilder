import { APK_REBUILDER_DEBUG } from './config';

export function debugLog(message: string, meta?: unknown): void {
  if (!APK_REBUILDER_DEBUG) return;
  if (meta === undefined) {
    console.info(message);
    return;
  }
  console.info(message, meta);
}
