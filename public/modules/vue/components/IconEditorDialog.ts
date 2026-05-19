import { defineComponent, onBeforeUnmount, ref } from 'vue';
import { state, setIcon } from '../../state';
import { t } from '../../i18n';
import { showAlert } from '../../host/notify';

export default defineComponent({
  name: 'IconEditorDialog',
  template: `
    <div id="iconEditorMask" class="modal-mask" role="dialog" aria-modal="true" :class="{ open: isOpen }" @click="onMaskClick">
      <div class="modal">
        <div class="modal-head">
          <strong>{{ t('icon.title') }}</strong>
          <button id="iconEditorCloseBtn" type="button" class="secondary" @click="closeEditor">{{ t('icon.cancel') }}</button>
        </div>
        <div class="editor-layout">
          <div class="editor-preview">
            <div class="editor-canvas-wrap">
              <canvas id="iconEditorCanvas" ref="canvasRef" width="512" height="512"></canvas>
            </div>
          </div>
          <div class="editor-controls">
            <div class="editor-grid">
              <div class="editor-field slider-row">
                <label>{{ t('icon.scale') }}</label>
                <input id="iconScale" v-model.number="scale" type="range" min="0.5" max="2.5" step="0.01" @input="renderCanvas" />
              </div>
              <div class="editor-field slider-row">
                <label>{{ t('icon.offsetX') }}</label>
                <input id="iconOffsetX" v-model.number="offsetX" type="range" min="-220" max="220" step="1" @input="renderCanvas" />
              </div>
              <div class="editor-field slider-row">
                <label>{{ t('icon.offsetY') }}</label>
                <input id="iconOffsetY" v-model.number="offsetY" type="range" min="-220" max="220" step="1" @input="renderCanvas" />
              </div>
              <div class="editor-field">
                <label>&nbsp;</label>
                <button id="iconEditorResetBtn" type="button" class="secondary" @click="resetEditor">{{ t('icon.reset') }}</button>
              </div>
            </div>
            <div class="editor-actions">
              <button id="iconEditorApplyBtn" type="button" @click="applyEditor">{{ t('icon.apply') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup(_props, { expose }) {
    const canvasRef = ref<HTMLCanvasElement | null>(null);
    const isOpen = ref(false);
    const scale = ref(1);
    const offsetX = ref(0);
    const offsetY = ref(0);
    let fileName = 'icon.png';
    let sourceUrl = '';
    let sourceImage: HTMLImageElement | null = null;

    function clearIconInput(): void {
      const iconFile = document.getElementById('iconFile') as HTMLInputElement | null;
      if (iconFile) iconFile.value = '';
    }

    function closeEditor(): void {
      isOpen.value = false;
      clearIconInput();
    }

    function renderCanvas(): void {
      const canvas = canvasRef.value;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || !sourceImage) return;

      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-card') || '#ffffff';
      ctx.fillStyle = bg.trim();
      ctx.fillRect(0, 0, cw, ch);

      const fit = Math.min(cw / sourceImage.width, ch / sourceImage.height);
      const drawW = sourceImage.width * fit * scale.value;
      const drawH = sourceImage.height * fit * scale.value;
      const x = (cw - drawW) / 2 + offsetX.value;
      const y = (ch - drawH) / 2 + offsetY.value;
      ctx.drawImage(sourceImage, x, y, drawW, drawH);
    }

    function resetEditor(): void {
      scale.value = 1;
      offsetX.value = 0;
      offsetY.value = 0;
      renderCanvas();
    }

    async function prepareIconEditor(file: File): Promise<void> {
      if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
      }
      sourceUrl = URL.createObjectURL(file);
      fileName = file.name || 'icon.png';
      resetEditor();

      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('icon load failed'));
        image.src = sourceUrl;
      });
      sourceImage = image;
      renderCanvas();
      isOpen.value = true;
    }

    async function applyEditor(): Promise<void> {
      const canvas = canvasRef.value;
      if (!canvas) return;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        await showAlert(t('icon.failed'));
        return;
      }
      const baseName = (fileName || 'icon').replace(/\.[^.]+$/, '');
      const file = new File([blob], `${baseName}.png`, { type: 'image/png' });
      const previewUrl = URL.createObjectURL(blob);
      if (state.iconPreviewUrl && state.iconPreviewUrl !== previewUrl) {
        URL.revokeObjectURL(state.iconPreviewUrl);
      }
      state.iconFile = file;
      state.iconPreviewUrl = previewUrl;
      const fileNameEl = document.getElementById('iconFileName');
      if (fileNameEl) fileNameEl.textContent = file.name;
      setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl);
      closeEditor();
    }

    function onMaskClick(event: MouseEvent): void {
      if (event.target === event.currentTarget) {
        closeEditor();
      }
    }

    onBeforeUnmount(() => {
      if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
      }
    });

    expose({ prepareIconEditor });

    return {
      canvasRef,
      isOpen,
      scale,
      offsetX,
      offsetY,
      applyEditor,
      closeEditor,
      onMaskClick,
      renderCanvas,
      resetEditor,
      t,
    };
  },
});
