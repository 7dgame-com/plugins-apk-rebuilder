import type { HostBridgeApi } from '../../types';

export function buildArtifactUrl(host: HostBridgeApi, artifactId: string): string {
  if (!artifactId) return '#';
  const params = new URLSearchParams({ download: '1' });
  if (host.state.token) {
    params.set('token', host.state.token);
  }
  return host.buildUrl(`/plugin/artifacts/${encodeURIComponent(artifactId)}?${params.toString()}`);
}

export function getHistoryUserKey(host: HostBridgeApi): string {
  const user = host.state.user || {};
  const raw = user.id ?? user.userId ?? user.user_id ?? user.username ?? user.nickname ?? 'anonymous';
  return String(raw || 'anonymous').trim() || 'anonymous';
}
