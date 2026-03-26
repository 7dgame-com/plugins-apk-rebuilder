import { iconEditor } from '../state.js';
import { t } from '../i18n.js';

export function renderIconEditorModal(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div id="iconEditorMask" class="modal-mask" role="dialog" aria-modal="true">
      <div class="modal">
        <div class="modal-head">
          <strong>${t('icon.title')}</strong>
          <button id="iconEditorCloseBtn" type="button" class="secondary">${t('icon.cancel')}</button>
        </div>
        <div class="editor-layout">
          <div class="editor-preview">
            <div class="editor-canvas-wrap">
              <canvas id="iconEditorCanvas" width="512" height="512"></canvas>
            </div>
          </div>
          <div class="editor-controls">
            <div class="editor-grid">
              <div class="editor-field slider-row">
                <label>${t('icon.scale')}</label>
                <input id="iconScale" type="range" min="0.5" max="2.5" step="0.01" value="1" />
              </div>
              <div class="editor-field slider-row">
                <label>${t('icon.offsetX')}</label>
                <input id="iconOffsetX" type="range" min="-220" max="220" step="1" value="0" />
              </div>
              <div class="editor-field slider-row">
                <label>${t('icon.offsetY')}</label>
                <input id="iconOffsetY" type="range" min="-220" max="220" step="1" value="0" />
              </div>
              <div class="editor-field">
                <label>&nbsp;</label>
                <button id="iconEditorResetBtn" type="button" class="secondary">${t('icon.reset')}</button>
              </div>
            </div>
            <div class="editor-actions">
              <button id="iconEditorApplyBtn" type="button">${t('icon.apply')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    `
  );
}

export function createIconEditor({ state, onIconChanged }) {
  const getEl = (id) => document.getElementById(id);

  function openIconEditor() {
    const mask = getEl('iconEditorMask');
    if (mask) mask.classList.add('open');
  }

  function closeIconEditor() {
    const mask = getEl('iconEditorMask');
    if (mask) mask.classList.remove('open');
  }

  function renderIconEditorCanvas() {
    const canvas = getEl('iconEditorCanvas');
    const ctx = canvas?.getContext('2d');
    const img = iconEditor.sourceImage;
    if (!ctx || !canvas || !img) return;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-card') || '#ffffff';
    ctx.fillStyle = bg.trim();
    ctx.fillRect(0, 0, cw, ch);

    const fit = Math.min(cw / img.width, ch / img.height);
    const drawW = img.width * fit * iconEditor.scale;
    const drawH = img.height * fit * iconEditor.scale;
    const x = (cw - drawW) / 2 + iconEditor.offsetX;
    const y = (ch - drawH) / 2 + iconEditor.offsetY;
    ctx.drawImage(img, x, y, drawW, drawH);
  }

  async function prepareIconEditor(file) {
    if (iconEditor.sourceUrl) {
      URL.revokeObjectURL(iconEditor.sourceUrl);
    }
    iconEditor.sourceUrl = URL.createObjectURL(file);
    iconEditor.fileName = file.name || 'icon.png';
    iconEditor.scale = 1;
    iconEditor.offsetX = 0;
    iconEditor.offsetY = 0;

    const scale = getEl('iconScale');
    const offsetX = getEl('iconOffsetX');
    const offsetY = getEl('iconOffsetY');
    if (scale) scale.value = '1';
    if (offsetX) offsetX.value = '0';
    if (offsetY) offsetY.value = '0';

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = iconEditor.sourceUrl;
    });
    iconEditor.sourceImage = img;
    renderIconEditorCanvas();
    openIconEditor();
  }

  async function applyIconEditor() {
    const canvas = getEl('iconEditorCanvas');
    if (!canvas) return;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      alert(t('icon.failed'));
      return;
    }
    const baseName = (iconEditor.fileName || 'icon').replace(/\.[^.]+$/, '');
    const file = new File([blob], `${baseName}.png`, { type: 'image/png' });
    const previewUrl = URL.createObjectURL(blob);
    setIconSelection(file, previewUrl, file.name);
    closeIconEditor();
    const iconFile = getEl('iconFile');
    if (iconFile) iconFile.value = '';
  }

  function setIconSelection(file, previewUrl, nameText) {
    if (state.iconPreviewUrl && state.iconPreviewUrl !== previewUrl) {
      URL.revokeObjectURL(state.iconPreviewUrl);
    }
    state.iconFile = file;
    state.iconPreviewUrl = previewUrl || '';
    const fileNameEl = getEl('iconFileName');
    if (fileNameEl) fileNameEl.textContent = nameText || t('pkg.noFile');
    onIconChanged();
  }

  function bind() {
    const scale = getEl('iconScale');
    const offsetX = getEl('iconOffsetX');
    const offsetY = getEl('iconOffsetY');
    const resetBtn = getEl('iconEditorResetBtn');
    const closeBtn = getEl('iconEditorCloseBtn');
    const applyBtn = getEl('iconEditorApplyBtn');
    const mask = getEl('iconEditorMask');

    if (scale) scale.addEventListener('input', () => {
      iconEditor.scale = Number(scale.value);
      renderIconEditorCanvas();
    });
    if (offsetX) offsetX.addEventListener('input', () => {
      iconEditor.offsetX = Number(offsetX.value);
      renderIconEditorCanvas();
    });
    if (offsetY) offsetY.addEventListener('input', () => {
      iconEditor.offsetY = Number(offsetY.value);
      renderIconEditorCanvas();
    });
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        iconEditor.scale = 1;
        iconEditor.offsetX = 0;
        iconEditor.offsetY = 0;
        if (scale) scale.value = '1';
        if (offsetX) offsetX.value = '0';
        if (offsetY) offsetY.value = '0';
        renderIconEditorCanvas();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        closeIconEditor();
        const iconFile = getEl('iconFile');
        if (iconFile) iconFile.value = '';
      });
    }
    if (applyBtn) applyBtn.addEventListener('click', () => applyIconEditor().catch(() => alert(t('icon.failed'))));
    if (mask) {
      mask.addEventListener('click', (e) => {
        if (e.target === mask) {
          closeIconEditor();
          const iconFile = getEl('iconFile');
          if (iconFile) iconFile.value = '';
        }
      });
    }
  }

  return {
    bind,
    prepareIconEditor,
    setIconSelection,
  };
}
