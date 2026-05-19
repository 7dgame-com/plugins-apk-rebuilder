import { computed, defineComponent, reactive, ref, type PropType } from 'vue';
import { t } from '../../i18n';
import {
  isValidPackageName,
  isValidVersionCode,
  isValidVersionName,
  sanitizeDigits,
  sanitizePackageName,
} from '../../validation';

type PackageInfoField = 'appName' | 'packageName' | 'versionName' | 'versionCode';
type ValidationState = 'neutral' | 'valid' | 'invalid';
type VersionPart = 'major' | 'minor' | 'patch';

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
          <template v-for="field in fields" :key="field">
            <div v-if="field === 'versionName'" class="field">
              <label>{{ t(fieldLabels[field]) }}</label>
              <div class="version-segment-row" :class="versionFieldClass">
                <input
                  id="versionNameMajor"
                  v-model="versionParts.major"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  placeholder="1"
                  autocomplete="off"
                  spellcheck="false"
                  :aria-invalid="versionState === 'invalid'"
                  @input="onVersionPartInput('major')"
                />
                <span class="version-separator">.</span>
                <input
                  id="versionNameMinor"
                  v-model="versionParts.minor"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
                  autocomplete="off"
                  spellcheck="false"
                  :aria-invalid="versionState === 'invalid'"
                  @input="onVersionPartInput('minor')"
                />
                <span class="version-separator">.</span>
                <input
                  id="versionNamePatch"
                  v-model="versionParts.patch"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
                  autocomplete="off"
                  spellcheck="false"
                  :aria-invalid="versionState === 'invalid'"
                  @input="onVersionPartInput('patch')"
                />
              </div>
              <input id="versionName" type="hidden" :value="versionNameValue" />
              <div v-if="versionMessage" class="field-hint error">{{ versionMessage }}</div>
            </div>
            <div v-else class="field">
              <label>{{ t(fieldLabels[field]) }}</label>
              <input
                :id="field"
                v-model="fieldValues[field]"
                type="text"
                :inputmode="field === 'versionCode' ? 'numeric' : undefined"
                :pattern="field === 'versionCode' ? '[0-9]*' : undefined"
                :placeholder="fieldPlaceholders[field]"
                autocomplete="off"
                spellcheck="false"
                :class="fieldClass(field)"
                :aria-invalid="fieldState(field) === 'invalid'"
                @input="onFieldInput(field)"
              />
              <div v-if="fieldMessage(field)" class="field-hint error">{{ fieldMessage(field) }}</div>
            </div>
          </template>
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
    const fieldValues = reactive<Record<PackageInfoField, string>>({
      appName: '',
      packageName: '',
      versionName: '',
      versionCode: '',
    });
    const versionParts = reactive<Record<VersionPart, string>>({
      major: '',
      minor: '',
      patch: '',
    });
    const gridStyle = computed(() => (
      props.showOriginal ? 'margin-top:10px' : 'margin-top:10px; grid-template-columns: 1fr;'
    ));
    const versionNameValue = computed(() => {
      if (!versionParts.major && !versionParts.minor && !versionParts.patch) return '';
      return `${versionParts.major}.${versionParts.minor}.${versionParts.patch}`;
    });
    const versionState = computed<ValidationState>(() => {
      if (!versionNameValue.value) return 'neutral';
      return isValidVersionName(versionNameValue.value) ? 'valid' : 'invalid';
    });
    const versionFieldClass = computed(() => ({
      'is-valid': versionState.value === 'valid',
      'is-invalid': versionState.value === 'invalid',
    }));
    const versionMessage = computed(() => (
      versionState.value === 'invalid' ? t('pkg.versionNameInvalid') : ''
    ));

    function fieldState(field: PackageInfoField): ValidationState {
      const value = fieldValues[field].trim();
      if (!value || field === 'appName' || field === 'versionName') return 'neutral';
      if (field === 'packageName') return isValidPackageName(value) ? 'valid' : 'invalid';
      if (field === 'versionCode') return isValidVersionCode(value) ? 'valid' : 'invalid';
      return 'neutral';
    }

    function fieldClass(field: PackageInfoField): Record<string, boolean> {
      const state = fieldState(field);
      return {
        'is-valid': state === 'valid',
        'is-invalid': state === 'invalid',
      };
    }

    function fieldMessage(field: PackageInfoField): string {
      if (fieldState(field) !== 'invalid') return '';
      if (field === 'packageName') return t('pkg.packageNameInvalid');
      if (field === 'versionCode') return t('pkg.versionCodeInvalid');
      return '';
    }

    function onFieldInput(field: PackageInfoField): void {
      if (field === 'packageName') {
        fieldValues.packageName = sanitizePackageName(fieldValues.packageName);
      } else if (field === 'versionCode') {
        fieldValues.versionCode = sanitizeDigits(fieldValues.versionCode);
      }
    }

    function onVersionPartInput(part: VersionPart): void {
      versionParts[part] = sanitizeDigits(versionParts[part]);
    }

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
      fieldClass,
      fieldMessage,
      fieldState,
      fieldValues,
      gridStyle,
      iconInputRef,
      onIconChange,
      onFieldInput,
      onVersionPartInput,
      pickIcon,
      t,
      versionFieldClass,
      versionMessage,
      versionNameValue,
      versionParts,
      versionState,
    };
  },
});
