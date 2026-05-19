import { defineComponent } from 'vue';
import { t } from '../../i18n';

export default defineComponent({
  name: 'WorkflowLane',
  props: {
    step: {
      type: Number,
      required: true,
    },
    titleKey: {
      type: String,
      required: true,
    },
    langTick: {
      type: Number,
      default: 0,
    },
  },
  template: `
    <div class="apk-workflow-lane">
      <div class="apk-workflow-title">
        <span class="apk-workflow-index">{{ step }}</span>
        <span>{{ title }}</span>
      </div>
      <slot />
    </div>
  `,
  computed: {
    title(): string {
      this.langTick;
      return t(this.titleKey);
    },
  },
});
