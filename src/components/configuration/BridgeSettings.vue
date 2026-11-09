<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ApiService from '@/utils/api';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';
import InternetLinkSettings from './InternetLinkSettings.vue';
import BridgeDiagnostics from './BridgeDiagnostics.vue';
import Spinner from '@/components/ui/Spinner.vue';
import type { BridgeConfiguration, BridgeMapping, BridgeDirection, BridgeRunningState, BridgeTrafficLimits } from '@/generated/openapi';
const { radioLabel } = useMultiRadioConfig();
const internetLink = ref<InstanceType<typeof InternetLinkSettings> | null>(null);
type Mapping = BridgeMapping;
type DirectRoute = BridgeDirection;
type Settings = Omit<BridgeConfiguration, 'enabled' | 'channels' | 'mappings' | 'traffic_limits'> & {
  enabled: boolean; channels: Record<string, string>; mappings: Mapping[]; direct_routes?: DirectRoute[];
  traffic_limits?: Required<BridgeTrafficLimits>;
};
type BridgeState = Omit<BridgeRunningState, 'settings' | 'radio_ids'> & { settings: Settings; radio_ids: string[] };
const state = ref<BridgeState | null>(null);
const statusError = ref('');
const refreshing = ref(false);
const pausing = ref(false);
let disposed = false;
let statusVersion = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const settings = ref<Settings>({ enabled: false, channels: {}, mappings: [] });
const radios = ref<string[]>([]);
const channels = ref<{name:string; key:string; saved:boolean; enabled:boolean}[]>([]);
const busy = ref(false);
const ready = ref(false);
const message = ref('');
const isEditing = ref(false);
function invalidateRunningState() {
  if (state.value) state.value = {...state.value, running: null, restart_required: null, controls_available: false, active_settings: null, crossing_route_id: null};
  statusError.value = 'Running state could not be refreshed. Displayed status may be out of date.';
}
async function load(): Promise<boolean> {
  const version = ++statusVersion;
  busy.value = true;
  try {
    const response = await ApiService.get<BridgeState>('/bridge_settings');
    if (!response.success || !response.data) throw new Error('load');
    if (disposed || version !== statusVersion) return false;
    state.value = response.data;
    statusError.value = '';
    settings.value = {...response.data.settings, peer_routing: response.data.settings.peer_routing ?? 'legacy', traffic_limits: {per_minute:response.data.settings.traffic_limits?.per_minute ?? 12, burst:response.data.settings.traffic_limits?.burst ?? 3, max_pending_per_direction:response.data.settings.traffic_limits?.max_pending_per_direction ?? 16}, disabled_channels: response.data.settings.disabled_channels || [], protocols: {discovery:false, repeater_admin:false, trace:false, ...response.data.settings.protocols}, channels: response.data.settings.channels || {}, mappings: response.data.settings.mappings || [], direct_routes: response.data.settings.direct_routes || []};
    radios.value = response.data.radio_ids;
    channels.value = Object.keys(settings.value.channels).map(name => ({name, key:'', saved:true, enabled: !settings.value.disabled_channels?.includes(name)}));
    ready.value = true;
    isEditing.value = false;
    return true;
  } catch {
    if (!disposed && version === statusVersion) { message.value = 'Bridge settings could not be loaded.'; invalidateRunningState(); }
    return false;
  }
  finally { busy.value = false; }
}
async function refreshStatus() {
  if (refreshing.value || busy.value || pausing.value) return;
  refreshing.value = true;
  const version = ++statusVersion;
  try {
    const response = await ApiService.get<BridgeState>('/bridge_settings');
    if (!response.success || !response.data) throw new Error('status');
    if (disposed || version !== statusVersion) return;
    state.value = response.data;
    settings.value.paused = response.data.settings.paused;
    statusError.value = '';
  } catch { if (!disposed && version === statusVersion) invalidateRunningState(); }
  finally { refreshing.value = false; }
}
function markPauseUnconfirmed() {
  message.value = 'Pause outcome is not confirmed and may still complete. Refresh running state; do not retry until status is known.';
  statusError.value = 'Running state must be refreshed before changing pause again.';
}
async function togglePause() {
  if (pausing.value || busy.value || !state.value?.controls_available || state.value.control_pending || statusError.value) return;
  pausing.value = true;
  message.value = '';
  try {
    const response = await ApiService.post('/update_bridge_controls', {paused: !state.value.paused});
    if (response.success) {
      message.value = 'Crossing pause saved and applied. Other unsaved changes are unchanged.';
    } else if (response.success === false && response.outcome !== 'unknown') {
      message.value = 'Pause change was not applied. No settings were changed by this request.';
    } else {
      markPauseUnconfirmed();
    }
  } catch { markPauseUnconfirmed(); }
  finally { pausing.value = false; }
  await refreshStatus();
}
function removeChannel(index: number) {
  channels.value.splice(index, 1);
  isEditing.value = true;
}
async function save() {
  if (busy.value || pausing.value) return;
  ++statusVersion;
  busy.value = true;
  message.value = '';
  try {
    if (settings.value.enabled && !radios.value.includes(settings.value.origin_home || '')) {
      message.value = 'Not saved. Select an origin home radio for messages sent by OpenHop.';
      return;
    }
    if (Object.values(settings.value.protocols || {}).some(Boolean) && settings.value.peer_routing !== 'distinct') {
      message.value = 'Not saved. Discovery, repeater administration and TRACE require distinct peer routing. Select that mode and plan to clear and relearn cross-network contact paths after restart.';
      return;
    }
    const routes = settings.value.direct_routes || [];
    if (routes.some(r => !radios.value.includes(r.source_radio) || !radios.value.includes(r.target_radio) || r.source_radio === r.target_radio)
      || new Set(routes.map(r => r.source_radio)).size !== routes.length) {
      message.value = 'Not saved. Each direct route needs two different configured radios and only one destination per source radio.';
      return;
    }
    const names = channels.value.map(c => c.name.trim());
    if (names.some(n => !n) || new Set(names).size !== names.length) throw new Error('names');
    const submitted = Object.fromEntries(channels.value.map((c,i) => [names[i], c.key || (c.saved ? '*** REDACTED ***' : '')]));
    const editableSettings = {...settings.value};
    delete editableSettings.reception_evidence; // Host-managed allowlist must not be round-tripped by a stale editor.
    const response = await ApiService.post('/update_bridge_settings', {...editableSettings, channels:submitted, disabled_channels: channels.value.flatMap((channel, index) => channel.enabled ? [] : [names[index]])});
    if (!response.success) {
      message.value = response.error === 'bridge_home_assignment_required'
        ? 'Not saved. Assign an origin home radio and a home radio for every companion. Edit companion homes on the Companions page.'
        : 'Not saved. Check channel keys, radio selections, mappings and queue limits.';
      return;
    }
    // The write is confirmed even if the following read fails. Keep retained-key
    // semantics for newly saved rows so a later edit never requires re-entering keys.
    channels.value.forEach((channel, index) => { channel.name = names[index]!; channel.saved = true; channel.key = ''; });
    isEditing.value = false;
    const refreshed = await load();
    message.value = !refreshed || state.value?.restart_required == null
      ? 'Saved. Running status could not be verified. Refresh running state before checking whether a restart is needed.'
      : state.value.restart_required === false
      ? 'Saved. These settings match the running bridge.'
      : 'Saved. Restart OpenHop to apply these settings. The running bridge is unchanged.';
  } catch { message.value = 'Not saved. Check channel keys, radio selections, mappings and queue limits.'; }
  finally { channels.value.forEach(c => { c.key = ''; }); busy.value = false; }
}
function addMapping() {
  settings.value.mappings.push({source_radio: radios.value[0] || '', target_radio: radios.value[1] || '', source_channel:'', target_channel:''});
  isEditing.value = true;
}
function addDirectRoute() {
  (settings.value.direct_routes ||= []).push({source_radio: '', target_radio: ''});
  isEditing.value = true;
}
function requestLeave(accept:()=>void, cancel?:()=>void) {
  const proceed = () => internetLink.value ? internetLink.value.requestLeave(accept, cancel) : accept();
  if (!isEditing.value || window.confirm('Discard unsaved bridge changes?')) proceed(); else cancel?.();
}
const anyEditing = computed(() => isEditing.value || !!internetLink.value?.isEditing);
defineExpose({isEditing: anyEditing, requestLeave});
onMounted(() => {
  void load();
  timer = setInterval(() => { if (!document.hidden) void refreshStatus(); }, 5000);
});
onUnmounted(() => { disposed = true; if (timer) clearInterval(timer); });
</script>

<template>
  <section class="bridge-settings">
    <h2>Bridge</h2>
    <p>Repeat locally and translate authenticated group chat between two radios. Group channel translation is independent of optional encrypted direct-message transit.</p>
    <p>Each mapping is one-way. Add a reverse mapping for replies. Saving requires a restart; it does not transmit or restart the service.</p>
    <section class="cfg-section" aria-labelledby="bridge-running-title">
      <h3 id="bridge-running-title">Running bridge</h3>
      <p v-if="statusError" role="alert" class="text-accent-red">{{ statusError }}</p>
      <p v-if="state?.control_pending" role="status">A pause change is still completing. Its final state is not yet confirmed.</p>
      <dl v-if="state" class="runtime-summary">
        <dt>Current state</dt><dd>{{ state.running == null ? 'Unknown' : !state.running ? 'Not running' : state.paused ? 'Crossings paused' : 'Running' }}</dd>
        <dt>Saved configuration</dt><dd>{{ state.restart_required == null ? 'Running comparison unavailable' : state.restart_required ? 'Restart required to apply saved changes' : 'Matches running bridge' }}</dd>
        <dt>Queued crossings</dt><dd>{{ state.pending_crossings ?? 'Unknown' }}</dd>
      </dl>
      <div class="actions">
        <button type="button" class="cfg-btn-secondary" :disabled="busy || refreshing || pausing" @click="refreshStatus">Refresh running state</button>
        <button type="button" class="cfg-btn-primary" data-testid="pause-bridge" :disabled="busy || refreshing || pausing || !state?.controls_available || state?.control_pending || !!statusError" @click="togglePause">{{ pausing ? 'Applying…' : state?.paused ? 'Resume crossings' : 'Pause crossings now' }}</button>
      </div>
      <p>Pause applies immediately and survives restart. It stops new and queued crossings, including protocol transit. A transmission already in progress may finish. Local group-message repeating continues.</p>
      <details v-if="state?.active_settings"><summary>Running routes and options</summary>
        <p data-testid="running-peer-routing">Peer routing: {{ state.active_settings.peer_routing === 'distinct' ? 'Distinct local and crossing routes' : 'Legacy shared route' }}</p>
        <p v-if="state.running && state.active_settings.peer_routing === 'distinct' && state.crossing_route_id" data-testid="crossing-route-id" class="route-id">Public crossing route identifier: {{ state.crossing_route_id }}<br>This unsigned routing marker is not a credential or a signed endpoint identity.</p>
        <p>Origin home: {{ radioLabel(state.active_settings.origin_home || '') || 'Not set' }}</p>
        <p>Disabled channels: {{ state.active_settings.disabled_channels?.join(', ') || 'None' }}</p>
        <ul><li v-for="(route, index) in state.active_settings.mappings" :key="`active-mapping-${index}`">{{ radioLabel(route.source_radio) }} / {{ route.source_channel }} → {{ radioLabel(route.target_radio) }} / {{ route.target_channel }}: {{ route.enabled === false || state.active_settings.disabled_channels?.includes(route.source_channel) || state.active_settings.disabled_channels?.includes(route.target_channel) ? 'Disabled' : 'Enabled' }}</li></ul>
        <ul><li v-for="(route, index) in state.active_settings.direct_routes" :key="`active-direct-${index}`">{{ radioLabel(route.source_radio) }} → {{ radioLabel(route.target_radio) }} transit: {{ route.enabled === false ? 'Disabled' : 'Enabled' }}</li></ul>
        <p>Discovery: {{ state.active_settings.protocols?.discovery ? 'Enabled' : 'Disabled' }} · Repeater administration: {{ state.active_settings.protocols?.repeater_admin ? 'Enabled' : 'Disabled' }} · TRACE: {{ state.active_settings.protocols?.trace ? 'Enabled' : 'Disabled' }}</p>
      </details>
    </section>
    <p role="status" aria-live="polite">{{ message }}</p>
    <Spinner v-if="busy && !ready" />
    <form v-if="ready" @submit.prevent="save" @input="isEditing = true" @change="isEditing = true">
      <fieldset :disabled="busy || pausing">
        <h3>Saved settings</h3>
        <p v-if="isEditing" class="text-accent-amber">Unsaved changes. Status refresh will not replace your edits.</p>
        <label><input v-model="settings.enabled" type="checkbox"> Enable bridge after restart</label>
        <label>Origin home radio
          <select v-model="settings.origin_home" data-testid="origin-home" :required="settings.enabled">
            <option value="">Select a radio</option>
            <option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option>
          </select>
        </label>
        <p>Choose where messages sent by OpenHop originate. Each companion also needs its own home radio on the Companions page. A channel mapping may then forward the message to the other side.</p>
        <label>Echo database path <input v-model="settings.echo_database" readonly required></label>
        <label>Pending crossing limit <input v-model.number="settings.max_pending_crossings" type="number" min="1" max="1000" placeholder="64"></label>
        <label>Queue expiry, seconds <input v-model.number="settings.queue_ttl_seconds" type="number" min="1" max="120" placeholder="30"></label>
        <h3>Channels</h3>
        <p>Stored keys are never returned. Leave a saved channel's key blank to retain it. Enter a 32- or 64-character hexadecimal key to replace it. Removing a row removes that channel on save.</p>
        <div v-for="(channel,index) in channels" :key="index" class="channel-row">
          <label><input type="checkbox" v-model="channel.enabled"> Allow channel crossings</label>
          <label>Channel name <input v-model="channel.name" :readonly="channel.saved" maxlength="64" required></label>
          <label>{{ channel.saved ? 'Replacement key' : 'New key' }} <input v-model="channel.key" type="password" autocomplete="new-password" spellcheck="false" :required="!channel.saved" pattern="([a-fA-F0-9]{32}|[a-fA-F0-9]{64})"></label>
          <button type="button" @click="removeChannel(index)">Remove channel</button>
        </div>
        <button type="button" @click="channels.push({name:'',key:'',saved:false,enabled:true}); isEditing = true">Add channel</button>
        <h3>Mappings</h3>
        <p>Disable a direction without deleting its radio or channel selection. Channel switches apply to both the source and destination of a mapping. Local group-message repeating is unaffected.</p>
        <div v-for="(mapping,index) in settings.mappings" :key="index" class="mapping-row">
          <label><input type="checkbox" :checked="mapping.enabled !== false" @change="mapping.enabled = ($event.target as HTMLInputElement).checked"> Enable direction</label>
          <label>Source radio <select v-model="mapping.source_radio" required><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
          <label>Source channel <select v-model="mapping.source_channel" required><option v-for="c in channels" :key="c.name">{{ c.name }}</option></select></label>
          <label>Destination radio <select v-model="mapping.target_radio" required><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
          <label>Destination channel <select v-model="mapping.target_channel" required><option v-for="c in channels" :key="c.name">{{ c.name }}</option></select></label>
          <button type="button" @click="settings.mappings.splice(index,1); isEditing = true">Remove mapping</button>
        </div>
        <button type="button" @click="addMapping">Add mapping</button>
        <h3>Protocol transit directions</h3>
        <label>Peer routing mode
          <select v-model="settings.peer_routing" data-testid="peer-routing">
            <option value="legacy">Legacy shared route</option>
            <option value="distinct">Distinct local and crossing routes</option>
          </select>
        </label>
        <p>Existing configurations use legacy mode. On a configured ingress, a native bridge next hop crosses to the paired radio in legacy mode, including paths that would otherwise repeat on the same radio. Distinct mode uses the native bridge next hop for local routing and a separate public route identifier for crossings.</p>
        <p class="text-accent-amber" data-testid="peer-routing-migration">Changing peer routing mode requires a restart. Clear and relearn cross-network contact paths after changing mode. Previously learned paths will not retain their crossing meaning. Channel mappings and route selections are preserved.</p>
        <p>Transit is disabled unless a route is added. The bridge forwards eligible encrypted packets without decrypting them. Both endpoints need known contact paths for the forward and reverse directions. Add a reverse route for replies and acknowledgements.</p>
        <p>Flood discovery, repeater administration and TRACE are separately opt-in below. The encrypted TXT_MSG subtype is opaque to the bridge; this is not content filtering or individual sender authentication. Local-only discovery CONTROL packets and adverts stay on their local radio.</p>
        <div v-for="(route,index) in settings.direct_routes" :key="index" class="direct-route-row">
          <label><input type="checkbox" :checked="route.enabled !== false" @change="route.enabled = ($event.target as HTMLInputElement).checked"> Enable transit direction</label>
          <label>Ingress radio <select v-model="route.source_radio" required><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
          <label>Outgoing radio <select v-model="route.target_radio" required><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
          <button type="button" @click="settings.direct_routes?.splice(index,1); isEditing = true">Remove direct route</button>
        </div>
        <button type="button" @click="addDirectRoute">Add direct route</button>
        <h3>Cross-frequency protocols</h3>
        <p>These options require distinct peer routing and use the enabled transit directions above. Enable both directions for responses. Existing route and channel selections are preserved; saving does not send a probe.</p>
        <template v-if="settings.protocols">
          <label><input v-model="settings.protocols.discovery" type="checkbox"> Discovery and contact path learning (TXT / PATH / ACK)</label>
          <label><input v-model="settings.protocols.repeater_admin" type="checkbox"> Repeater administration and opaque encrypted message transit</label>
          <p>Enabling repeater administration also allows ordinary flood direct messages (TXT_MSG) and acknowledgments to cross enabled transit directions. The bridge cannot distinguish encrypted CLI traffic from ordinary encrypted direct messages.</p>
          <label><input v-model="settings.protocols.trace" type="checkbox"> TRACE across enabled transit directions</label>
        </template>
        <h3>Directional traffic safeguards</h3>
        <p>Each direction has its own flood crossing budget. Direct and TRACE traffic bypass rate and burst limits; pending limits still apply. Local repeats do not consume the crossing budget. Limits apply after restart. Defaults are enforced even when the host configuration has no traffic_limits section: 12 flood crossings per minute, a burst of 3, and 16 pending crossings per direction. Upgrading activates these defaults without a separate configuration step. Use the running diagnostics below to verify active limits.</p>
        <template v-if="settings.traffic_limits">
          <label>Flood crossings per minute <input v-model.number="settings.traffic_limits.per_minute" type="number" min="1" max="600" required></label>
          <label>Allowed burst <input v-model.number="settings.traffic_limits.burst" type="number" min="1" max="100" required></label>
          <label>Pending per direction <input v-model.number="settings.traffic_limits.max_pending_per_direction" type="number" min="1" max="1000" required></label>
        </template>
        <div class="actions"><button type="submit">Save bridge settings</button><button type="button" @click="load">Discard changes</button></div>
      </fieldset>
    </form>
    <BridgeDiagnostics :running="state?.running" />
    <InternetLinkSettings ref="internetLink" />
  </section>
</template>

<style scoped>
.bridge-settings { max-width: 64rem; padding: 1rem; }
h2,h3 { font-weight: 600; margin: 1rem 0; }
p { margin: .75rem 0; }
label { display: block; margin: .65rem 0; }
input:not([type=checkbox]),select { display: block; padding: .5rem; border: 1px solid var(--color-stroke-subtle); border-radius: .3rem; background: transparent; max-width: 100%; }
.channel-row,.mapping-row,.direct-route-row { display: flex; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid var(--color-stroke-subtle); padding: .75rem 0; align-items: end; }
button { border: 1px solid var(--color-stroke-subtle); border-radius: .3rem; padding: .5rem .75rem; margin: .5rem 0; cursor: pointer; }
.route-id { overflow-wrap: anywhere; }
.runtime-summary { display: grid; grid-template-columns: minmax(8rem, 1fr) minmax(0, 2fr); gap: .5rem 1rem; }
button:disabled { opacity: .5; cursor: default; }
.actions { flex-wrap: wrap; display: flex; gap: 1rem; margin-top: 1rem; }
</style>
