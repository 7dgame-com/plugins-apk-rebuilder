import { t } from '../i18n.js';

export function renderToolsCheck(container) {
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

export function createToolsCheck({ state, api }) {
  function renderTools(data) {
    const tools = data?.tools || {};
    const names = Object.keys(tools);
    const total = names.length;
    const okCount = names.filter((k) => Boolean(tools[k]?.ok)).length;
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
      .map((k) => `${k}: ${tools[k]?.ok ? 'OK' : 'FAIL'}${tools[k]?.detail ? ` | ${tools[k].detail}` : ''}`)
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
      .map((k) => {
        const t = tools[k] || {};
        const cls = t.ok ? 'ok' : 'fail';
        const detailText = t.detail ? ` | ${t.detail}` : '';
        return `<div class="tools-popover-item ${cls}"><strong>${k}</strong>: ${t.ok ? 'OK' : 'FAIL'}${detailText}</div>`;
      })
      .join('');
  }

  function setToolsPopoverOpen(open) {
    state.toolsPopoverOpen = Boolean(open);
    const pop = document.getElementById('toolsPopover');
    if (!pop) return;
    pop.classList.toggle('open', state.toolsPopoverOpen);
  }

  async function refreshTools() {
    try {
      renderTools(await api('/api/tools'));
    } catch (e) {
      alert(t('tools.checkFailed', { message: e.message }));
    }
  }

  function bind() {
    const refreshBtn = document.getElementById('refreshTools');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        const list = document.getElementById('toolsPopoverList');
        if (list) list.innerHTML = `<div class="tools-popover-item">${t('tools.results.loading')}</div>`;
        setToolsPopoverOpen(true);
        try {
          await refreshTools();
        } catch (e) {
          if (list) list.innerHTML = `<div class="tools-popover-item fail">${t('tools.results.fail', { message: e?.message || '未知错误' })}</div>`;
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (!state.toolsPopoverOpen) return;
      const wrap = e.target instanceof Element ? e.target.closest('.tools-check-wrap') : null;
      if (!wrap) setToolsPopoverOpen(false);
    });
  }

  return { bind, refreshTools, setToolsPopoverOpen };
}
