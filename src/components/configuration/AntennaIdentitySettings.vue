<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import RestartModal from '@/components/modals/RestartModal.vue';
import ApiService from '@/utils/api';

type Mode = 'off' | 'tx' | 'rx_tx';
type State = { saved: Mode; running: Mode | null; restart_required: boolean; tx_available: boolean };

const modeLabels: Record<Mode, string> = {
  off: 'Off — single identity',
  tx: 'Transmitting antenna',
  rx_tx: 'Receiving + transmitting antenna',
};
const state = ref<State | null>(null);
const draft = ref<Mode>('off');
const busy = ref(false);
const message = ref('');
const showRestartModal = ref(false);
let disposed = false;

const changed = computed(() => !!state.value && draft.value !== state.value.saved);

async function load() {
  busy.value = true;
  try {
    const result = await ApiService.get<State>('/antenna_identities');
    if (!result.success || !result.data) throw new Error('unavailable');
    if (disposed) return;
    state.value = result.data;
    draft.value = result.data.saved;
  } catch {
    if (!disposed) message.value = 'Antenna identity settings could not be loaded.';
  } finally {
    if (!disposed) busy.value = false;
  }
}

async function save() {
  if (busy.value || !changed.value) return;
  busy.value = true;
  message.value = '';
  try {
    const result = await ApiService.post('/update_antenna_identities', { mode: draft.value });
    if (disposed) return;
    if (!result.success) { message.value = String(result.error || 'Unable to save antenna identity setting.'); return; }
    await load();
    if (!disposed) {
      message.value = 'Saved for restart. Running antenna identities have not changed.';
      if (state.value?.restart_required) showRestartModal.value = true;
    }
  } catch {
    if (!disposed) message.value = 'Save outcome unknown. Refresh before retrying.';
  } finally {
    if (!disposed) busy.value = false;
  }
}

onMounted(load);
onUnmounted(() => { disposed = true; });
</script>

<template>
  <section class="space-y-3 rounded-lg border border-gray-700 p-4" aria-labelledby="antenna-identity-title">
    <h3 id="antenna-identity-title" class="text-lg font-semibold">Antenna identities</h3>
    <p class="text-sm">
      Choose what this node's hop in repeated floods shows. Antenna codes let anyone viewing a packet path tell which of
      your antennas heard it and which sent it on. Only 2- and 3-byte paths are tagged. Changes apply after restart.
    </p>
    <template v-if="state">
      <p class="font-semibold" data-testid="antenna-running">Active now: {{ state.running ? modeLabels[state.running] : 'UNKNOWN' }}</p>
      <p data-testid="antenna-saved">
        Saved: {{ modeLabels[state.saved] }}.
        {{ state.running === null ? 'Running state unavailable.' : state.restart_required ? 'PENDING RESTART — not active yet.' : 'Applied.' }}
      </p>
      <div class="flex flex-wrap gap-2">
        <select id="antenna-identity-mode" v-model="draft" :disabled="busy" aria-label="Antenna identity mode"
          class="rounded border bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 p-2">
          <option value="off">{{ modeLabels.off }}</option>
          <option value="tx" :disabled="!state.tx_available">{{ modeLabels.tx }}{{ state.tx_available ? '' : ' (needs per-transmitter keys)' }}</option>
          <option value="rx_tx">{{ modeLabels.rx_tx }}</option>
        </select>
        <button type="button" :disabled="busy || !changed" class="rounded border px-3 py-2" @click="save">Save for restart</button>
        <button v-if="state.restart_required" type="button" class="rounded border px-3 py-2" :disabled="busy || changed"
          data-testid="antenna-validate-restart" @click="showRestartModal = true">Validate &amp; restart…</button>
      </div>
      <p v-if="draft === 'off' && state.saved !== 'off'" class="text-sm">
        Every repeat will carry this node's single identity. Codes other nodes already learned keep working, so nothing
        breaks; they move to the single identity as routes refresh.
      </p>
    </template>
    <RestartModal v-model="showRestartModal" :start-immediately="false" title="Apply antenna identity setting"
      message="Validate the saved configuration and restart OpenHop to apply it. This applies all saved settings." />
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
