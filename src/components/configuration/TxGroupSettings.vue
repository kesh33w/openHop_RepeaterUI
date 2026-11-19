<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import RestartModal from '@/components/modals/RestartModal.vue';
import ApiService from '@/utils/api';
type Member = {id: string; label: string};
type Scope = 'all' | 'crossings';
type Group = {network: string; primary_radio_id: string; radio_ids: string[]; active_radio_ids: string[] | null; scope?: Scope; active_scope?: Scope | null; members: Member[]};
const scopeLabels: Record<Scope, string> = {all: 'every packet', crossings: 'bridged packets only'};
const groups = ref<Group[]>([]);
const drafts = ref<Record<string, string>>({});
const scopeDrafts = ref<Record<string, Scope>>({});
const busy = ref(false);
const message = ref('');
const showRestartModal = ref(false);
let disposed = false;

function options(group: Group) {
  const primary = group.primary_radio_id;
  const label = (id: string) => group.members.find(m => m.id === id)?.label || id;
  return [{value: primary, label: `Single: ${label(primary)}`}, ...group.members.filter(m => m.id !== primary).flatMap(m => [
    {value: `${primary},${m.id}`, label: `${label(primary)} → ${m.label}`},
    {value: `${m.id},${primary}`, label: `${m.label} → ${label(primary)}`},
  ])];
}
function isPair(group: Group) {
  return (drafts.value[group.primary_radio_id] || '').includes(',');
}
function unchanged(group: Group) {
  return drafts.value[group.primary_radio_id] === group.radio_ids.join(',')
    && (scopeDrafts.value[group.primary_radio_id] || 'all') === (group.scope || 'all');
}
/** Saved settings differ from what is running (order or scope). */
function pendingRestart(group: Group) {
  if (group.active_radio_ids === null) return false;
  return group.radio_ids.join(',') !== group.active_radio_ids.join(',')
    || (group.radio_ids.length > 1 && (group.scope || 'all') !== (group.active_scope || 'all'));
}
function describe(ids: string[], scope: Scope | null | undefined) {
  return ids.length > 1 ? `ON — sequential dual transmission for ${scopeLabels[scope || 'all']}` : 'OFF — single transmitter';
}
const hasDraft = computed(() => groups.value.some(g => !unchanged(g)));
const restartNeeded = computed(() => groups.value.some(pendingRestart));

async function load() {
  busy.value = true;
  try {
    const result = await ApiService.get<{groups: Group[]}>('/tx_groups');
    if (!result.success || !result.data) throw new Error('TX groups unavailable');
    if (disposed) return;
    groups.value = Array.isArray(result.data.groups) ? result.data.groups : [];
    drafts.value = Object.fromEntries(groups.value.map(g => [g.primary_radio_id, g.radio_ids.join(',')]));
    scopeDrafts.value = Object.fromEntries(groups.value.map(g => [g.primary_radio_id, g.scope || 'all']));
  } catch { if (!disposed) message.value = 'TX group settings could not be loaded.'; }
  finally { if (!disposed) busy.value = false; }
}
async function save(group: Group) {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    const result = await ApiService.post('/update_tx_group', {
      primary_radio_id: group.primary_radio_id,
      radio_ids: (drafts.value[group.primary_radio_id] || group.primary_radio_id).split(','),
      scope: scopeDrafts.value[group.primary_radio_id] || 'all',
    });
    if (disposed) return;
    if (!result.success) { message.value = String(result.error || 'Unable to save TX group.'); return; }
    await load();
    if (!disposed) {
      message.value = 'Saved for restart. Running transmitters have not changed.';
      if (restartNeeded.value || groups.value.some(g => g.active_radio_ids === null)) showRestartModal.value = true;
    }
  } catch { if (!disposed) message.value = 'Save outcome unknown. Refresh saved settings before retrying.'; }
  finally { if (!disposed) busy.value = false; }
}
onMounted(load);
onUnmounted(() => { disposed = true; });
</script>
<template>
  <section class="space-y-3 rounded-lg border border-gray-700 p-4">
    <h3 class="text-lg font-semibold">Sequential transmitters</h3>
    <p class="text-sm">Choose one transmitter or an ordered pair on each frequency. Existing CAD and power settings unchanged. Changes apply after restart.</p>
    <div v-for="group in groups" :key="group.primary_radio_id" class="space-y-2">
      <p class="font-semibold" :data-testid="`tx-active-${group.primary_radio_id}`">Active now: {{ group.active_radio_ids === null ? 'UNKNOWN' : describe(group.active_radio_ids, group.active_scope) }}</p>
      <p :data-testid="`tx-saved-${group.primary_radio_id}`">Saved: {{ describe(group.radio_ids, group.scope) }}. {{ group.active_radio_ids === null ? 'Running state unavailable.' : pendingRestart(group) ? 'PENDING RESTART — not active yet.' : 'Applied.' }}</p>
      <label :for="`tx-order-${group.primary_radio_id}`">{{ group.network }} transmit order</label>
      <div class="flex flex-wrap gap-2">
        <select :id="`tx-order-${group.primary_radio_id}`" v-model="drafts[group.primary_radio_id]" :disabled="busy" class="rounded border bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 p-2">
          <option v-for="option in options(group)" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <select v-if="isPair(group)" :id="`tx-scope-${group.primary_radio_id}`" v-model="scopeDrafts[group.primary_radio_id]" :disabled="busy" aria-label="Packets sent through both transmitters" class="rounded border bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 p-2">
          <option value="all">Both transmitters for every packet</option>
          <option value="crossings">Both transmitters for bridged packets only</option>
        </select>
        <button :disabled="busy || unchanged(group)" class="rounded border px-3 py-2" @click="save(group)">Save for restart</button>
      </div>
      <p v-if="isPair(group) && scopeDrafts[group.primary_radio_id] === 'crossings'" class="text-sm">Packets bridged from the other network go out on both radios for extra reach. Everything else uses {{ group.members.find(m => m.id === group.primary_radio_id)?.label || group.primary_radio_id }} alone.</p>
      <p class="text-sm">Running: {{ group.active_radio_ids?.join(' → ') || 'unavailable' }}<template v-if="(group.active_radio_ids?.length || 0) > 1"> for {{ scopeLabels[group.active_scope || 'all'] }}</template>. Saved: {{ group.radio_ids.join(' → ') }}<template v-if="group.radio_ids.length > 1"> for {{ scopeLabels[group.scope || 'all'] }}</template>.</p>
    </div>
    <div class="rounded border p-3 space-y-2" data-testid="tx-restart-box">
      <h4 class="font-semibold">Apply saved transmitter settings</h4>
      <p>{{ restartNeeded ? 'Saved transmitter settings differ from the running configuration.' : 'Restart applies saved configuration, including transmitter order.' }} Restarting briefly interrupts OpenHop and applies all saved settings.</p>
      <p v-if="hasDraft">Save or discard your transmitter selection before restarting.</p>
      <button type="button" class="rounded border px-3 py-2" data-testid="tx-validate-restart" :disabled="busy || hasDraft || !groups.length" @click="showRestartModal = true">Validate &amp; restart…</button>
    </div>
    <RestartModal v-model="showRestartModal" :start-immediately="false" title="Apply saved transmitter settings" message="Validate the saved configuration and restart OpenHop to apply it. This applies all saved settings, not just transmitter order." />
    <p v-if="message" role="status">{{ message }}</p>
    <button :disabled="busy" class="rounded border px-3 py-1" @click="load">Refresh saved settings</button>
  </section>
</template>
