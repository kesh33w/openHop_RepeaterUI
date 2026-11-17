<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import ApiService from '@/utils/api';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';
import InternetLinkSettings from './InternetLinkSettings.vue';
import BridgeDiagnostics from './BridgeDiagnostics.vue';
import TxGroupSettings from './TxGroupSettings.vue';
import Spinner from '@/components/ui/Spinner.vue';
import { groupConnections, serializeConnections, setConnectionDirection, connectionKind, type ChannelConnection } from '@/utils/channelConnections';
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
const connections = ref<ChannelConnection[]>([]);
type NewEndpoint = {radio:string; channel:string; name:string; key:string};
const newConnection = ref<{a:NewEndpoint; b:NewEndpoint; reuseA:boolean} | null>(null);
const newConnectionError = ref('');
const channelKeys = ref<HTMLDetailsElement | null>(null);
const draftMappings = computed(() => serializeConnections(connections.value));
const runningConnections = computed(() => groupConnections(state.value?.active_settings?.mappings || []));
const newChannelName = (endpoint:NewEndpoint) => endpoint.channel || endpoint.name.trim();
const newConnectionKind = computed(() => {
  const draft = newConnection.value;
  if (!draft) return '';
  const a = newChannelName(draft.a);
  const b = !draft.a.channel && draft.reuseA ? a : newChannelName(draft.b);
  return !a || !b ? 'Choose channels on both sides' : a === b ? 'Same channel' : 'Cross-channel';
});
function markEditing(event:Event) {
  if (!(event.target as HTMLElement).closest('[data-new-connection]')) isEditing.value = true;
}
function directionEnabled(connection:ChannelConnection, direction:'forward'|'reverse') {
  const entry = connection[direction];
  return !!entry && entry.mapping.enabled !== false;
}
function connectionStatus(connection:ChannelConnection) {
  if ([connection.a.channel, connection.b.channel].some(name => !channels.value.some(channel => channel.name === name && channel.enabled))) return 'Blocked by channel switch';
  const forward = directionEnabled(connection, 'forward');
  const reverse = directionEnabled(connection, 'reverse');
  return forward && reverse ? 'Two-way' : forward ? 'A → B only' : reverse ? 'B → A only' : 'Disabled';
}
function nextMappingOrder() {
  return Math.max(-1, ...connections.value.flatMap(connection => [connection.forward?.order ?? -1, connection.reverse?.order ?? -1])) + 1;
}
function changeDirection(connection:ChannelConnection, direction:'forward'|'reverse', event:Event) {
  setConnectionDirection(connection, direction, (event.target as HTMLInputElement).checked, nextMappingOrder());
  isEditing.value = true;
}
function channelInUse(name:string) {
  return connections.value.some(connection => connection.a.channel === name || connection.b.channel === name);
}
function startConnection() {
  if (newConnection.value) return;
  const endpoint = (radio:string) => ({radio, channel:channels.value[0]?.name || '', name:'', key:''});
  newConnection.value = {a:endpoint(radios.value[0] || ''), b:endpoint(radios.value[1] || ''), reuseA:true};
  newConnectionError.value = '';
}
function cancelConnection() { newConnection.value = null; newConnectionError.value = ''; }
function duplicateKnownKeys(entries:{name:string; key:string}[]) {
  const identities = new Map<string,string>();
  for (const entry of entries) {
    if (!/^([a-fA-F0-9]{32}|[a-fA-F0-9]{64})$/.test(entry.key)) continue;
    // The bridge pads 16-byte secrets with zero bytes. Saved, redacted keys
    // cannot be compared here and must never be inferred from their marker.
    const key = entry.key.toLowerCase().padEnd(64, '0');
    const name = identities.get(key);
    if (name !== undefined && name !== entry.name) return true;
    identities.set(key, entry.name);
  }
  return false;
}
function addConnection() {
  const draft = newConnection.value;
  if (!draft) return;
  const a = {...draft.a, name:draft.a.name.trim()};
  const b = !a.channel && draft.reuseA ? {...a, radio:draft.b.radio} : {...draft.b, name:draft.b.name.trim()};
  const fail = (reason:string) => { newConnectionError.value = reason; };
  if (!radios.value.includes(a.radio) || !radios.value.includes(b.radio) || a.radio === b.radio) return fail('Choose two different configured radios.');
  for (const endpoint of [a,b]) {
    if (endpoint.channel) {
      if (!channels.value.some(channel => channel.name === endpoint.channel)) return fail('Choose a stored channel or create a new one.');
    } else {
      if (!endpoint.name || endpoint.name.length > 64) return fail('Give each new channel a name of 1–64 characters.');
      if (channels.value.some(channel => channel.name === endpoint.name)) return fail('That channel is already stored. Select it from the channel list to keep its key.');
      if (!/^([a-fA-F0-9]{32}|[a-fA-F0-9]{64})$/.test(endpoint.key)) return fail('Each new channel needs a 32- or 64-character hexadecimal key.');
    }
  }
  if (!a.channel && !b.channel && a.name === b.name && a.key.toLowerCase() !== b.key.toLowerCase()) return fail('The same channel must use the same key on both sides.');
  if (duplicateKnownKeys([...channels.value, ...[a,b].filter(endpoint => !endpoint.channel)])) return fail('Different channel names must use different keys. To bridge the same channel, select it on both sides.');
  const connection:ChannelConnection = {id:Math.max(-1,...connections.value.map(item => item.id))+1,a:{radio:a.radio,channel:newChannelName(a)},b:{radio:b.radio,channel:newChannelName(b)}};
  let order = nextMappingOrder();
  setConnectionDirection(connection, 'forward', true, order++);
  setConnectionDirection(connection, 'reverse', true, order);
  const proposed = serializeConnections([...connections.value, connection]);
  if (new Set(proposed.map(mapping => JSON.stringify([mapping.source_radio,mapping.source_channel,mapping.target_radio]))).size !== proposed.length) return fail('A channel link already uses that source channel and radio pair. Edit the existing link instead.');
  for (const endpoint of [a,b]) if (!endpoint.channel && !channels.value.some(channel => channel.name === endpoint.name)) channels.value.push({name:endpoint.name,key:endpoint.key,saved:false,enabled:true});
  connections.value.push(connection);
  isEditing.value = true;
  cancelConnection();
}

const busy = ref(false);
const ready = ref(false);
const message = ref('');
const isEditing = ref(false);
const writeUnconfirmed = ref(false);
const validating = ref(false);
const form = ref<HTMLFormElement | null>(null);
const activePanel = ref('overview');
const panels = [
  { id: 'overview', title: 'Overview', detail: 'Status & setup' },
  { id: 'transmitters', title: 'Transmitters', detail: 'Sequential TX order' },
  { id: 'channels', title: 'Channels', detail: 'Links & keys' },
  { id: 'transit', title: 'Protocol transit', detail: 'Routes & protocols' },
  { id: 'safeguards', title: 'Safeguards', detail: 'Queues & limits' },
  { id: 'activity', title: 'Live activity', detail: 'Crossing evidence' },
  { id: 'link', title: 'Internet Link', detail: 'Peers & transport' },
];
const editingPanel = computed(() => !['activity', 'link', 'transmitters'].includes(activePanel.value));
const runningLabel = computed(() => state.value?.running == null ? 'Unknown' : !state.value.running ? 'Not running' : state.value.paused ? 'Crossings paused' : 'Running');
const configuredDirections = computed(() => draftMappings.value.filter(mapping => mapping.enabled !== false && channels.value.some(channel => channel.name === mapping.source_channel && channel.enabled) && channels.value.some(channel => channel.name === mapping.target_channel && channel.enabled)).length);
async function revealInvalid() {
  const invalid = form.value?.querySelector<HTMLInputElement | HTMLSelectElement>('input:invalid, select:invalid');
  if (!invalid) return false;
  if (invalid.closest('[data-channel-keys]') && channelKeys.value) channelKeys.value.open = true;
  activePanel.value = invalid.closest<HTMLElement>('[data-panel]')?.dataset.panel ?? 'overview';
  message.value = 'Not saved. Check the highlighted field before saving.';
  await nextTick();
  invalid.focus();
  invalid.reportValidity();
  return true;
}
async function discard() {
  if (busy.value || pausing.value) return;
  if ((isEditing.value || writeUnconfirmed.value || newConnection.value) && !window.confirm(writeUnconfirmed.value
    ? 'Reload saved settings to reconcile the unconfirmed write? Unsaved changes will be discarded. Verify the saved result before making another change.'
    : 'Discard unsaved bridge changes?')) return;
  if (await load()) { writeUnconfirmed.value = false; message.value = 'Saved settings reloaded. Review them before making further changes.'; }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!anyEditing.value) return;
  event.preventDefault();
  event.returnValue = '';
}
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
    settings.value = {...response.data.settings, peer_routing: response.data.settings.peer_routing ?? 'legacy', traffic_limits: {per_minute:response.data.settings.traffic_limits?.per_minute ?? 12, burst:response.data.settings.traffic_limits?.burst ?? 3, max_pending_per_direction:response.data.settings.traffic_limits?.max_pending_per_direction ?? 16}, disabled_channels: response.data.settings.disabled_channels || [], protocols: {discovery:false, repeater_admin:false, trace:false, ...response.data.settings.protocols}, channels: response.data.settings.channels || {}, mappings: (response.data.settings.mappings || []).map(mapping => ({...mapping})), direct_routes: (response.data.settings.direct_routes || []).map(route => ({...route}))};
    radios.value = response.data.radio_ids;
    channels.value = Object.keys(settings.value.channels).map(name => ({name, key:'', saved:true, enabled: !settings.value.disabled_channels?.includes(name)}));
    connections.value = groupConnections(settings.value.mappings);
    cancelConnection();
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
  if (refreshing.value || busy.value || pausing.value || validating.value) return;
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
  if (channelInUse(channels.value[index]?.name || '')) return;
  channels.value.splice(index, 1);
  isEditing.value = true;
}
async function save() {
  if (busy.value || pausing.value || writeUnconfirmed.value || validating.value) return;
  ++statusVersion;
  validating.value = true;
  let posted = false;
  message.value = '';
  try {
    if (newConnection.value) { activePanel.value = 'channels'; message.value = 'Finish adding the channel link or cancel it before saving.'; return; }
    if (settings.value.enabled && !radios.value.includes(settings.value.origin_home || '')) {
      activePanel.value = 'overview';
      message.value = 'Not saved. Select an origin home radio for messages sent by OpenHop.';
      return;
    }
    if (Object.values(settings.value.protocols || {}).some(Boolean) && settings.value.peer_routing !== 'distinct') {
      activePanel.value = 'transit';
      message.value = 'Not saved. Discovery, repeater administration and TRACE require distinct peer routing. Select that mode and plan to clear and relearn cross-network contact paths after restart.';
      return;
    }
    const routes = settings.value.direct_routes || [];
    if (routes.some(r => !radios.value.includes(r.source_radio) || !radios.value.includes(r.target_radio) || r.source_radio === r.target_radio)
      || new Set(routes.map(r => r.source_radio)).size !== routes.length) {
      activePanel.value = 'transit';
      message.value = 'Not saved. Each direct route needs two different configured radios and only one destination per source radio.';
      return;
    }
    const names = channels.value.map(c => c.name.trim());
    if (names.some(n => !n) || new Set(names).size !== names.length) {
      activePanel.value = 'channels';
      message.value = 'Not saved. Every channel needs a unique, nonempty name.';
      await revealInvalid();
      return;
    }
    const mappings = draftMappings.value;
    if (mappings.some(mapping => !radios.value.includes(mapping.source_radio) || !radios.value.includes(mapping.target_radio) || mapping.source_radio === mapping.target_radio || !names.includes(mapping.source_channel) || !names.includes(mapping.target_channel))
      || new Set(mappings.map(mapping => JSON.stringify([mapping.source_radio,mapping.source_channel,mapping.target_radio]))).size !== mappings.length) {
      activePanel.value = 'channels';
      message.value = 'Not saved. Each channel link needs two different configured radios and stored channels. A source channel can have only one destination channel per radio pair.';
      return;
    }
    if (duplicateKnownKeys(channels.value)) {
      activePanel.value = 'channels';
      if (channelKeys.value) channelKeys.value.open = true;
      message.value = 'Not saved. Different channel names must use different keys. To bridge the same channel, select it on both sides.';
      return;
    }
    if (await revealInvalid()) return;
    const submitted = Object.fromEntries(channels.value.map((c,i) => [names[i], c.key || (c.saved ? '*** REDACTED ***' : '')]));
    const editableSettings = {...settings.value};
    delete editableSettings.paused; // Pause is an independent live control.
    delete editableSettings.reception_evidence; // Host-managed allowlist must not be round-tripped by a stale editor.
    busy.value = true;
    posted = true;
    const response = await ApiService.post('/update_bridge_settings', {...editableSettings, mappings, channels:submitted, disabled_channels: channels.value.flatMap((channel, index) => channel.enabled ? [] : [names[index]])});
    if (!response.success) {
      if (response.outcome === 'unknown' || response.success !== false) {
        writeUnconfirmed.value = true;
        message.value = 'The save is not confirmed and may have completed. Reload saved settings to review the result before saving again.';
        return;
      }
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
  } catch {
    writeUnconfirmed.value = true;
    message.value = 'The save is not confirmed and may have completed. Reload saved settings to review the result before saving again.';
  }
  finally { if (posted) channels.value.forEach(c => { c.key = ''; }); busy.value = false; validating.value = false; }
}
function addDirectRoute() {
  (settings.value.direct_routes ||= []).push({source_radio: '', target_radio: ''});
  isEditing.value = true;
}
function requestLeave(accept:()=>void, cancel?:()=>void) {
  if (busy.value || pausing.value) { cancel?.(); return; }
  const proceed = () => internetLink.value ? internetLink.value.requestLeave(accept, cancel) : accept();
  if (!(isEditing.value || writeUnconfirmed.value || newConnection.value) || window.confirm('Discard unsaved bridge changes?')) proceed(); else cancel?.();
}
const anyEditing = computed(() => isEditing.value || !!newConnection.value || busy.value || pausing.value || writeUnconfirmed.value || !!internetLink.value?.isEditing);
defineExpose({isEditing: anyEditing, requestLeave});
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload);
  void load();
  timer = setInterval(() => { if (!document.hidden) void refreshStatus(); }, 5000);
});
onUnmounted(() => { window.removeEventListener('beforeunload', beforeUnload); disposed = true; if (timer) clearInterval(timer); });
</script>

<template>
  <section class="bridge-settings">
    <header class="bridge-header">
      <div><p class="eyebrow">Radio bridge</p><h2>Bridge control center</h2><p class="muted">Manage crossing routes, protect airtime, and follow traffic between your networks.</p></div>
      <span class="header-tag">Configuration</span>
    </header>
    <section class="runtime-bar" aria-labelledby="bridge-running-title">
      <div class="runtime-primary"><span class="status-dot" :class="{live: state?.running && !state?.paused && !statusError, paused: state?.paused}" aria-hidden="true"></span><div><h3 id="bridge-running-title">Running bridge</h3><strong>{{ runningLabel }}</strong></div></div>
      <div class="runtime-metric"><span>Saved configuration</span><strong :class="{'warning-text': state?.restart_required}">{{ state?.restart_required == null ? 'Running comparison unavailable' : state.restart_required ? 'Restart required' : 'Matches running bridge' }}</strong></div>
      <div class="runtime-metric"><span>Queued crossings</span><strong>{{ state?.pending_crossings ?? 'Unknown' }}</strong></div>
      <div class="runtime-actions"><button type="button" :disabled="busy || refreshing || pausing" @click="refreshStatus">Refresh running state</button><button type="button" class="pause-button" data-testid="pause-bridge" :disabled="busy || refreshing || pausing || !state?.controls_available || state?.control_pending || !!statusError" @click="togglePause">{{ pausing ? 'Applying…' : state?.paused ? 'Resume crossings' : 'Pause crossings now' }}</button></div>
    </section>
    <p v-if="statusError" role="alert" class="notice error-notice">{{ statusError }}</p>
    <p v-if="state?.control_pending" role="status" class="notice">A pause change is still completing. Its final state is not yet confirmed.</p>
    <p v-if="state?.restart_required" class="notice restart-notice">Saved changes are waiting for a restart. The running bridge is unchanged.</p>
    <nav class="bridge-navigation" aria-label="Bridge sections">
      <button v-for="panel in panels" :key="panel.id" type="button" :data-testid="`bridge-nav-${panel.id}`" :aria-current="activePanel === panel.id ? 'page' : undefined" :aria-controls="`bridge-panel-${panel.id}`" @click="activePanel = panel.id"><span>{{ panel.title }}</span><small>{{ panel.detail }}</small></button>
    </nav>
    <div v-if="message" role="status" aria-live="polite" class="notice result-message">{{ message }}</div>
    <div v-if="writeUnconfirmed" class="notice error-notice"><strong>Check the last save before continuing.</strong><p>A response was lost. A status refresh alone cannot confirm which changes were saved.</p><button type="button" :disabled="busy || pausing" @click="discard">Reload saved settings</button></div>
    <Spinner v-if="busy && !ready" />
    <div v-if="!busy && !ready" class="empty"><p>Bridge settings are unavailable.</p><button type="button" @click="load">Try loading again</button></div>
    <form v-if="ready" ref="form" class="bridge-editor" novalidate @submit.prevent="save" @input="markEditing" @change="markEditing">
      <fieldset :disabled="busy || pausing || writeUnconfirmed">
        <section v-show="activePanel === 'overview'" id="bridge-panel-overview" data-panel="overview" class="editor-panel">
          <div class="section-heading"><div><p class="eyebrow">Saved configuration</p><h3>Bridge setup</h3></div><span class="badge">Apply after restart</span></div>
          <div class="overview-grid">
            <div class="setup-fields">
              <label class="switch-row"><input v-model="settings.enabled" type="checkbox"><span>Enable bridge after restart<small>Translate authenticated group chat between radios.</small></span></label>
              <label>Origin home radio<select v-model="settings.origin_home" data-testid="origin-home" :required="settings.enabled"><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
              <p class="muted">Choose where messages sent by OpenHop originate. Each companion also needs its own home radio on the Companions page. A channel mapping may then forward the message to the other side.</p>
            </div>
            <aside class="setup-summary"><h4>Your configuration draft</h4><dl><div><dt>Stored channel keys</dt><dd>{{ channels.length }}</dd></div><div><dt>Channel links</dt><dd>{{ connections.length }}</dd></div><div><dt>Enabled channel directions</dt><dd>{{ configuredDirections }}</dd></div><div><dt>Protocol transit directions</dt><dd>{{ settings.direct_routes?.filter(route => route.enabled !== false).length ?? 0 }}</dd></div><div><dt>Peer routing</dt><dd>{{ settings.peer_routing === 'distinct' ? 'Distinct' : 'Legacy' }}</dd></div></dl><p class="muted">Group channel translation is independent of optional encrypted direct-message transit.</p></aside>
          </div>
          <details class="help-details"><summary>Saving, pausing & restarting</summary><p>Saving requires a restart; it does not transmit or restart the service.</p><p>Pause applies immediately and survives restart. It stops new and queued crossings, including protocol transit. A transmission already in progress may finish. Local group-message repeating continues.</p></details>
      <details v-if="state?.active_settings" class="help-details running-details"><summary>Running routes and options</summary>
        <p data-testid="running-peer-routing">Peer routing: {{ state.active_settings.peer_routing === 'distinct' ? 'Distinct local and crossing routes' : 'Legacy shared route' }}</p>
        <p v-if="state.running && state.active_settings.peer_routing === 'distinct' && state.crossing_route_id" data-testid="crossing-route-id" class="route-id">Public crossing route identifier: {{ state.crossing_route_id }}<br>This unsigned routing marker is not a credential or a signed endpoint identity.</p>
        <p>Origin home: {{ radioLabel(state.active_settings.origin_home || '') || 'Not set' }}</p>
        <p>Disabled channels: {{ state.active_settings.disabled_channels?.join(', ') || 'None' }}</p>
        <ul><li v-for="connection in runningConnections" :key="connection.id">{{ radioLabel(connection.a.radio) }} / {{ connection.a.channel }} {{ directionEnabled(connection, 'forward') && directionEnabled(connection, 'reverse') ? '↔' : directionEnabled(connection, 'forward') ? '→' : directionEnabled(connection, 'reverse') ? '←' : '—' }} {{ radioLabel(connection.b.radio) }} / {{ connection.b.channel }} · {{ connectionKind(connection) }}{{ state.active_settings.disabled_channels?.includes(connection.a.channel) || state.active_settings.disabled_channels?.includes(connection.b.channel) ? ' · Blocked by channel switch' : !directionEnabled(connection, 'forward') && !directionEnabled(connection, 'reverse') ? ' · Disabled' : '' }}</li></ul>
        <ul><li v-for="(route, index) in state.active_settings.direct_routes" :key="`active-direct-${index}`">{{ radioLabel(route.source_radio) }} → {{ radioLabel(route.target_radio) }} transit: {{ route.enabled === false ? 'Disabled' : 'Enabled' }}</li></ul>
        <p>Discovery: {{ state.active_settings.protocols?.discovery ? 'Enabled' : 'Disabled' }} · Repeater administration: {{ state.active_settings.protocols?.repeater_admin ? 'Enabled' : 'Disabled' }} · TRACE: {{ state.active_settings.protocols?.trace ? 'Enabled' : 'Disabled' }}</p>
      </details>

        </section>
        <section v-show="activePanel === 'channels'" id="bridge-panel-channels" data-panel="channels" class="editor-panel">
        <div class="section-heading"><div><p class="eyebrow">Group chat</p><h3>Channel links</h3></div><button type="button" data-testid="add-connection" :disabled="!!newConnection" @click="startConnection">Add channel link</button></div>
        <p>Connect a channel on each radio. Matching channels are bridged as the same channel; different channels form a cross-channel link. Replies use the same link.</p>
        <p class="muted">Stored keys alone do not create a bridge. Only the links below cross between radios. These are saved settings; changes apply after restart.</p>
        <div v-if="newConnection" class="connection-builder" data-new-connection>
          <div class="route-card-header"><h4>Add channel link</h4><span class="badge">{{ newConnectionKind }}</span></div>
          <div class="connection-endpoints">
            <div class="endpoint"><h4>Side A</h4>
              <label>Radio A<select v-model="newConnection.a.radio" data-testid="new-radio-a"><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
              <label>Channel A<select v-model="newConnection.a.channel" data-testid="new-channel-a"><option v-for="channel in channels" :key="channel.name" :value="channel.name">{{ channel.name }}</option><option value="">New channel…</option></select></label>
              <template v-if="!newConnection.a.channel"><label>New channel name<input v-model="newConnection.a.name" data-testid="new-name-a" maxlength="64"></label><label>New channel key<input v-model="newConnection.a.key" data-testid="new-key-a" type="password" autocomplete="new-password" spellcheck="false"></label><label><input v-model="newConnection.reuseA" type="checkbox"> Use this new channel on both sides</label></template>
            </div>
            <div class="connection-arrow" aria-hidden="true">↔</div>
            <div class="endpoint"><h4>Side B</h4>
              <label>Radio B<select v-model="newConnection.b.radio" data-testid="new-radio-b"><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
              <p v-if="!newConnection.a.channel && newConnection.reuseA" class="shared-channel">{{ newConnection.a.name.trim() || 'New channel from side A' }}<small>Uses the same channel and key as side A.</small></p>
              <template v-else><label>Channel B<select v-model="newConnection.b.channel" data-testid="new-channel-b"><option v-for="channel in channels" :key="channel.name" :value="channel.name">{{ channel.name }}</option><option value="">New channel…</option></select></label><template v-if="!newConnection.b.channel"><label>New channel name<input v-model="newConnection.b.name" data-testid="new-name-b" maxlength="64"></label><label>New channel key<input v-model="newConnection.b.key" data-testid="new-key-b" type="password" autocomplete="new-password" spellcheck="false"></label></template></template>
            </div>
          </div>
          <p><strong>Two-way channel link.</strong> Messages and replies cross in both directions automatically.</p>
          <p class="muted">New keys must be 32 or 64 hexadecimal characters. Stored keys are retained. Adding here updates your draft, not the running bridge.</p>
          <p v-if="newConnectionError" role="alert" class="error-notice notice">{{ newConnectionError }}</p>
          <div class="save-actions"><button type="button" @click="cancelConnection">Cancel</button><button type="button" class="save-button" data-testid="confirm-add-connection" @click="addConnection">Add to draft</button></div>
        </div>
        <div v-for="connection in connections" :key="connection.id" class="mapping-row connection-card">
          <div class="route-card-header"><div><strong>{{ connection.a.channel }} {{ directionEnabled(connection, 'forward') && directionEnabled(connection, 'reverse') ? '↔' : directionEnabled(connection, 'forward') ? '→' : directionEnabled(connection, 'reverse') ? '←' : '—' }} {{ connection.b.channel }}</strong><p class="connection-radios">{{ radioLabel(connection.a.radio) }} · {{ radioLabel(connection.b.radio) }}</p></div><div class="connection-badges"><span class="badge" :class="{translation:connectionKind(connection) === 'Cross-channel'}">{{ connectionKind(connection) }}</span><span class="badge">{{ connectionStatus(connection) }}</span></div></div>
          <label>Radio A<select v-model="connection.a.radio" required><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
          <label>Channel A<select v-model="connection.a.channel" required><option v-for="channel in channels" :key="channel.name" :value="channel.name">{{ channel.name }}</option></select></label>
          <label>Radio B<select v-model="connection.b.radio" required><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
          <label>Channel B<select v-model="connection.b.channel" required><option v-for="channel in channels" :key="channel.name" :value="channel.name">{{ channel.name }}</option></select></label>
          <div class="connection-directions"><label><input type="checkbox" :checked="directionEnabled(connection, 'forward')" @change="changeDirection(connection, 'forward', $event)"> A → B</label><label><input type="checkbox" :checked="directionEnabled(connection, 'reverse')" @change="changeDirection(connection, 'reverse', $event)"> B → A</label><small>Turn either direction off without removing the link.</small></div>
          <button type="button" class="remove-button" @click="connections = connections.filter(item => item.id !== connection.id); isEditing = true">Remove link</button>
        </div>
        <p v-if="!connections.length" class="empty">No channel links yet. Add one to connect two radios.</p>
        <details ref="channelKeys" class="help-details" data-channel-keys><summary>Stored channel keys & switches · {{ channels.length }}</summary>
          <p>Keys are shared by all links using that channel. A stored key does not create a link. Leave a saved key blank to retain it. Channel switches affect both directions of every link using that channel; local repeating is unchanged.</p>
          <div v-for="(channel,index) in channels" :key="channel.name" class="channel-row">
            <label><input type="checkbox" v-model="channel.enabled"> Allow in links</label>
            <label>Channel name<input :value="channel.name" readonly maxlength="64" required></label>
            <label>{{ channel.saved ? 'Replacement key' : 'New key' }}<input v-model="channel.key" type="password" autocomplete="new-password" spellcheck="false" :required="!channel.saved" pattern="([a-fA-F0-9]{32}|[a-fA-F0-9]{64})"></label>
            <div><button type="button" class="remove-button" :disabled="channelInUse(channel.name)" @click="removeChannel(index)">Remove key</button><small>{{ channelInUse(channel.name) ? 'Used by a link' : 'No links' }}</small></div>
          </div>
        </details>
        </section>
        <section v-show="activePanel === 'transit'" id="bridge-panel-transit" data-panel="transit" class="editor-panel">
        <div class="section-heading"><div><p class="eyebrow">Saved configuration</p><h3>Protocol transit</h3></div><span class="badge">{{ settings.direct_routes?.length ?? 0 }} directions</span></div>
        <label>Peer routing mode
          <select v-model="settings.peer_routing" data-testid="peer-routing">
            <option value="legacy">Legacy shared route</option>
            <option value="distinct">Distinct local and crossing routes</option>
          </select>
        </label>
        <details class="help-details"><summary>How peer routing works</summary>        <p>Existing configurations use legacy mode. On a configured ingress, a native bridge next hop crosses to the paired radio in legacy mode, including paths that would otherwise repeat on the same radio. Distinct mode uses the native bridge next hop for local routing and a separate public route identifier for crossings.</p>
</details>
        <p class="text-accent-amber" data-testid="peer-routing-migration">Changing peer routing mode requires a restart. Clear and relearn cross-network contact paths after changing mode. Previously learned paths will not retain their crossing meaning. Channel mappings and route selections are preserved.</p>
        <details class="help-details"><summary>What crosses a transit direction?</summary>        <p>Transit is disabled unless a route is added. The bridge forwards eligible encrypted packets without decrypting them. Both endpoints need known contact paths for the forward and reverse directions. Add a reverse route for replies and acknowledgements.</p>
        <p>Flood discovery, repeater administration and TRACE are separately opt-in below. The encrypted TXT_MSG subtype is opaque to the bridge; this is not content filtering or individual sender authentication. Local-only discovery CONTROL packets and adverts stay on their local radio.</p>
</details>
        <div v-for="(route,index) in settings.direct_routes" :key="index" class="direct-route-row">
          <div class="route-card-header"><strong>Transit {{ index + 1 }}</strong><span class="badge" :class="{good: route.enabled !== false}">{{ route.enabled === false ? 'Disabled in draft' : 'Enabled in draft' }}</span></div>
          <label><input type="checkbox" :checked="route.enabled !== false" @change="route.enabled = ($event.target as HTMLInputElement).checked"> Enable transit direction</label>
          <label>Ingress radio <select v-model="route.source_radio" required><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
          <label>Outgoing radio <select v-model="route.target_radio" required><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ radioLabel(id) }}</option></select></label>
          <button type="button" class="remove-button" @click="settings.direct_routes?.splice(index,1); isEditing = true">Remove direct route</button>
        </div>
        <button type="button" @click="addDirectRoute">Add direct route</button>
        <h4 class="mapping-heading">Cross-frequency protocols</h4>
        <p>These options require distinct peer routing and use the enabled transit directions above. Enable both directions for responses. Existing route and channel selections are preserved; saving does not send a probe.</p>
        <div v-if="settings.protocols" class="protocol-options">
          <label><input v-model="settings.protocols.discovery" type="checkbox"> Discovery and contact path learning (TXT / PATH / ACK)</label>
          <label><input v-model="settings.protocols.repeater_admin" type="checkbox"> Repeater administration and opaque encrypted message transit</label>
          <p>Enabling repeater administration also allows ordinary flood direct messages (TXT_MSG) and acknowledgments to cross enabled transit directions. The bridge cannot distinguish encrypted CLI traffic from ordinary encrypted direct messages.</p>
          <label><input v-model="settings.protocols.trace" type="checkbox"> TRACE across enabled transit directions</label>
        </div>

        </section>
        <section v-show="activePanel === 'safeguards'" id="bridge-panel-safeguards" data-panel="safeguards" class="editor-panel">
        <div class="section-heading"><div><p class="eyebrow">Saved configuration</p><h3>Traffic safeguards</h3></div><span class="badge">Apply after restart</span></div>
        <p>Give each direction its own flood crossing budget. Direct and TRACE traffic bypass rate and burst limits; pending limits still apply.</p>
        <details class="help-details"><summary>Defaults & enforcement</summary>        <p>Each direction has its own flood crossing budget. Direct and TRACE traffic bypass rate and burst limits; pending limits still apply. Local repeats do not consume the crossing budget. Limits apply after restart. Defaults are enforced even when the host configuration has no traffic_limits section: 12 flood crossings per minute, a burst of 3, and 16 pending crossings per direction. Upgrading activates these defaults without a separate configuration step. Use Live activity to verify active limits.</p>
</details>
        <div class="field-grid">        <template v-if="settings.traffic_limits">
          <label>Flood crossings per minute <input v-model.number="settings.traffic_limits.per_minute" type="number" min="1" max="600" required></label>
          <label>Allowed burst <input v-model.number="settings.traffic_limits.burst" type="number" min="1" max="100" required></label>
          <label>Pending per direction <input v-model.number="settings.traffic_limits.max_pending_per_direction" type="number" min="1" max="1000" required></label>
        </template>
</div>
        <h4 class="mapping-heading">Shared crossing queue</h4>
        <p class="muted">Bound total queued work and expire crossings that wait too long.</p>
        <div class="field-grid">
          <label>Pending crossing limit <input v-model.number="settings.max_pending_crossings" type="number" min="1" max="1000" placeholder="64"></label>
          <label>Queue expiry, seconds <input v-model.number="settings.queue_ttl_seconds" type="number" min="1" max="120" placeholder="30"></label>
        </div>
        <details class="help-details"><summary>Host storage</summary><label>Echo database path <input v-model="settings.echo_database" readonly></label><p class="muted">Managed by the host. This editor does not change the database path.</p></details>

        </section>
      </fieldset>
      <footer v-show="editingPanel || isEditing || !!newConnection" class="save-bar">
        <div><strong>{{ busy ? 'Saving settings…' : newConnection ? 'Finish adding your channel link' : isEditing ? 'Unsaved changes' : 'Saved settings' }}</strong><p>{{ newConnection ? 'Add it to your draft or cancel before saving.' : isEditing ? 'Status refresh will not replace your edits.' : 'Saving does not restart OpenHop or transmit packets.' }}</p></div>
        <div class="save-actions"><button type="button" :disabled="busy || pausing" @click="discard">Discard changes</button><button type="submit" class="save-button" :disabled="busy || pausing || writeUnconfirmed || !!newConnection">{{ busy ? 'Saving…' : 'Save bridge settings' }}</button></div>
      </footer>
    </form>
    <section v-if="activePanel === 'transmitters'" id="bridge-panel-transmitters"><TxGroupSettings /></section>
    <section v-show="activePanel === 'activity'" id="bridge-panel-activity"><BridgeDiagnostics :running="state?.running" :active="activePanel === 'activity'" /></section>
    <section v-show="activePanel === 'link'" id="bridge-panel-link"><InternetLinkSettings ref="internetLink" :active="activePanel === 'link'" /></section>
  </section>
</template>

<style scoped>
.bridge-settings { color: var(--color-text-secondary); width: 100%; max-width: 92rem; margin: 0 auto; }
.bridge-header, .section-heading, .runtime-bar, .runtime-actions, .save-bar, .save-actions, .route-card-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.bridge-header { margin-bottom: 1.5rem; align-items: flex-start; }
h2 { font-size: clamp(1.5rem, 3vw, 2rem); letter-spacing: -.025em; font-weight: 650; color: var(--color-heading); line-height: 1.25; margin-bottom: .5rem; }
h3 { font-size: 1.15rem; font-weight: 650; color: var(--color-heading); }
h4 { font-size: .9rem; font-weight: 650; color: var(--color-heading); }
p { line-height: 1.6; margin: .6rem 0; font-size: .82rem; }
.eyebrow { font-size: .65rem; text-transform: uppercase; letter-spacing: .14em; font-weight: 700; color: var(--color-badge-cyan-text); margin: 0 0 .4rem; }
.muted, small { color: var(--color-text-muted); font-size: .78rem; }
.header-tag { border: 1px solid var(--color-border-subtle); border-radius: 2rem; padding: .35rem .7rem; font-size: .68rem; color: var(--color-text-muted); }
.runtime-bar { background: var(--color-surface-elevated); border: 1px solid var(--color-border-subtle); border-radius: .8rem; padding: 1rem 1.2rem; flex-wrap: wrap; }
.runtime-primary { display: flex; gap: .75rem; align-items: center; }
.runtime-primary h3, .runtime-metric > span { font-size: .67rem; font-weight: 500; color: var(--color-text-muted); }
.runtime-primary strong { font-size: 1.1rem; color: var(--color-heading); display: block; margin-top: .2rem; }
.status-dot { width: .65rem; height: .65rem; border-radius: 50%; background: var(--color-text-muted); }
.status-dot.live { background: var(--color-accent-cyan); box-shadow: 0 0 0 5px var(--color-badge-cyan-bg); }
.status-dot.paused { background: var(--color-accent-amber); }
.runtime-metric { display: flex; flex-direction: column; gap: .35rem; }
.runtime-metric strong { font-size: .8rem; }
.runtime-actions { flex-wrap: wrap; gap: .5rem; }
button { border: 1px solid var(--color-border); border-radius: .45rem; padding: .55rem .8rem; cursor: pointer; font-size: .75rem; font-weight: 550; background: var(--color-surface-elevated); color: var(--color-text-primary); min-height: 38px; }
button:hover:not(:disabled) { border-color: var(--color-primary); background: var(--color-background-soft); }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
.pause-button { color: var(--color-badge-amber-text); border-color: var(--color-badge-amber-border, var(--color-border)); background: var(--color-badge-amber-bg); }
.bridge-navigation { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); padding: .35rem; border: 1px solid var(--color-border-subtle); border-radius: .75rem; background: var(--color-background-soft); margin: 1.4rem 0; gap: .25rem; }
.bridge-navigation button { text-align: left; border: 1px solid transparent; background: transparent; padding: .7rem .75rem; }
.bridge-navigation span, .bridge-navigation small { display: block; }
.bridge-navigation span { font-size: .78rem; }
.bridge-navigation small { font-size: .63rem; margin-top: .25rem; font-weight: 400; }
.bridge-navigation button[aria-current] { background: var(--color-surface-elevated); border-color: var(--color-border); box-shadow: 0 2px 6px #00000009; }
.bridge-navigation button[aria-current] span { color: var(--color-badge-cyan-text); }
.editor-panel { border: 1px solid var(--color-border-subtle); border-radius: .8rem; background: var(--color-surface); padding: 1.4rem; }
.section-heading { margin-bottom: 1.1rem; flex-wrap: wrap; }
.badge { display: inline-block; width: fit-content; border-radius: .35rem; padding: .25rem .5rem; font-size: .65rem; font-weight: 600; color: var(--color-badge-neutral-text); background: var(--color-badge-neutral-bg); }
.badge.good { color: var(--color-badge-cyan-text); background: var(--color-badge-cyan-bg); }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 2rem; }
.setup-summary { background: var(--color-background-soft); border: 1px solid var(--color-border-subtle); border-radius: .6rem; padding: 1.1rem; }
.setup-summary dl { margin: .8rem 0; }
.setup-summary dl > div { display: flex; gap: 1rem; justify-content: space-between; padding: .6rem 0; border-bottom: 1px solid var(--color-border-subtle); font-size: .78rem; }
.setup-summary dd { font-weight: 650; color: var(--color-text-primary); text-align: right; }
label { display: block; font-size: .75rem; font-weight: 550; margin: .75rem 0; min-width: 0; }
label small { display: block; font-weight: 400; margin-top: .3rem; }
input:not([type=checkbox]), select { display: block; padding: .6rem .7rem; width: 100%; min-width: 0; max-width: 100%; border: 1px solid var(--color-border); border-radius: .4rem; color: var(--color-text-primary); background: var(--color-surface-elevated); font-size: .8rem; margin-top: .4rem; min-height: 40px; scroll-margin-top: 8rem; }
input[readonly] { color: var(--color-text-muted); background: var(--color-background-soft); }
input[type=checkbox] { accent-color: var(--color-primary); width: 1rem; height: 1rem; vertical-align: middle; margin-right: .45rem; flex-shrink: 0; }
.switch-row { display: flex; align-items: flex-start; gap: .45rem; padding: .9rem; background: var(--color-background-soft); border: 1px solid var(--color-border-subtle); border-radius: .5rem; margin-top: 0; }
.switch-row input { margin-top: .15rem; }
.channel-row { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1fr) minmax(0, 1.3fr) auto; align-items: end; gap: 1rem; border: 1px solid var(--color-border-subtle); border-radius: .6rem; padding: .85rem; margin: 1rem 0; }
.channel-row label { margin: 0; }
.channel-row > label:first-child { align-self: center; }
.remove-button { color: var(--color-badge-red-text); background: transparent; border-color: transparent; }
.mapping-heading { margin-top: 2rem; padding-top: 1.3rem; border-top: 1px solid var(--color-border-subtle); }
.mapping-row, .direct-route-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: end; gap: .75rem 1rem; border: 1px solid var(--color-border-subtle); border-radius: .65rem; padding: 1rem; margin: 1rem 0; background: var(--color-surface-elevated); }
.mapping-row label, .direct-route-row label { margin: 0; }
.route-card-header { grid-column: 1 / -1; font-size: .8rem; margin-bottom: .3rem; }
.direct-route-row > label:first-of-type { grid-column: 1 / -1; margin-bottom: .2rem; }
.mapping-row .remove-button { grid-column: 1 / -1; justify-self: end; }
.direct-route-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
.protocol-options { background: var(--color-background-soft); padding: .4rem 1rem; border: 1px solid var(--color-border-subtle); border-radius: .6rem; margin-top: 1rem; }
.protocol-options label { padding: .6rem 0; }
.field-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.help-details { font-size: .78rem; margin-top: 1.2rem; border-top: 1px solid var(--color-border-subtle); padding-top: 1rem; }
.help-details summary { cursor: pointer; color: var(--color-text-secondary); font-weight: 600; }
.help-details p, .help-details li { color: var(--color-text-muted); font-size: .75rem; }
.help-details li { margin: .5rem 0; }
.route-id { overflow-wrap: anywhere; }
.notice { border-left: 3px solid var(--color-border-hover); background: var(--color-background-soft); border-radius: .4rem; padding: .75rem 1rem; font-size: .8rem; margin: .8rem 0; }
.error-notice { color: var(--color-badge-red-text); background: var(--color-badge-red-bg); border-color: var(--color-accent-red); }
.restart-notice { color: var(--color-badge-amber-text); background: var(--color-badge-amber-bg); border-color: var(--color-accent-amber); }
.warning-text { color: var(--color-badge-amber-text); }
.bridge-editor { display: flex; flex-direction: column; }
.save-bar { order: -1; position: sticky; top: 1rem; z-index: 5; background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: .65rem; padding: .85rem 1.1rem; margin: 0 0 1rem; box-shadow: 0 5px 22px #00000018; flex-wrap: wrap; }
.save-bar strong { font-size: .8rem; color: var(--color-text-primary); }
.save-bar p { font-size: .72rem; margin: .2rem 0 0; color: var(--color-text-muted); }
.save-actions { gap: .6rem; flex-wrap: wrap; }
.save-button { color: var(--color-primary-contrast, white); background: var(--color-primary); border-color: var(--color-primary); }
.save-button:hover:not(:disabled) { background: var(--color-primary); filter: brightness(.9); }
.empty { text-align: center; color: var(--color-text-muted); padding: 1.5rem; }
@media (max-width: 1100px) { .bridge-navigation { grid-template-columns: repeat(3, minmax(0, 1fr)); } .channel-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } .mapping-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .bridge-header { margin-bottom: 1rem; } .header-tag { display: none; } .runtime-bar { padding: 1rem; gap: 1.1rem; } .runtime-primary { width: 100%; } .runtime-actions { width: 100%; justify-content: flex-start; } .bridge-navigation { grid-template-columns: repeat(2, minmax(0, 1fr)); } .overview-grid { grid-template-columns: 1fr; gap: 1rem; } .editor-panel { padding: 1rem; } .channel-row, .mapping-row, .direct-route-row, .field-grid { grid-template-columns: 1fr; } .channel-row > button, .direct-route-row > button { justify-self: end; } .save-bar { top: .5rem; padding: .85rem; } .save-actions { width: 100%; } .save-actions button { flex: 1; } }
.connection-builder { border: 1px solid var(--color-primary); border-radius: .65rem; padding: 1.2rem; margin: 1.2rem 0; background: var(--color-background-soft); }
.connection-endpoints { display: grid; grid-template-columns: minmax(0,1fr) 2rem minmax(0,1fr); gap: 1rem; }
.connection-arrow { align-self: center; text-align: center; font-size: 1.7rem; color: var(--color-text-muted); }
.connection-radios { margin: .3rem 0 0; color: var(--color-text-muted); }
.connection-badges { display:flex; flex-wrap:wrap; gap:.4rem; }
.badge.translation { background: var(--color-badge-cyan-bg); color: var(--color-badge-cyan-text); }
.connection-directions { grid-column: 1 / -1; display:flex; flex-wrap:wrap; align-items:center; gap:1rem; padding-top:.75rem; border-top:1px solid var(--color-border-subtle); }
.shared-channel { margin-top: 1.5rem; overflow-wrap:anywhere; }
.shared-channel small, .channel-row small { display:block; margin-top:.4rem; }
.connection-card strong { overflow-wrap:anywhere; }
@media (max-width:700px) { .connection-endpoints { grid-template-columns:1fr; gap:.5rem; } .connection-arrow { display:none; } .connection-card .route-card-header { align-items:flex-start; flex-direction:column; } }
</style>
