<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import ApiService from '@/utils/api';
import type { BridgeDiagnostics as BridgeDiagnosticsResponse } from '@/generated/openapi';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';
const { radioLabel } = useMultiRadioConfig();
type RequiredTree<T> = T extends (infer Item)[] ? RequiredTree<Item>[] : T extends object ? { [Key in keyof T]-?: RequiredTree<NonNullable<T[Key]>> } : T;
type Diagnostics = RequiredTree<BridgeDiagnosticsResponse>;
defineProps<{ running?: boolean | null }>();
const diagnostics = ref<Diagnostics | null>(null);
const error = ref('');
const loading = ref(false);
const autoRefresh = ref(true);
let disposed = false;
let timer: ReturnType<typeof setInterval> | undefined;
const txLabels: Record<string, string> = { pending: 'Queued', tx_confirmed: 'Modem confirmed TX', tx_failed: 'TX failed', tx_uncertain: 'TX outcome uncertain' };
const receptionLabels: Record<string, string> = { waiting: 'Waiting for observer', observed: 'Independent observer heard it', unconfirmed: 'No observer confirmation', not_applicable: 'Not applicable' };
const packetTypes: Record<number, string> = {0:'Request',1:'Response',2:'Encrypted text message',3:'Acknowledgment',4:'Node advertisement',5:'Group text message',6:'Group datagram',7:'Anonymous request',8:'Returned path',9:'TRACE',10:'Multipart packet',15:'Custom packet'};
function packetLabel(value: number) { return packetTypes[value] || `Packet type ${value}`; }
function label(value: string) { return value.replace(/_/g, ' '); }
function timestamp(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    const response = await ApiService.get<Diagnostics>('/bridge_diagnostics');
    if (!response.success || !response.data?.reception || !response.data?.traffic) throw new Error('status');
    if (disposed) return;
    diagnostics.value = response.data;
    error.value = '';
  } catch { if (!disposed) error.value = 'Bridge diagnostics are unavailable. Any displayed values may be out of date.'; }
  finally { loading.value = false; }
}
onMounted(() => {
  void refresh();
  timer = setInterval(() => { if (autoRefresh.value && !document.hidden) void refresh(); }, 5000);
});
onUnmounted(() => { disposed = true; if (timer) clearInterval(timer); });
</script>

<template>
  <section class="cfg-section bridge-diagnostics" aria-labelledby="bridge-diagnostics-title">
    <h3 id="bridge-diagnostics-title">Crossing diagnostics</h3>
    <div class="flex flex-wrap gap-3 items-center">
      <button type="button" class="cfg-btn-secondary" :disabled="loading" @click="refresh">Refresh diagnostics</button>
      <label><input v-model="autoRefresh" type="checkbox"> Refresh every 5 seconds</label>
    </div>
    <p v-if="error" role="alert" class="text-accent-red">{{ error }}</p>
    <template v-if="diagnostics">
      <h4>Directional limits</h4>
      <p v-if="running !== true">{{ running === false ? 'The bridge is not running. Displayed limits may be defaults; no active bridge traffic is implied.' : 'Running bridge state is unverified. Displayed limits may be defaults.' }}</p>
      <p>{{ diagnostics.traffic.limits.per_minute }} flood crossings/minute, burst {{ diagnostics.traffic.limits.burst }}, up to {{ diagnostics.traffic.limits.max_pending_per_direction }} pending crossings per direction.</p>
      <p>Rate and burst limits apply to flood crossings. Direct and TRACE traffic bypass that rate budget but remain subject to pending limits.</p>
      <p>Counters are since service start. An admitted crossing is not a confirmed transmission.</p>
      <p v-if="!diagnostics.traffic.directions.length">No crossing activity has been recorded.</p>
      <ul><li v-for="direction in diagnostics.traffic.directions" :key="`${direction.source_radio}:${direction.target_radio}`">
        <strong>{{ radioLabel(direction.source_radio) }} → {{ radioLabel(direction.target_radio) }}</strong>:
        {{ direction.pending }} pending, {{ direction.admitted }} admitted, {{ direction.rate_limited }} rate-limited, {{ direction.queue_full }} queue-full.
      </li></ul>
      <h4>Independent reception</h4>
      <p>A modem-confirmed TX means the radio reported sending. An independent observer report means an allowlisted external receiver heard matching traffic. Neither proves delivery to a particular person or device.</p>
      <p v-if="!diagnostics.reception.enabled">Independent reception evidence is not configured. Approved observer identities and broker feeds are managed in the host configuration. No observation is inferred from local RX or bridge echoes.</p>
      <template v-else>
        <p>Observation window: {{ diagnostics.reception.window_seconds }} seconds. No observer confirmation means unconfirmed, not a proven delivery failure.</p>
        <ul><li v-for="feed in diagnostics.reception.feeds" :key="feed.broker"><strong>{{ feed.broker }}</strong>: {{ label(feed.state) }}. {{ feed.accepted }} reports accepted, {{ feed.ignored }} ignored. Last report: {{ timestamp(feed.last_report_at) }}.</li></ul>
      </template>
      <p>Observed: {{ diagnostics.reception.counts.observed ?? 0 }} · Unconfirmed: {{ diagnostics.reception.counts.unconfirmed ?? 0 }} · TX failed: {{ diagnostics.reception.counts.tx_failed ?? 0 }} · TX uncertain: {{ diagnostics.reception.counts.tx_uncertain ?? 0 }}</p>
      <p v-if="!diagnostics.reception.recent.length">No tracked crossings yet.</p>
      <ol class="space-y-3">
        <li v-for="item in diagnostics.reception.recent" :key="item.id" class="border border-stroke-subtle rounded-lg p-3">
          <strong>{{ radioLabel(item.source_radio) }} → {{ radioLabel(item.target_radio) }}</strong>
          <p>{{ packetLabel(item.packet_type) }} · {{ timestamp(item.started_at) }}</p>
          <p>{{ txLabels[item.tx_state] || label(item.tx_state) }} · {{ receptionLabels[item.reception_state] || label(item.reception_state) }}</p>
          <details v-if="item.observers.length"><summary>Observer evidence</summary>
            <ul><li v-for="(observer, index) in item.observers" :key="index">{{ observer.broker }} / {{ radioLabel(observer.radio_id) }} · {{ label(observer.match) }} · {{ timestamp(observer.observed_at) }}<br><span class="break-all">{{ observer.public_key }}</span></li></ul>
          </details>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.bridge-diagnostics { border-top: 1px solid var(--color-stroke-subtle); padding-top: 1rem; margin-top: 2rem; }
h3,h4 { font-weight: 600; margin: 1rem 0; }
p { margin: .75rem 0; }
li { overflow-wrap: anywhere; }
summary { cursor: pointer; }
</style>
