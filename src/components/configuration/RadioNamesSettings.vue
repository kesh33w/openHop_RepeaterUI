<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiService } from '@/utils/api';
import { useSystemStore } from '@/stores/system';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';
import { useUnsavedChanges } from '@/composables/useUnsavedChanges';
import { defaultRadioName, MAX_RADIO_NAME_LENGTH } from '@/utils/radioDisplayNames';
import UnsavedChangesModal from '@/components/ui/UnsavedChangesModal.vue';

const systemStore = useSystemStore();
const { radios, radioNames } = useMultiRadioConfig();
const draft = ref<Record<string, string>>({});
const baseline = ref('{}');
const isSaving = ref(false);
const refreshing = ref(false);
const uncertain = ref(false);
const message = ref('');
const error = ref('');
const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value);
const isEditing = computed(() => dirty.value || isSaving.value);

function reset() {
  draft.value = Object.fromEntries(radios.value.map(radio => [radio.id, radioNames.value[radio.id] || '']));
  baseline.value = JSON.stringify(draft.value);
  error.value = '';
}
watch([radios, radioNames], () => { if (!dirty.value && !isSaving.value && !uncertain.value) reset(); }, { immediate: true });

const validation = computed(() => {
  const names = new Set<string>();
  for (const radio of radios.value) {
    const name = (draft.value[radio.id] || '').trim();
    if (name.length > MAX_RADIO_NAME_LENGTH) return `Names must be ${MAX_RADIO_NAME_LENGTH} characters or fewer.`;
    if ([...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return 'Names cannot contain control characters.';
    const displayed = (name || defaultRadioName(radio)).toLocaleLowerCase();
    if (names.has(displayed)) return 'Choose a different name for each radio so menus stay clear.';
    names.add(displayed);
  }
  return '';
});

async function save(): Promise<boolean> {
  if (isSaving.value || uncertain.value || validation.value) return false;
  isSaving.value = true;
  error.value = '';
  message.value = '';
  // Preserve names for disconnected/removed radios; submit only display metadata.
  const names = { ...radioNames.value };
  for (const radio of radios.value) {
    const name = (draft.value[radio.id] || '').trim();
    if (name) names[radio.id] = name;
    else delete names[radio.id];
  }
  try {
    const response = await ApiService.post('/update_web_config', { web: { radio_labels: names } });
    if (!response.success) {
      error.value = response.error || 'Could not save radio names. Your edits are still here.';
      return false;
    }
    // The persisted response confirms success. Update every open menu immediately.
    if (systemStore.stats) {
      const config = systemStore.stats.config || {};
      systemStore.stats = { ...systemStore.stats, config: { ...config, web: { ...config.web, radio_labels: names } } };
    }
    reset();
    message.value = 'Radio names saved. Menus update immediately; no restart needed.';
    return true;
  } catch {
    uncertain.value = true;
    error.value = 'Save outcome is unknown. Reload saved names before trying again.';
    return false;
  } finally {
    isSaving.value = false;
  }
}

async function reload() {
  if (refreshing.value || isSaving.value) return;
  refreshing.value = true;
  try {
    await systemStore.fetchStats();
    uncertain.value = false;
    reset();
    message.value = 'Saved names reloaded.';
  } catch {
    error.value = 'Could not reload saved names. Your edits are still here.';
  } finally {
    refreshing.value = false;
  }
}
const { showUnsavedModal, requestLeave, handleDiscard, handleSave, handleCancel } =
  useUnsavedChanges(isEditing, isSaving, reset, save);
function beforeUnload(event: BeforeUnloadEvent) {
  if (isEditing.value) { event.preventDefault(); event.returnValue = ''; }
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
defineExpose({ isEditing, requestLeave });
</script>

<template>
  <section class="radio-names space-y-6">
    <div>
      <h3 class="text-lg font-semibold text-content-primary">Radio names</h3>
      <p class="mt-2 text-sm text-content-secondary">Choose how each radio appears in dropdown menus throughout OpenHop.</p>
      <p class="mt-1 text-sm text-content-muted">These names are display-only. They do not change radio IDs, frequencies, routing, or RF and observer identities.</p>
    </div>
    <form v-if="radios.length" class="space-y-5" @submit.prevent="save">
      <div v-for="radio in radios" :key="radio.id" class="name-row">
        <label :for="`radio-name-${radio.id}`" class="block text-sm font-semibold text-content-primary">{{ defaultRadioName(radio) }}</label>
        <input :id="`radio-name-${radio.id}`" v-model="draft[radio.id]" :data-radio-id="radio.id" class="cfg-input mt-2" type="text" :maxlength="MAX_RADIO_NAME_LENGTH" :placeholder="defaultRadioName(radio)" :disabled="isSaving || uncertain || refreshing" autocomplete="off" />
        <p class="mt-1 text-xs text-content-muted">Leave blank to use {{ defaultRadioName(radio) }}.</p>
        <details class="mt-2 text-xs text-content-muted"><summary>Radio details</summary><p class="mt-1">Internal ID: {{ radio.id }}<span v-if="radio.radio?.frequency"> · {{ Number(radio.radio.frequency) / 1000000 }} MHz</span></p></details>
      </div>
      <p v-if="validation" role="alert" class="text-sm text-accent-amber">{{ validation }}</p>
      <p v-if="error" role="alert" class="text-sm text-accent-red">{{ error }}</p>
      <p v-if="message" role="status" class="text-sm text-accent-green">{{ message }}</p>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="btn-primary" :disabled="!dirty || isSaving || uncertain || refreshing || Boolean(validation)">{{ isSaving ? 'Saving…' : 'Save radio names' }}</button>
        <button v-if="!uncertain" type="button" class="btn-secondary" :disabled="!dirty || isSaving" @click="reset(); message = ''">Discard changes</button>
        <button v-else type="button" class="btn-secondary" :disabled="refreshing" @click="reload">{{ refreshing ? 'Reloading…' : 'Reload saved names' }}</button>
      </div>
    </form>
    <p v-else class="text-sm text-content-muted">No separate radios are configured. Add radios in Radio Hardware to name them here.</p>
    <UnsavedChangesModal :show="showUnsavedModal" :is-saving="isSaving" label="Radio names" @save="handleSave" @discard="handleDiscard" @cancel="handleCancel" />
  </section>
</template>

<style scoped>
.radio-names { max-width: 760px; }
.name-row { border: 1px solid var(--stroke-subtle, #9ca3af40); border-radius: 12px; padding: 16px; }
.name-row input { width: 100%; }
summary { cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
</style>
