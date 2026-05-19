export function notifyHostPluginUrlChanged(pluginUrl: string): void {
  window.parent?.postMessage(
    {
      type: 'EVENT',
      id: `plugin-url-changed-${Date.now()}`,
      payload: {
        event: 'plugin-url-changed',
        pluginUrl,
      },
    },
    '*',
  );
}
