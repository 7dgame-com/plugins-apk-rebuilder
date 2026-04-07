import { t } from '../i18n';
import { normalizeEmbedErrorMessage } from '../embed/errors';
import { showAlert } from '../embed/notify';
import type { AppState, EmbedHostApi } from '../types';

type ToolsCheckDeps = {
  state: AppState;
  api: (url: string, options?: RequestInit) => Promise<any>;
  host?: EmbedHostApi | null;
};

type ToolStatus = {
  ok?: boolean;
  detail?: string;
};

type ToolsResponse = {
  tools?: Record<string, ToolStatus>;
};

export function renderToolsCheck(container: HTMLElement): void {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="tools-check-wrap" id="toolsCheckWrap">
      <button id="refreshTools" class="secondary">${t('tools.check')}</button>
      <span id="toolsCheckSummary" class="tools-check-summary">${t('tools.summary.none')}</span>
      <div id="toolsPopover" class="tools-popover" role="dialog" aria-live="polite">
        <div class="tools-popover-title">${t('tools.results.title')}</div>
        <div id="toolsPopoverList" class="tools-popover-list"></div>
      </div>
    </div>
    `
  );
}

export function createToolsCheck({ state, api, host = null }: ToolsCheckDeps) {
  function renderTools(data: ToolsResponse | Record<string, any>): void {
    const tools = data?.tools || {};
    const names = Object.keys(tools);
    const total = names.length;
    const okCount = names.filter((key) => Boolean(tools[key]?.ok)).length;
    const btn = document.getElementById('refreshTools');
    const summary = document.getElementById('toolsCheckSummary');
    if (!btn || !summary) return;
    btn.textContent = t('tools.check');
    summary.classList.remove('ok', 'fail');
    summary.textContent = total ? t('tools.summary.passed', { ok: okCount, total }) : t('tools.summary.none');
    if (total) {
      if (okCount === total) summary.classList.add('ok');
      else summary.classList.add('fail');
    }
    const detail = names
      .map((key) => `${key}: ${tools[key]?.ok ? 'OK' : 'FAIL'}${tools[key]?.detail ? ` | ${tools[key].detail}` : ''}`)
      .join('\n');
    btn.title = detail;
    summary.title = detail;

    const list = document.getElementById('toolsPopoverList');
    if (!list) return;
    if (!names.length) {
      list.innerHTML = `<div class="tools-popover-item">${t('tools.results.empty')}</div>`;
      return;
    }
    list.innerHTML = names
      .map((key) => {
        const tool = tools[key] || {};
        const cls = tool.ok ? 'ok' : 'fail';
        const detailText = tool.detail ? ` | ${tool.detail}` : '';
        return `<div class="tools-popover-item ${cls}"><strong>${key}</strong>: ${tool.ok ? 'OK' : 'FAIL'}${detailText}</div>`;
      })
      .join('');
  }

  function setToolsPopoverOpen(open: boolean): void {
    state.toolsPopoverOpen = Boolean(open);
    const pop = document.getElementById('toolsPopover');
    if (!pop) return;
    pop.classList.toggle('open', state.toolsPopoverOpen);
  }

  async function refreshTools(): Promise<void> {
    try {
      if (host) {
        const res = await host.authFetch('/plugin/admin/tools');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error?.message || json?.message || `HTTP ${res.status}`);
        }
        renderTools(json?.data ?? json);
        return;
      }
      renderTools(await api('/api/tools'));
    } catch (error) {
      void showAlert(t('tools.checkFailed', { message: normalizeEmbedErrorMessage(error, t, '') }));
    }
  }

  function bind(): void {
    const refreshBtn = document.getElementById('refreshTools');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const list = document.getElementById('toolsPopoverList');
        if (list) list.innerHTML = `<div class="tools-popover-item">${t('tools.results.loading')}</div>`;
        setToolsPopoverOpen(true);
        try {
          await refreshTools();
        } catch (error) {
          if (list) {
            const message = error instanceof Error ? error.message : '未知错误';
            list.innerHTML = `<div class="tools-popover-item fail">${t('tools.results.fail', { message })}</div>`;
          }
        }
      });
    }

    document.addEventListener('click', (event) => {
      if (!state.toolsPopoverOpen) return;
      const wrap = event.target instanceof Element ? event.target.closest('.tools-check-wrap') : null;
      if (!wrap) setToolsPopoverOpen(false);
    });
  }

  return { bind, refreshTools, setToolsPopoverOpen };
}
