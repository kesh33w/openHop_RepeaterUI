<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ApiService from '@/utils/api';
import type { BridgeDiagnostics as BridgeDiagnosticsResponse } from '@/generated/openapi';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';
const { radioLabel } = useMultiRadioConfig();
type RequiredTree<T> = T extends (infer Item)[] ? RequiredTree<Item>[] : T extends object ? { [Key in keyof T]-?: RequiredTree<NonNullable<T[Key]>> } : T;
type Diagnostics = RequiredTree<BridgeDiagnosticsResponse>;
const props = withDefaults(defineProps<{ running?: boolean | null; active?: boolean }>(), { active: true });
const diagnostics = ref<Diagnostics | null>(null);
const error = ref('');
const loading = ref(false);
const autoRefresh = ref(true);
const directionFilter = ref('');
const statusFilter = ref('');
const page = ref(1);
const pageSize = 10;
const expandedId = ref<string | null>(null);
const updatedAt = ref<string | null>(null);
const inspecting = computed(() => page.value > 1 || expandedId.value !== null);
const recent = computed(() => diagnostics.value?.reception.recent ?? []);
const directionKey = (source: string, target: string) => JSON.stringify([source, target]);
const directions = computed(() => {
  const options = new Map<string, string>();
  for (const item of recent.value) options.set(directionKey(item.source_radio, item.target_radio), `${radioLabel(item.source_radio)} → ${radioLabel(item.target_radio)}`);
  return [...options].map(([value, name]) => ({ value, name }));
});
const filtered = computed(() => recent.value.filter(item =>
  (!directionFilter.value || directionKey(item.source_radio, item.target_radio) === directionFilter.value)
  && (!statusFilter.value || item.tx_state === statusFilter.value || item.reception_state === statusFilter.value),
));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
watch([directionFilter, statusFilter], () => { page.value = 1; expandedId.value = null; });
watch(pageCount, value => { page.value = Math.min(page.value, value); });
const pending = computed(() => diagnostics.value?.traffic.directions.reduce((total, direction) => total + direction.pending, 0) ?? 0);
function utilization(value: number) {
  const limit = diagnostics.value?.traffic.limits.max_pending_per_direction ?? 0;
  return limit > 0 ? Math.min(100, Math.max(0, value / limit * 100)) : 0;
}
function tone(state: string) {
  if (state === 'tx_failed') return 'failed';
  if (state === 'tx_uncertain' || state === 'unconfirmed') return 'uncertain';
  if (state === 'observed' || state === 'tx_confirmed') return 'confirmed';
  return '';
}
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
    updatedAt.value = new Date().toISOString();
    error.value = '';
  } catch { if (!disposed) error.value = 'Bridge diagnostics are unavailable. Any displayed values may be out of date.'; }
  finally { loading.value = false; }
}
watch(() => props.active, active => { if (active && !inspecting.value) void refresh(); });
onMounted(() => {
  if (props.active) void refresh();
  timer = setInterval(() => { if (props.active && autoRefresh.value && !inspecting.value && !document.hidden) void refresh(); }, 5000);
});
onUnmounted(() => { disposed = true; if (timer) clearInterval(timer); });
</script>

<template>
  <section class="bridge-diagnostics" aria-labelledby="bridge-diagnostics-title">
    <header class="diagnostics-header">
      <div>
        <p class="eyebrow">Live activity</p>
        <h3 id="bridge-diagnostics-title">Crossing diagnostics</h3>
        <p class="muted">Follow traffic from the bridge queue to independent reception.</p>
      </div>
      <div class="refresh-controls">
        <button type="button" class="cfg-btn-secondary" :disabled="loading" @click="refresh">{{ loading ? 'Refreshing…' : 'Refresh diagnostics' }}</button>
        <label class="auto-refresh"><input v-model="autoRefresh" type="checkbox"> Auto-refresh · 5s</label>
      </div>
    </header>
    <p v-if="error" role="alert" class="notice failed-notice">{{ error }}</p>
    <p class="refresh-note muted" role="status">
      <template v-if="updatedAt">Updated {{ timestamp(updatedAt) }}.</template>
      <template v-if="autoRefresh && inspecting"> Auto-refresh paused while you inspect crossings.</template>
      <template v-else-if="!autoRefresh"> Auto-refresh is off.</template>
      <template v-else-if="!diagnostics && loading">Loading crossing activity…</template>
    </p>

    <template v-if="diagnostics">
      <div class="stats-grid">
        <div class="stat"><span>Pending crossings</span><strong>{{ pending }}</strong><small>Waiting in directional queues</small></div>
        <div class="stat"><span>Observed externally</span><strong>{{ diagnostics.reception.counts.observed ?? 0 }}</strong><small>Independent receiver reports</small></div>
        <div class="stat"><span>Unconfirmed</span><strong>{{ diagnostics.reception.counts.unconfirmed ?? 0 }}</strong><small>No observer confirmation</small></div>
        <div class="stat"><span>TX failed / uncertain</span><strong>{{ diagnostics.reception.counts.tx_failed ?? 0 }} <span>/</span> {{ diagnostics.reception.counts.tx_uncertain ?? 0 }}</strong><small>Local transmission outcomes</small></div>
      </div>

      <div class="operations-grid">
        <section class="operation-panel" aria-labelledby="directional-limits-title">
          <div class="panel-heading"><h4 id="directional-limits-title">Directional limits</h4><span class="badge">Since service start</span></div>
          <p v-if="running !== true" class="notice">{{ running === false ? 'The bridge is not running. Displayed limits may be defaults; no active bridge traffic is implied.' : 'Running bridge state is unverified. Displayed limits may be defaults.' }}</p>
          <p class="limits"><strong>{{ diagnostics.traffic.limits.per_minute }}</strong> flood crossings/min <span>·</span> <strong>{{ diagnostics.traffic.limits.burst }}</strong> burst <span>·</span> <strong>{{ diagnostics.traffic.limits.max_pending_per_direction }}</strong> pending/direction</p>
          <p v-if="!diagnostics.traffic.directions.length" class="empty">No crossing activity has been recorded.</p>
          <ul class="direction-list">
            <li v-for="direction in diagnostics.traffic.directions" :key="directionKey(direction.source_radio, direction.target_radio)">
              <div class="direction-heading"><strong>{{ radioLabel(direction.source_radio) }} → {{ radioLabel(direction.target_radio) }}</strong><span>{{ direction.pending }} / {{ diagnostics.traffic.limits.max_pending_per_direction }} pending</span></div>
              <div class="utilization" role="meter" :aria-label="`${radioLabel(direction.source_radio)} to ${radioLabel(direction.target_radio)} pending capacity`" :aria-valuenow="direction.pending" :aria-valuemax="Math.max(direction.pending, diagnostics.traffic.limits.max_pending_per_direction)" aria-valuemin="0"><span :style="{ width: utilization(direction.pending) + '%' }"></span></div>
              <p class="muted">{{ direction.admitted }} admitted <span>·</span> {{ direction.rate_limited }} rate-limited <span>·</span> {{ direction.queue_full }} queue-full</p>
            </li>
          </ul>
          <details class="help-details"><summary>How limits apply</summary><p>Rate and burst limits apply to flood crossings. Direct and TRACE traffic bypass that rate budget but remain subject to pending limits. An admitted crossing is not a confirmed transmission.</p></details>
        </section>

        <section class="operation-panel" aria-labelledby="independent-reception-title">
          <div class="panel-heading"><h4 id="independent-reception-title">Independent reception</h4><span class="badge" :class="{ confirmed: diagnostics.reception.enabled }">{{ diagnostics.reception.enabled ? 'Enabled' : 'Not configured' }}</span></div>
          <p class="muted">A modem-confirmed TX means the radio reported sending. An independent observer report means an allowlisted external receiver heard matching traffic. Neither proves delivery to a particular person or device.</p>
          <p v-if="!diagnostics.reception.enabled" class="notice">Independent reception evidence is not configured. Approved observer identities and broker feeds are managed in the host configuration. No observation is inferred from local RX or bridge echoes.</p>
          <template v-else>
            <p class="window-label">{{ diagnostics.reception.window_seconds }}s observation window</p>
            <p v-if="!diagnostics.reception.feeds.length" class="empty">No observer feeds reported.</p>
            <ul class="feed-list">
              <li v-for="feed in diagnostics.reception.feeds" :key="feed.broker">
                <div class="direction-heading"><strong>{{ feed.broker }}</strong><span class="badge" :class="{ confirmed: feed.state === 'connected' }">{{ label(feed.state) }}</span></div>
                <p class="muted">{{ feed.accepted }} reports accepted · {{ feed.ignored }} ignored</p>
                <p class="muted">Last report: {{ timestamp(feed.last_report_at) }}</p>
              </li>
            </ul>
            <p class="muted">No observer confirmation means unconfirmed, not a proven delivery failure.</p>
          </template>
        </section>
      </div>

      <section class="crossings-panel" aria-labelledby="recent-crossings-title">
        <div class="panel-heading"><div><h4 id="recent-crossings-title">Recent crossings</h4><p class="muted">The latest {{ recent.length }} tracked crossings. Transmission and reception are separate outcomes.</p></div></div>
        <div class="filters">
          <label>Direction<select v-model="directionFilter" aria-label="Filter by direction"><option value="">All directions</option><option v-for="direction in directions" :key="direction.value" :value="direction.value">{{ direction.name }}</option></select></label>
          <label>Status<select v-model="statusFilter" aria-label="Filter by status"><option value="">All outcomes</option><optgroup label="Modem transmission"><option v-for="(name, value) in txLabels" :key="value" :value="value">{{ name }}</option></optgroup><optgroup label="Independent reception"><option v-for="(name, value) in receptionLabels" :key="value" :value="value">{{ name }}</option></optgroup></select></label>
          <p class="muted">{{ filtered.length }} matching {{ filtered.length === 1 ? 'crossing' : 'crossings' }}</p>
        </div>
        <p v-if="!recent.length" class="empty">No tracked crossings yet.</p>
        <p v-else-if="!filtered.length" class="empty">No crossings match these filters.</p>
        <ol class="crossings-list">
          <li v-for="item in visible" :key="item.id" class="crossing-row" data-testid="crossing-row">
            <div class="crossing-overview">
              <div class="crossing-route"><strong>{{ radioLabel(item.source_radio) }} → {{ radioLabel(item.target_radio) }}</strong><span>{{ packetLabel(item.packet_type) }}</span><time class="muted">{{ timestamp(item.started_at) }}</time></div>
              <div class="outcome"><span class="field-label">Modem TX</span><span class="badge" :class="tone(item.tx_state)">{{ txLabels[item.tx_state] || label(item.tx_state) }}</span></div>
              <div class="outcome"><span class="field-label">External reception</span><span class="badge" :class="tone(item.reception_state)">{{ receptionLabels[item.reception_state] || label(item.reception_state) }}</span></div>
              <button type="button" class="evidence-button" :aria-expanded="expandedId === item.id" @click="expandedId = expandedId === item.id ? null : item.id">{{ expandedId === item.id ? 'Hide details' : 'View details' }}<span v-if="item.observers.length"> · {{ item.observers.length }}</span></button>
            </div>
            <div v-if="expandedId === item.id" class="evidence">
              <p><span class="field-label">Crossing ID</span> {{ item.id }}</p>
              <p><span class="field-label">Observation deadline</span> {{ timestamp(item.deadline) }}</p>
              <h5>Observer evidence</h5>
              <p v-if="!item.observers.length" class="muted">No independent observer evidence recorded for this crossing.</p>
              <ul v-else>
                <li v-for="(observer, index) in item.observers" :key="index">
                  <strong>{{ observer.broker }} / {{ radioLabel(observer.radio_id) }}</strong>
                  <p>{{ label(observer.match) }}<template v-if="observer.trace_progress != null"> · TRACE progress: {{ observer.trace_progress }}</template></p>
                  <p>Observed {{ timestamp(observer.observed_at) }} · Received {{ timestamp(observer.received_at) }}</p>
                  <p class="public-key"><span class="field-label">Observer key</span> {{ observer.public_key }}</p>
                </li>
              </ul>
            </div>
          </li>
        </ol>
        <nav v-if="filtered.length" class="pagination" aria-label="Crossing pages">
          <span class="muted">{{ (page - 1) * pageSize + 1 }}–{{ Math.min(page * pageSize, filtered.length) }} of {{ filtered.length }}</span>
          <div><button type="button" class="cfg-btn-secondary" :disabled="page === 1" @click="page--; expandedId = null">Previous</button><span>Page {{ page }} of {{ pageCount }}</span><button type="button" class="cfg-btn-secondary" :disabled="page === pageCount" @click="page++; expandedId = null">Next</button></div>
        </nav>
      </section>
    </template>
  </section>
</template>

<style scoped>
.bridge-diagnostics { color: var(--color-text-secondary); }
.diagnostics-header, .panel-heading, .direction-heading, .pagination, .pagination > div { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.diagnostics-header { align-items: flex-start; margin-bottom: .75rem; }
h3 { color: var(--color-heading); font-size: 1.25rem; font-weight: 650; }
h4 { color: var(--color-heading); font-size: .95rem; font-weight: 650; }
h5 { font-weight: 650; margin-top: .8rem; }
p { line-height: 1.6; }
.eyebrow { color: var(--color-badge-cyan-text); font-size: .7rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; margin-bottom: .3rem; }
.muted { color: var(--color-text-muted); font-size: .8rem; }
.refresh-controls { display: flex; flex-direction: column; align-items: flex-end; gap: .6rem; flex-shrink: 0; }
.auto-refresh { display: flex; gap: .5rem; align-items: center; font-size: .75rem; color: var(--color-text-muted); }
.auto-refresh input { accent-color: var(--color-primary); }
.refresh-note { min-height: 1.3rem; margin-bottom: 1rem; }
.stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin-bottom: 1rem; }
.stat { display: flex; flex-direction: column; border: 1px solid var(--color-border-subtle); border-radius: .75rem; padding: 1rem; background: var(--color-surface-elevated); }
.stat > span { font-size: .75rem; font-weight: 600; }
.stat > strong { color: var(--color-text-primary); font-size: 1.8rem; font-variant-numeric: tabular-nums; margin: .3rem 0; line-height: 1.3; }
.stat strong span { color: var(--color-text-muted); font-weight: 400; }
.stat small { color: var(--color-text-muted); font-size: .7rem; }
.operations-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }
.operation-panel, .crossings-panel { border: 1px solid var(--color-border-subtle); border-radius: .75rem; padding: 1.1rem; min-width: 0; background: var(--color-surface); }
.panel-heading { margin-bottom: .8rem; flex-wrap: wrap; }
.badge { display: inline-block; width: fit-content; background: var(--color-badge-neutral-bg); color: var(--color-badge-neutral-text); padding: .22rem .5rem; border-radius: .35rem; font-size: .68rem; font-weight: 600; line-height: 1.5; }
.confirmed { background: var(--color-badge-cyan-bg); color: var(--color-badge-cyan-text); }
.failed { background: var(--color-badge-red-bg); color: var(--color-badge-red-text); }
.uncertain { background: var(--color-badge-amber-bg); color: var(--color-badge-amber-text); }
.notice { padding: .7rem .85rem; margin-bottom: .8rem; border-radius: .4rem; background: var(--color-background-soft); font-size: .78rem; border-left: 2px solid var(--color-border-hover); }
.failed-notice { color: var(--color-badge-red-text); background: var(--color-badge-red-bg); border-color: var(--color-accent-red); }
.limits { font-size: .78rem; }
.limits > span, .direction-list p > span { color: var(--color-text-muted); margin: 0 .2rem; }
.direction-list, .feed-list, .crossings-list, .evidence ul { list-style: none; padding: 0; margin: 0; }
.direction-list li, .feed-list li { margin-top: .9rem; padding-top: .85rem; border-top: 1px solid var(--color-border-subtle); overflow-wrap: anywhere; }
.direction-heading { font-size: .8rem; flex-wrap: wrap; gap: .4rem; }
.direction-heading > span:not(.badge) { color: var(--color-text-muted); font-size: .75rem; }
.utilization { height: 5px; background: var(--color-background-mute); border-radius: 8px; overflow: hidden; margin: .65rem 0 .4rem; }
.utilization span { display: block; height: 100%; background: var(--color-accent-cyan); border-radius: inherit; }
.help-details { margin-top: 1rem; color: var(--color-text-muted); font-size: .75rem; }
.help-details summary { cursor: pointer; color: var(--color-text-secondary); }
.help-details p { margin-top: .5rem; }
.window-label { font-size: .75rem; margin-top: .8rem; font-weight: 600; }
.feed-list { margin-bottom: .9rem; }
.filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: .75rem; padding-bottom: 1rem; }
.filters label { display: flex; flex-direction: column; gap: .35rem; font-size: .72rem; font-weight: 600; }
.filters select { color: var(--color-text-primary); background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: .4rem; padding: .5rem 2rem .5rem .6rem; min-height: 36px; max-width: 100%; font-size: .78rem; }
.filters > p { margin-left: auto; padding-bottom: .4rem; }
.crossing-row { border-top: 1px solid var(--color-border-subtle); padding: .85rem 0; }
.crossing-overview { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.2fr) auto; align-items: center; gap: .75rem; }
.crossing-route { display: flex; flex-direction: column; gap: .15rem; min-width: 0; font-size: .78rem; overflow-wrap: anywhere; }
.crossing-route strong { color: var(--color-text-primary); }
.crossing-route time { font-size: .7rem; }
.outcome { display: flex; flex-direction: column; gap: .35rem; }
.field-label { font-size: .65rem; color: var(--color-text-muted); }
.evidence-button { color: var(--color-badge-cyan-text); font-size: .75rem; padding: .5rem; border-radius: .35rem; white-space: nowrap; cursor: pointer; }
.evidence-button:hover { background: var(--color-badge-cyan-bg); }
button:focus-visible, select:focus-visible, summary:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
.evidence { background: var(--color-surface-elevated); padding: .85rem; margin-top: .8rem; border-radius: .5rem; font-size: .75rem; overflow-wrap: anywhere; }
.evidence li { padding: .75rem 0; border-bottom: 1px solid var(--color-border-subtle); }
.evidence li:last-child { border: 0; padding-bottom: 0; }
.public-key { font-family: monospace; margin-top: .3rem; }
.pagination { border-top: 1px solid var(--color-border-subtle); padding-top: 1rem; font-size: .75rem; flex-wrap: wrap; }
.pagination > div { gap: .7rem; }
.empty { padding: 1.2rem .5rem; color: var(--color-text-muted); font-size: .8rem; text-align: center; }
@media (max-width: 1000px) { .operations-grid { grid-template-columns: 1fr; } .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .crossing-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } .evidence-button { justify-self: start; } }
@media (max-width: 580px) { .diagnostics-header { flex-direction: column; } .refresh-controls { flex-direction: row; align-items: center; flex-wrap: wrap; } .stat { padding: .75rem; } .operation-panel, .crossings-panel { padding: .85rem; } .filters label { width: 100%; } .filters > p { margin-left: 0; } .pagination > div { flex-wrap: wrap; } }
</style>
