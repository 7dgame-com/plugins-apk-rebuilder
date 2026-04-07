type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code || '').trim();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return String(error.message || '').trim();
  return String(error || '').trim();
}

export function normalizeEmbedErrorMessage(error: unknown, t: TranslateFn, fallbackKey: string): string {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  const normalized = `${code} ${message}`.toLowerCase();

  if (code === 'REQUIRE_IFRAME_ENTRY') return t('embed.requireMainSystem');
  if (code === 'MISSING_HOST_TOKEN' || code === 'INIT_TIMEOUT') {
    return t('embed.authNotReady');
  }
  if (
    normalized.includes('host permission denied') ||
    normalized.includes('permission denied') ||
    normalized.includes('insufficient permissions') ||
    normalized.includes('forbidden')
  ) {
    return t('embed.roleNotAllowed');
  }
  if (
    normalized.includes('token expired') ||
    normalized.includes('token refresh failed') ||
    normalized.includes('host token unauthorized') ||
    normalized.includes('missing bearer token') ||
    normalized.includes('unauthorized') ||
    normalized.includes('认证已过期') ||
    normalized.includes('未登录')
  ) {
    return t('embed.sessionExpired');
  }
  return message || (fallbackKey ? t(fallbackKey) : '');
}
