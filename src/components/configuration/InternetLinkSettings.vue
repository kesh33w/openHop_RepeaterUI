<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import ApiService from '@/utils/api';
type Options = { send_timeout: number; max_inflight: number; max_rx_tasks: number };
type Status = {
  enabled: boolean; running: boolean; listening: boolean; editable: boolean;
  listener_port: number | null; node_id: string; enrollment_available: boolean;
  settings: Options; active_settings: Options | null; packet_ttl_ms: number;
  peers: { id: string; connected: boolean }[];
  routes: { direction: string; peer: string; radio?: string; local_radio: string }[];
  pending_rf: number; dropped_tasks: number; transport_failures: number;
};
const status = ref<Status | null>(null);
const options = ref<Options>({ send_timeout: 1, max_inflight: 4, max_rx_tasks: 16 });
const editing = ref(false);
const busy = ref(false);
const refreshing = ref(false);
const message = ref('');
const error = ref('');
const autoRefresh = ref(true);
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
async function refresh(reset = false) {
  if (refreshing.value || busy.value) return;
  refreshing.value = true;
  try {
    const response = await ApiService.get<Status>('/internet_link');
    if (!response.success || !response.data) throw new Error('status');
    if (disposed) return;
    status.value = response.data;
    if (reset || !editing.value) options.value = { ...response.data.settings };
    if (reset) editing.value = false;
    error.value = '';
  } catch { if (!disposed) error.value = 'Internet Link status could not be refreshed. Displayed values may be out of date.'; }
  finally { refreshing.value = false; }
}
async function save() {
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
function requestLeave(accept: () => void, cancel?: () => void) {
  if (!editing.value || window.confirm('Discard unsaved Internet Link changes?')) accept();
  else cancel?.();
}
defineExpose({ isEditing: editing, requestLeave });
onMounted(() => {
  void refresh();
  timer = setInterval(() => { if (autoRefresh.value && !document.hidden) void refresh(); }, 5000);
});
onUnmounted(() => { disposed = true; if (timer) clearInterval(timer); });
</script>

<template>
  <section class="internet-link" aria-labelledby="internet-link-title">
    <h3 id="internet-link-title">Internet Link</h3>
    <p>Connect enrolled devices to this bridge over the private TLS listener.</p>
    <div class="refresh-actions">
      <button type="button" :disabled="busy || refreshing" @click="refresh()">Refresh status</button>
      <label><input v-model="autoRefresh" type="checkbox"> Refresh every 5 seconds</label>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="status">
      <dl>
        <dt>Listener</dt><dd>{{ status.listening ? 'Listening' : status.running ? 'Not listening' : status.enabled ? 'Unavailable' : 'Disabled' }}<span v-if="status.listener_port"> on port {{ status.listener_port }}</span></dd>
        <dt>Host peer</dt><dd>{{ status.node_id || 'Not configured' }}</dd>
        <dt>Enrollment</dt><dd>{{ status.enrollment_available ? 'Available' : 'Unavailable' }}</dd>
        <dt>Packet expiry</dt><dd>{{ status.packet_ttl_ms / 1000 }} seconds</dd>
        <dt>Pending RF packets</dt><dd>{{ status.pending_rf }}</dd>
        <dt>Dropped tasks / transport failures</dt><dd>{{ status.dropped_tasks }} / {{ status.transport_failures }} since service start</dd>
      </dl>
      <h4>Approved peers</h4>
      <p v-if="!status.peers.length">No approved peers are configured.</p>
      <ul v-else><li v-for="peer in status.peers" :key="peer.id"><span class="peer-id">{{ peer.id }}</span>: {{ peer.connected ? 'Connected' : 'Disconnected' }}</li></ul>
      <p>A connected session confirms TLS authentication. It does not confirm RF delivery or a recipient acknowledgement.</p>
      <details><summary>Current routes</summary>
        <ul><li v-for="(route, index) in status.routes" :key="index">
          <template v-if="route.direction === 'inbound'">{{ route.peer }} / {{ route.radio }} to local radio {{ route.local_radio }}</template>
          <template v-else>Local radio {{ route.local_radio }} to {{ route.peer }}</template>
        </li></ul>
      </details>
      <h4>Traffic options</h4>
      <p>Saving applies these limits immediately and retains them after restart.</p>
      <form @submit.prevent="save" @input="editing = true">
        <fieldset :disabled="busy || !status.editable">
          <label>Send timeout, seconds
            <input v-model.number="options.send_timeout" data-testid="link-timeout" type="number" min="0.01" max="5" step="any" required>
            <small>Stop an Internet Link send after this time. Failed sends are not retried.</small>
          </label>
          <label>Packets in flight per peer
            <input v-model.number="options.max_inflight" data-testid="link-inflight" type="number" min="1" max="64" step="1" required>
            <small>Limit concurrent sends per peer and concurrent incoming packets.</small>
          </label>
          <label>Receive task limit
            <input v-model.number="options.max_rx_tasks" data-testid="link-tasks" type="number" min="1" max="64" step="1" required>
            <small>Limit pending RF ingress tasks and peer packets waiting for local routing.</small>
          </label>
          <div class="refresh-actions"><button type="submit" :disabled="!editing">Save Internet Link options</button><button type="button" :disabled="!editing || refreshing" @click="refresh(true)">Discard changes</button></div>
        </fieldset>
      </form>
      <p v-if="!status.editable">Traffic options are available when the listener is running.</p>
      <p>Endpoint, certificates, approved peers and enrollment permissions are managed by the host configuration.</p>
    </template>
    <p role="status" aria-live="polite">{{ message }}</p>
  </section>
</template>

<style scoped>
.internet-link { border-top: 1px solid #888; margin-top: 2rem; padding-top: 1rem; }
h3,h4 { font-weight: 600; margin: 1rem 0; }
p { margin: .75rem 0; }
dl { display: grid; grid-template-columns: minmax(8rem, 1fr) minmax(0, 2fr); gap: .5rem 1rem; }
dd,.peer-id { overflow-wrap: anywhere; }
label { display: block; margin: .65rem 0; }
input[type=number] { display: block; padding: .5rem; border: 1px solid #888; border-radius: .3rem; background: transparent; max-width: 100%; }
small { display: block; margin-top: .3rem; }
button { border: 1px solid #888; border-radius: .3rem; padding: .5rem .75rem; margin: .5rem 0; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
.refresh-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; }
li { margin: .4rem 0; overflow-wrap: anywhere; }
summary { cursor: pointer; }
</style>
