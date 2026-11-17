<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ApiService from '@/utils/api';
type Options = { send_timeout: number; max_inflight: number; max_rx_tasks: number };
type Status = {
  enabled: boolean; running: boolean; listening: boolean; editable: boolean;
  service_control_available?: boolean; control_pending?: boolean;
  listener_port: number | null; node_id: string; enrollment_available: boolean;
  settings: Options; active_settings: Options | null; packet_ttl_ms: number;
  peers: { id: string; connected: boolean; last_valid_inbound_frame_age_seconds?: number | null }[];
  routes: { direction: string; peer: string; radio?: string; local_radio: string }[];
  pending_rf: number; dropped_tasks: number; transport_failures: number;
};
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const status = ref<Status | null>(null);
const options = ref<Options>({ send_timeout: 1, max_inflight: 4, max_rx_tasks: 16 });
const editing = ref(false);
const busy = ref(false);
const serviceBusy = ref(false);
const serviceMessage = ref('');
const serviceError = ref(false);
const refreshing = ref(false);
const message = ref('');
const error = ref('');
const autoRefresh = ref(true);
const discarding = ref(false);
const listenerState = computed(() => !status.value ? 'Loading' : status.value.listening ? 'Listening'
  : status.value.running ? 'Not listening' : status.value.enabled ? 'Unavailable' : 'Disabled');
const connectedPeers = computed(() => status.value?.peers.filter(peer => peer.connected).length ?? 0);
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
function frameAge(seconds?: number | null) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'Not recorded';
  const [value, unit] = seconds < 60 ? [Math.floor(seconds), 'second']
    : seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] : [Math.floor(seconds / 3600), 'hour'];
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
}
async function refresh(reset = false) {
  if (!props.active || refreshing.value || busy.value || serviceBusy.value) return;
  refreshing.value = true;
  discarding.value = reset;
  try {
    const response = await ApiService.get<Status>('/internet_link');
    if (!response.success || !response.data) throw new Error('status');
    if (disposed) return;
    status.value = response.data;
    if (reset || !editing.value) options.value = { ...response.data.settings };
    if (reset) editing.value = false;
    error.value = '';
  } catch { if (!disposed) error.value = 'Internet Link status could not be refreshed. Displayed values may be out of date.'; }
  finally { refreshing.value = false; discarding.value = false; }
}
async function save() {
  if (busy.value || serviceBusy.value || refreshing.value || !editing.value || !status.value?.editable) return;
  busy.value = true;
  message.value = '';
  try {
    const response = await ApiService.post('/update_internet_link', { ...options.value });
    if (!response.success) throw new Error('save');
    editing.value = false;
    message.value = 'Saved and applied. No restart is needed.';
  } catch { message.value = 'The save was not confirmed. Refresh status before trying again.'; }
  finally { busy.value = false; }
  await refresh();
}
async function setServiceEnabled(enabled: boolean) {
  if (!status.value?.service_control_available || status.value.control_pending || busy.value || serviceBusy.value || refreshing.value || error.value) return;
  serviceBusy.value = true;
  serviceMessage.value = '';
  serviceError.value = false;
  try {
    const response = await ApiService.post<{ live_updated?: boolean }>('/update_internet_link', { enabled });
    if (!response.success) throw new Error('service');
    serviceError.value = response.data?.live_updated !== true;
    serviceMessage.value = serviceError.value
      ? 'Your service setting was saved, but the running state could not be applied. Check the status below before trying again.'
      : enabled ? 'iLink is on. Approved devices can reconnect. This setting survives a restart.'
        : 'iLink is off. Peer sessions and enrollment are stopped. Local radio bridging is unchanged.';
  } catch {
    serviceError.value = true;
    serviceMessage.value = 'The service change was not confirmed. Refresh status before trying again.';
  } finally { serviceBusy.value = false; }
  await refresh();
}
function requestLeave(accept: () => void, cancel?: () => void) {
  if (busy.value || serviceBusy.value || discarding.value) { cancel?.(); return; }
  if (!editing.value || window.confirm('Discard unsaved Internet Link changes?')) accept();
  else cancel?.();
}
defineExpose({ isEditing: editing, requestLeave });
function updatePolling() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (!props.active) return;
  void refresh();
  timer = setInterval(() => { if (autoRefresh.value && !document.hidden) void refresh(); }, 5000);
}
watch(() => props.active, updatePolling);
onMounted(updatePolling);
onUnmounted(() => { disposed = true; if (timer) clearInterval(timer); });
</script>

<template>
  <section class="internet-link" aria-labelledby="internet-link-title">
    <header class="link-header">
      <div>
        <p class="eyebrow">Private transport</p>
        <div class="title-row"><h3 id="internet-link-title">Internet Link</h3><span class="badge" :class="{ connected: status?.listening }">{{ listenerState }}</span></div>
        <p class="intro">Connect enrolled devices to this bridge over the private TLS listener.</p>
      </div>
      <div class="refresh-controls">
        <button type="button" :disabled="busy || serviceBusy || refreshing" @click="refresh()">{{ refreshing ? 'Refreshing…' : 'Refresh status' }}</button>
        <label class="auto-refresh"><input v-model="autoRefresh" type="checkbox"> Refresh every 5 seconds</label>
      </div>
    </header>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="!status && !error" class="empty" role="status">Loading Internet Link status…</p>
    <template v-if="status">
      <section class="panel service-panel" aria-labelledby="ilink-service-title">
        <div class="service-heading">
          <div><h4 id="ilink-service-title">iLink service</h4><p id="ilink-service-help" class="muted">Turn off Internet Link connections and enrollment. Local radio bridging keeps running. The setting is saved for restarts.</p></div>
          <button type="button" role="switch" class="service-switch" data-testid="ilink-service-toggle"
            :aria-checked="status.enabled" aria-label="iLink service" aria-describedby="ilink-service-help"
            :disabled="!status.service_control_available || status.control_pending || busy || serviceBusy || refreshing || !!error"
            @click="setServiceEnabled(!status.enabled)">
            <span class="switch-track" :class="{ on: status.enabled }"><span /></span>
            {{ serviceBusy || status.control_pending ? 'Applying…' : status.enabled ? 'On' : 'Off' }}
          </button>
        </div>
        <p v-if="!status.service_control_available" class="muted">Service control is unavailable on this host.</p>
        <div v-else-if="status.enabled && !status.running && !serviceBusy && !status.control_pending" class="service-retry"><p class="muted">iLink is enabled in saved settings but is not running.</p><button type="button" data-testid="ilink-service-retry" :disabled="busy || refreshing || !!error" @click="setServiceEnabled(true)">Retry start</button></div>
        <p v-if="serviceMessage" class="notice" :class="{ error: serviceError }" :role="serviceError ? 'alert' : 'status'" aria-live="polite">{{ serviceMessage }}</p>
      </section>
      <dl class="metrics">
        <div><dt>Listener port</dt><dd>{{ status.listener_port ?? 'Not configured' }}</dd><small>{{ listenerState }}</small></div>
        <div><dt>Connected peers</dt><dd>{{ connectedPeers }} <span>/ {{ status.peers.length }}</span></dd><small>Of approved peers</small></div>
        <div><dt>Pending RF packets</dt><dd>{{ status.pending_rf }}</dd><small>Waiting for radio</small></div>
        <div><dt>Packet expiry</dt><dd>{{ status.packet_ttl_ms / 1000 }} <span>sec</span></dd><small>Maximum packet lifetime</small></div>
      </dl>
      <div class="connection-meta">
        <p><span>Host peer</span><strong class="peer-id">{{ status.node_id || 'Not configured' }}</strong></p>
        <p><span>Enrollment</span><strong>{{ status.enrollment_available ? 'Available' : 'Unavailable' }}</strong></p>
        <p><span>Since service start</span><strong>{{ status.dropped_tasks }} dropped tasks · {{ status.transport_failures }} transport failures</strong></p>
      </div>
      <div class="connection-grid">
        <section class="panel" aria-labelledby="approved-peers-title">
          <div class="panel-heading"><h4 id="approved-peers-title">Approved peers</h4><span class="badge">{{ status.peers.length }} configured</span></div>
          <p v-if="!status.peers.length" class="empty">No approved peers are configured.</p>
          <ul v-else class="peer-list"><li v-for="peer in status.peers" :key="peer.id">
            <div class="peer-heading"><strong class="peer-id">{{ peer.id }}</strong><span class="badge" :class="{ connected: peer.connected }">{{ peer.connected ? 'Connected' : 'Disconnected' }}</span></div>
            <small>Last valid inbound frame: {{ frameAge(peer.last_valid_inbound_frame_age_seconds) }}</small>
          </li></ul>
          <p class="context-note">A connected session confirms TLS authentication. Neither connection nor frame activity confirms RF delivery or a recipient acknowledgement. A new connection alone does not refresh frame activity.</p>
        </section>
        <section class="panel" aria-labelledby="link-routes-title">
          <div class="panel-heading"><h4 id="link-routes-title">Current routes</h4><span class="badge">{{ status.routes.length }} configured</span></div>
          <p v-if="!status.routes.length" class="empty">No Internet Link routes are configured.</p>
          <ul v-else class="route-list"><li v-for="(route, index) in status.routes" :key="index">
            <span class="route-direction">{{ route.direction === 'inbound' ? 'Inbound' : 'Outbound' }}</span>
            <p v-if="route.direction === 'inbound'">{{ route.peer }} / {{ route.radio }} <span>to local radio</span> {{ route.local_radio }}</p>
            <p v-else><span>Local radio</span> {{ route.local_radio }} <span>to</span> {{ route.peer }}</p>
          </li></ul>
          <p class="context-note">Endpoint, certificates, approved peers and enrollment permissions are managed by the host configuration.</p>
        </section>
      </div>
      <section class="panel traffic-panel" aria-labelledby="traffic-options-title">
        <div class="panel-heading"><div><h4 id="traffic-options-title">Traffic options</h4><p class="muted">Saving applies these limits immediately and retains them after restart.</p></div><span class="badge" :class="{ unsaved: editing }">{{ editing ? 'Unsaved changes' : 'No restart needed' }}</span></div>
        <p v-if="!status.editable" class="notice">Traffic options are available when the listener is running.</p>
        <form @submit.prevent="save" @input="editing = true; message = ''">
          <fieldset :disabled="busy || serviceBusy || discarding || !status.editable">
            <legend class="sr-only">Internet Link traffic limits</legend>
            <div class="fields-grid">
              <div class="field"><label for="link-timeout">Send timeout <span>seconds</span></label>
                <input id="link-timeout" v-model.number="options.send_timeout" data-testid="link-timeout" aria-describedby="link-timeout-help" type="number" min="0.01" max="5" step="any" required>
                <small id="link-timeout-help">Stop an Internet Link send after this time. Failed sends are not retried.</small>
              </div>
              <div class="field"><label for="link-inflight">Packets in flight per peer</label>
                <input id="link-inflight" v-model.number="options.max_inflight" data-testid="link-inflight" aria-describedby="link-inflight-help" type="number" min="1" max="64" step="1" required>
                <small id="link-inflight-help">Limit concurrent sends per peer and concurrent incoming packets.</small>
              </div>
              <div class="field"><label for="link-tasks">Receive task limit</label>
                <input id="link-tasks" v-model.number="options.max_rx_tasks" data-testid="link-tasks" aria-describedby="link-tasks-help" type="number" min="1" max="64" step="1" required>
                <small id="link-tasks-help">Limit pending RF ingress tasks and peer packets waiting for local routing.</small>
              </div>
            </div>
            <div class="save-bar"><p>{{ busy ? 'Applying traffic limits…' : editing ? 'These changes apply separately from bridge settings.' : 'Traffic limits are up to date.' }}</p><div class="save-actions"><button type="button" :disabled="!editing || refreshing" @click="refresh(true)">Discard changes</button><button class="primary" type="submit" :disabled="!editing || refreshing">{{ busy ? 'Applying…' : 'Save Internet Link options' }}</button></div></div>
          </fieldset>
        </form>
        <p v-if="message" class="notice" role="status" aria-live="polite">{{ message }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.service-panel { margin-bottom: 1rem; }
.service-heading, .service-retry { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.service-heading > div { max-width: 42rem; }
.service-switch { display: flex; align-items: center; gap: .6rem; flex-shrink: 0; min-width: 100px; }
.switch-track { width: 2.3rem; height: 1.3rem; border-radius: 1rem; background: var(--color-border); padding: .15rem; }
.switch-track > span { display: block; width: 1rem; height: 1rem; border-radius: 50%; background: var(--color-text-muted); transition: transform .15s; }
.switch-track.on { background: var(--color-badge-cyan-bg); }
.switch-track.on > span { background: var(--color-accent-cyan); transform: translateX(1rem); }
.service-retry { margin-top: .75rem; }
.internet-link { color: var(--color-text-secondary); }
h3, h4 { color: var(--color-heading); font-weight: 650; }
h3 { font-size: 1.25rem; } h4 { font-size: .95rem; }
p { line-height: 1.6; }
.link-header, .title-row, .panel-heading, .peer-heading, .save-bar, .save-actions { display: flex; justify-content: space-between; align-items: center; gap: .75rem; }
.link-header { align-items: flex-start; gap: 1.5rem; margin-bottom: 1.25rem; }
.title-row { justify-content: flex-start; flex-wrap: wrap; }
.eyebrow { color: var(--color-badge-cyan-text); font-size: .7rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; margin-bottom: .3rem; }
.intro { font-size: .85rem; margin-top: .35rem; }
.refresh-controls { display: flex; flex-direction: column; align-items: flex-end; gap: .6rem; flex-shrink: 0; }
.auto-refresh { display: flex; align-items: center; gap: .5rem; font-size: .75rem; color: var(--color-text-muted); }
.auto-refresh input { accent-color: var(--color-primary); }
.badge { display: inline-block; width: fit-content; background: var(--color-badge-neutral-bg); color: var(--color-badge-neutral-text); padding: .22rem .5rem; border-radius: .35rem; font-size: .68rem; font-weight: 600; line-height: 1.5; white-space: nowrap; }
.connected { background: var(--color-badge-cyan-bg); color: var(--color-badge-cyan-text); }
.unsaved { background: var(--color-badge-amber-bg); color: var(--color-badge-amber-text); }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; }
.metrics > div { border: 1px solid var(--color-border-subtle); border-radius: .75rem; padding: 1rem; background: var(--color-surface-elevated); min-width: 0; }
dt { font-size: .75rem; font-weight: 600; } dd { color: var(--color-text-primary); font-size: 1.6rem; font-weight: 650; font-variant-numeric: tabular-nums; margin: .3rem 0; overflow-wrap: anywhere; } dd span { color: var(--color-text-muted); font-weight: 400; font-size: 1rem; }
small { color: var(--color-text-muted); font-size: .73rem; line-height: 1.6; }
.connection-meta { display: flex; flex-wrap: wrap; gap: 1rem 2rem; padding: 1rem .15rem 1.25rem; }
.connection-meta p { display: flex; flex-direction: column; gap: .1rem; min-width: 0; font-size: .75rem; }
.connection-meta span { color: var(--color-text-muted); } .connection-meta strong { font-weight: 500; }
.connection-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
.panel { border: 1px solid var(--color-border-subtle); background: var(--color-surface); border-radius: .75rem; padding: 1.1rem; min-width: 0; }
.panel-heading { flex-wrap: wrap; margin-bottom: 1rem; }
.peer-list, .route-list { list-style: none; padding: 0; margin: 0; }
.peer-list li, .route-list li { padding: .8rem 0; border-top: 1px solid var(--color-border-subtle); overflow-wrap: anywhere; }
.peer-heading { flex-wrap: wrap; margin-bottom: .3rem; font-size: .8rem; }
.peer-id { overflow-wrap: anywhere; }
.route-direction { color: var(--color-badge-cyan-text); font-size: .68rem; font-weight: 600; }
.route-list p { font-size: .8rem; margin-top: .2rem; } .route-list p span { color: var(--color-text-muted); }
.context-note { font-size: .73rem; color: var(--color-text-muted); margin-top: .75rem; border-top: 1px solid var(--color-border-subtle); padding-top: .85rem; }
.muted { font-size: .78rem; color: var(--color-text-muted); margin-top: .3rem; }
.empty { padding: 1.25rem .5rem; color: var(--color-text-muted); font-size: .8rem; text-align: center; }
fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
.fields-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.25rem; }
.field { display: flex; flex-direction: column; gap: .45rem; min-width: 0; }
.field label { font-size: .78rem; font-weight: 600; color: var(--color-text-primary); } .field label span { color: var(--color-text-muted); font-weight: 400; margin-left: .2rem; }
input[type=number] { width: 100%; min-width: 0; padding: .65rem .75rem; border: 1px solid var(--color-border); border-radius: .45rem; background: var(--color-surface-elevated); color: var(--color-text-primary); font-size: .85rem; }
.save-bar { flex-wrap: wrap; border-top: 1px solid var(--color-border-subtle); margin-top: 1.25rem; padding-top: 1rem; }
.save-bar p { color: var(--color-text-muted); font-size: .75rem; }
.save-actions { flex-wrap: wrap; }
button { min-height: 40px; border: 1px solid var(--color-border); border-radius: .45rem; padding: .5rem .8rem; background: var(--color-surface-elevated); color: var(--color-text-primary); font-size: .75rem; font-weight: 600; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--color-border-hover); background: var(--color-background-soft); }
button.primary { background: var(--color-badge-cyan-bg); border-color: var(--color-accent-cyan); color: var(--color-badge-cyan-text); }
button:disabled, fieldset:disabled button, fieldset:disabled input { opacity: .5; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
.notice { padding: .75rem .85rem; margin: .8rem 0; border-radius: .45rem; background: var(--color-background-soft); font-size: .78rem; border-left: 2px solid var(--color-border-hover); }
.error { color: var(--color-badge-red-text); background: var(--color-badge-red-bg); border-color: var(--color-accent-red); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1000px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .fields-grid { grid-template-columns: 1fr; } .connection-grid { grid-template-columns: 1fr; } }
@media (max-width: 580px) { .service-heading, .service-retry { align-items: flex-start; flex-wrap: wrap; } .link-header { flex-direction: column; } .refresh-controls { flex-direction: row; flex-wrap: wrap; align-items: center; } .metrics > div { padding: .75rem; } .panel { padding: .85rem; } .save-actions { width: 100%; } .save-actions button { flex: 1; } }
</style>
