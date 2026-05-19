import { computed, defineComponent, ref, type PropType } from 'vue';
import { t } from '../../i18n';

type PackageInfoField = 'appName' | 'packageName' | 'versionName' | 'versionCode';

const fieldLabels: Record<PackageInfoField, string> = {
  appName: 'pkg.appName',
  packageName: 'pkg.packageName',
  versionName: 'pkg.versionName',
  versionCode: 'pkg.versionCode',
};

const fieldPlaceholders: Record<PackageInfoField, string> = {
  appName: 'XR UGC Demo',
  packageName: 'com.xrugc.demo',
  versionName: '1.0.0',
  versionCode: '100',
};

export default defineComponent({
  name: 'PackageInfoPanel',
  emits: {
    pickIcon: (_file: File) => true,
  },
  props: {
    fields: {
      type: Array as PropType<PackageInfoField[]>,
      default: () => ['appName', 'packageName', 'versionName', 'versionCode'],
    },
    showOriginal: {
      type: Boolean,
      default: false,
    },
    showIcon: {
      type: Boolean,
      default: true,
    },
    showChangeCount: {
      type: Boolean,
      default: false,
    },
  },
  template: `
    <div class="card" id="sectionPackageInfo">
      <div class="toolbar">
        <strong data-i18n-key="pkg.title">{{ t('pkg.title') }}</strong>
        <div v-if="showChangeCount">
          <span class="tag warn" id="changedCount">{{ t('pkg.changedCount', { count: 0 }) }}</span>
        </div>
      </div>
      <div class="grid" :style="gridStyle">
        <div v-if="showOriginal" class="compare-box readonly-pane">
          <div class="compare-title">{{ t('pkg.original') }} <span class="readonly-hint">{{ t('pkg.readonly') }}</span></div>
          <div class="icon-box">
            <img id="srcIcon" alt="source icon" style="display:none" />
            <span id="srcIconEmpty" class="icon-empty">{{ t('pkg.noIcon') }}</span>
          </div>
          <div class="kv"><span class="k">{{ t('pkg.appName') }}</span><span class="v" id="srcName">-</span><span></span></div>
          <div class="kv"><span class="k">{{ t('pkg.packageName') }}</span><span class="v" id="srcPkg">-</span><span></span></div>
          <div class="kv"><span class="k">{{ t('pkg.versionName') }}</span><span class="v" id="srcVer">-</span><span></span></div>
          <div class="kv"><span class="k">{{ t('pkg.versionCode') }}</span><span class="v" id="srcCode">-</span><span></span></div>
        </div>
        <div class="compare-box editable-pane">
          <div v-for="field in fields" :key="field" class="field">
            <label>{{ t(fieldLabels[field]) }}</label>
            <input :id="field" type="text" :placeholder="fieldPlaceholders[field]" autocomplete="off" spellcheck="false" />
          </div>
          <div v-if="showIcon" class="icon-edit-row">
            <div class="icon-edit-left">
              <div class="field">
                <label>{{ t('pkg.newIcon') }}</label>
                <div class="file-pick">
                  <input
                    id="iconFile"
                    ref="iconInputRef"
                    type="file"
                    accept=".png,.webp,.jpg,.jpeg,image/png,image/webp,image/jpeg"
                    @change="onIconChange"
                  />
                  <button id="pickIconBtn" type="button" class="secondary" @click="pickIcon">{{ t('pkg.pickIcon') }}</button>
                  <span id="iconFileName" class="file-name">{{ t('pkg.noFile') }}</span>
                </div>
              </div>
            </div>
            <div class="icon-edit-right">
              <div class="icon-box">
                <img id="newIcon" alt="new icon" style="display:none" />
                <span id="newIconEmpty" class="icon-empty">{{ t('pkg.noIcon') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  setup(props, { emit }) {
    const iconInputRef = ref<HTMLInputElement | null>(null);
    const gridStyle = computed(() => (
      props.showOriginal ? 'margin-top:10px' : 'margin-top:10px; grid-template-columns: 1fr;'
    ));

    function pickIcon(): void {
      iconInputRef.value?.click();
    }

    function onIconChange(): void {
      const file = iconInputRef.value?.files?.[0];
      if (file) emit('pickIcon', file);
    }

    return {
      fieldLabels,
      fieldPlaceholders,
      gridStyle,
      iconInputRef,
      onIconChange,
      pickIcon,
      t,
    };
  },
});
