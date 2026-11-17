<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import ApiService from '@/utils/api';
type Member = {id: string; label: string; cad_off: boolean};
type Group = {network: string; primary_radio_id: string; radio_ids: string[]; active_radio_ids: string[] | null; members: Member[]};
const groups = ref<Group[]>([]);
const drafts = ref<Record<string, string>>({});
const busy = ref(false);
const message = ref('');
let disposed = false;
function options(group: Group) {
  const primary = group.primary_radio_id;
  const label = (id: string) => group.members.find(m => m.id === id)?.label || id;
  return [{value: primary, label: `Single: ${label(primary)}`}, ...group.members.filter(m => m.id !== primary).flatMap(m => [
    {value: `${primary},${m.id}`, label: `${label(primary)} → ${m.label}`},
    {value: `${m.id},${primary}`, label: `${m.label} → ${label(primary)}`},
  ])];
}
async function load() {
  busy.value = true;
  try {
    const result = await ApiService.get<{groups: Group[]}>('/tx_groups');
    if (!result.success || !result.data) throw new Error('TX groups unavailable');
    if (disposed) return;
    groups.value = result.data.groups;
    drafts.value = Object.fromEntries(groups.value.map(g => [g.primary_radio_id, g.radio_ids.join(',')]));
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
    });
    if (disposed) return;
    if (!result.success) { message.value = String(result.error || 'Unable to save TX group.'); return; }
    await load();
    if (!disposed) message.value = 'Saved for restart. Running transmitters have not changed.';
  } catch { if (!disposed) message.value = 'Save outcome unknown. Refresh saved settings before retrying.'; }
  finally { if (!disposed) busy.value = false; }
}
onMounted(load);
onUnmounted(() => { disposed = true; });
</script>
<template>
  <section class="space-y-3 rounded-lg border border-gray-700 p-4">
    <h3 class="text-lg font-semibold">Sequential transmitters</h3>
    <p class="text-sm">Choose one transmitter or an ordered pair on each frequency. CAD must be explicitly off on both radios. Power is unchanged. Changes apply after restart.</p>
    <div v-for="group in groups" :key="group.primary_radio_id" class="space-y-2">
      <label :for="`tx-order-${group.primary_radio_id}`">{{ group.network }} transmit order</label>
      <div class="flex flex-wrap gap-2">
        <select :id="`tx-order-${group.primary_radio_id}`" v-model="drafts[group.primary_radio_id]" :disabled="busy" class="rounded border bg-gray-900 p-2">
          <option v-for="option in options(group)" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <button :disabled="busy || drafts[group.primary_radio_id] === group.radio_ids.join(',')" class="rounded border px-3 py-2" @click="save(group)">Save for restart</button>
      </div>
      <p class="text-sm">Running: {{ group.active_radio_ids?.join(' → ') || 'unavailable' }}. Saved: {{ group.radio_ids.join(' → ') }}.</p>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
    <button :disabled="busy" class="rounded border px-3 py-1" @click="load">Refresh saved settings</button>
  </section>
</template>
