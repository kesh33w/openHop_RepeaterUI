<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ApiService from '@/utils/api';
type Mapping = { source_radio: string; target_radio: string; source_channel: string; target_channel: string };
type DirectRoute = { source_radio: string; target_radio: string };
type Settings = { enabled: boolean; origin_home?: string; channels: Record<string,string>; mappings: Mapping[]; direct_routes?: DirectRoute[]; echo_database?: string; queue_ttl_seconds?: number; max_pending_crossings?: number; [key: string]: unknown };
const settings = ref<Settings>({ enabled: false, channels: {}, mappings: [] });
const radios = ref<string[]>([]);
const channels = ref<{name:string; key:string; saved:boolean}[]>([]);
const busy = ref(false);
const ready = ref(false);
const message = ref('');
const isEditing = ref(false);
async function load() {
  busy.value = true;
  try {
    const response = await ApiService.get<{settings: Settings; radio_ids: string[]}>('/bridge_settings');
    if (!response.success || !response.data) throw new Error('load');
    settings.value = {...response.data.settings, direct_routes: response.data.settings.direct_routes || []};
    radios.value = response.data.radio_ids;
    channels.value = Object.keys(settings.value.channels).map(name => ({name, key:'', saved:true}));
    ready.value = true;
    isEditing.value = false;
  } catch { message.value = 'Bridge settings could not be loaded.'; }
  finally { busy.value = false; }
}
async function save() {
  busy.value = true;
  message.value = '';
  try {
    if (settings.value.enabled && !radios.value.includes(settings.value.origin_home || '')) {
      message.value = 'Not saved. Select an origin home radio for messages sent by OpenHop.';
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
    const response = await ApiService.post('/update_bridge_settings', {...settings.value, channels:submitted});
    if (!response.success) {
      message.value = response.error === 'bridge_home_assignment_required'
        ? 'Not saved. Assign an origin home radio and a home radio for every companion. Edit companion homes on the Companions page.'
        : 'Not saved. Check channel keys, radio selections, mappings and queue limits.';
      return;
    }
    await load();
    message.value = 'Saved. Restart OpenHop to apply these settings. The running bridge is unchanged.';
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
  if (!isEditing.value || window.confirm('Discard unsaved bridge changes?')) accept(); else cancel?.();
}
defineExpose({isEditing, requestLeave});
onMounted(load);
</script>

<template>
  <section class="bridge-settings">
    <h2>Bridge</h2>
    <p>Repeat locally and translate authenticated group chat between two radios. Group channel translation is independent of optional encrypted direct-message transit.</p>
    <p>Each mapping is one-way. Add a reverse mapping for replies. Saving requires a restart; it does not transmit or restart the service.</p>
    <p role="status" aria-live="polite">{{ message }}</p>
    <form v-if="ready" @submit.prevent="save" @input="isEditing = true" @change="isEditing = true">
      <fieldset :disabled="busy">
        <label><input v-model="settings.enabled" type="checkbox"> Enable bridge</label>
        <label>Origin home radio
          <select v-model="settings.origin_home" data-testid="origin-home" :required="settings.enabled">
            <option value="">Select a radio</option>
            <option v-for="id in radios" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
        <p>Choose where messages sent by OpenHop originate. Each companion also needs its own home radio on the Companions page. A channel mapping may then forward the message to the other side.</p>
        <label>Echo database path <input v-model="settings.echo_database" readonly required></label>
        <label>Pending crossing limit <input v-model.number="settings.max_pending_crossings" type="number" min="1" max="1000" placeholder="64"></label>
        <label>Queue expiry, seconds <input v-model.number="settings.queue_ttl_seconds" type="number" min="1" max="120" placeholder="30"></label>
        <h3>Channels</h3>
        <p>Stored keys are never returned. Leave a saved channel's key blank to retain it. Enter a 32- or 64-character hexadecimal key to replace it. Removing a row removes that channel on save.</p>
        <div v-for="(channel,index) in channels" :key="index" class="channel-row">
          <label>Channel name <input v-model="channel.name" :readonly="channel.saved" maxlength="64" required></label>
          <label>{{ channel.saved ? 'Replacement key' : 'New key' }} <input v-model="channel.key" type="password" autocomplete="new-password" spellcheck="false" :required="!channel.saved" pattern="([a-fA-F0-9]{32}|[a-fA-F0-9]{64})"></label>
          <button type="button" @click="channels.splice(index,1); isEditing = true">Remove channel</button>
        </div>
        <button type="button" @click="channels.push({name:'',key:'',saved:false}); isEditing = true">Add channel</button>
        <h3>Mappings</h3>
        <div v-for="(mapping,index) in settings.mappings" :key="index" class="mapping-row">
          <label>Source radio <select v-model="mapping.source_radio" required><option v-for="id in radios" :key="id">{{ id }}</option></select></label>
          <label>Source channel <select v-model="mapping.source_channel" required><option v-for="c in channels" :key="c.name">{{ c.name }}</option></select></label>
          <label>Destination radio <select v-model="mapping.target_radio" required><option v-for="id in radios" :key="id">{{ id }}</option></select></label>
          <label>Destination channel <select v-model="mapping.target_channel" required><option v-for="c in channels" :key="c.name">{{ c.name }}</option></select></label>
          <button type="button" @click="settings.mappings.splice(index,1); isEditing = true">Remove mapping</button>
        </div>
        <button type="button" @click="addMapping">Add mapping</button>
        <h3>Direct-message transit</h3>
        <p>Disabled unless a route is added. On a configured ingress, a direct path naming this bridge as its next hop means cross to the paired radio. The bridge forwards eligible encrypted packets without decrypting them. Both endpoints need known contact paths for the forward and reverse directions. Add a reverse route for replies and acknowledgements.</p>
        <p>Flooded direct messages and unknown reverse-path discovery do not cross. The encrypted TXT_MSG subtype is opaque to the bridge; this is not content filtering or individual sender authentication.</p>
        <div v-for="(route,index) in settings.direct_routes" :key="index" class="direct-route-row">
          <label>Ingress radio <select v-model="route.source_radio" required><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ id }}</option></select></label>
          <label>Outgoing radio <select v-model="route.target_radio" required><option value="">Select a radio</option><option v-for="id in radios" :key="id" :value="id">{{ id }}</option></select></label>
          <button type="button" @click="settings.direct_routes?.splice(index,1); isEditing = true">Remove direct route</button>
        </div>
        <button type="button" @click="addDirectRoute">Add direct route</button>
        <div class="actions"><button type="submit">Save bridge settings</button><button type="button" @click="load">Discard changes</button></div>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
.bridge-settings { max-width: 64rem; padding: 1rem; }
h2,h3 { font-weight: 600; margin: 1rem 0; }
p { margin: .75rem 0; }
label { display: block; margin: .65rem 0; }
input:not([type=checkbox]),select { display: block; padding: .5rem; border: 1px solid #888; border-radius: .3rem; background: transparent; max-width: 100%; }
.channel-row,.mapping-row,.direct-route-row { display: flex; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid #888; padding: .75rem 0; align-items: end; }
button { border: 1px solid #888; border-radius: .3rem; padding: .5rem .75rem; margin: .5rem 0; cursor: pointer; }
.actions { display: flex; gap: 1rem; margin-top: 1rem; }
</style>
