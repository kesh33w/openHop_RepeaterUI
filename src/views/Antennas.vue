<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ApiService from '@/utils/api';
import type { AntennaRadioStats, AntennaStats, RelayNetworkStats, RelayStats } from '@/generated/openapi';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';
import { useAntennaCodes } from '@/components/hydrahop/useAntennaCodes';
import RetiredCodesNotice from '@/components/hydrahop/RetiredCodesNotice.vue';

defineOptions({ name: 'AntennasView' });

const { radioLabel } = useMultiRadioConfig();
const antennaCodes = useAntennaCodes();
const retiredCodes = antennaCodes.retired;

const WINDOWS = [
  { hours: 1, label: 'Last hour' },
  { hours: 6, label: 'Last 6 hours' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 168, label: 'Last 7 days' },
];
const REFRESH_MS = 60_000;

const hours = ref(24);
const stats = ref<AntennaStats | null>(null);
const relays = ref<RelayStats | null>(null);
const relayError = ref('');
const loading = ref(false);
const error = ref('');
const updatedAt = ref<Date | null>(null);
let generation = 0;

async function refresh() {
  const mine = ++generation;
  loading.value = true;
  try {
    // Relay attribution is a separate, optional view: its failure must not hide the rest.
    void antennaCodes.refresh();
    const [response, relayResponse] = await Promise.all([
      ApiService.get<AntennaStats>('/antenna_stats', { hours: hours.value }),
      ApiService.get<RelayStats>('/relay_stats', { hours: hours.value }).catch(() => null),
    ]);
    if (mine !== generation) return;
    if (relayResponse?.success && relayResponse.data) {
      relays.value = relayResponse.data;
      relayError.value = '';
    } else {
      relayError.value = 'Which copy neighbours relayed is unavailable right now.';
    }
    if (!response.success || !response.data) throw new Error(response.error || 'unavailable');
    stats.value = response.data;
    updatedAt.value = new Date();
    error.value = '';
  } catch {
    if (mine === generation) error.value = 'Antenna statistics are unavailable right now. Shown values may be out of date.';
  } finally {
    if (mine === generation) loading.value = false;
  }
}

watch(hours, () => { stats.value = null; relays.value = null; void refresh(); });
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void refresh();
  timer = setInterval(() => { if (!document.hidden && !loading.value) void refresh(); }, REFRESH_MS);
});
onUnmounted(() => { generation++; if (timer) clearInterval(timer); });

const fmt = (n: number) => n.toLocaleString();
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const db = (v: number | null | undefined, unit = 'dBm') => (v === null || v === undefined ? '—' : `${v.toFixed(1)} ${unit}`);

type Gap = AntennaStats['networks'][number]['signal_gaps'][number];
// Fewer matched frames than this and an average says little.
const MIN_FRAMES = 30;

// SNR decides whether a packet decodes and is comparable between radio models;
// RSSI is not calibrated between them, so it is reported but not led with.
function signalFinding(g: Gap): string {
  const a = radioLabel(g.a), b = radioLabel(g.b);
  if (g.frames < MIN_FRAMES) {
    return `${a} and ${b} heard too few of the same frames (${fmt(g.frames)}) to compare their signal fairly.`;
  }
  const rssi = g.rssi_db === null ? '' : ` RSSI differs by ${Math.abs(g.rssi_db).toFixed(1)} dB, but RSSI is not calibrated the same across radio models.`;
  if (g.snr_db === null) return `On ${fmt(g.frames)} frames both heard from the same relay, SNR was not recorded.${rssi}`;
  const gap = Math.abs(g.snr_db);
  const better = g.snr_db >= 0 ? a : b, worse = g.snr_db >= 0 ? b : a;
  return gap < 1
    ? `On ${fmt(g.frames)} frames both heard from the same relay, ${a} and ${b} decode at about the same SNR.${rssi}`
    : `On ${fmt(g.frames)} frames both heard from the same relay, ${better} gets ${gap.toFixed(1)} dB better SNR than ${worse}.${rssi}`;
}

function roleLabel(r: AntennaRadioStats): string {
  if (!stats.value?.topology_source) return '';
  if (r.role === 'shadow') return 'shadow: compared live, not recorded';
  if (r.transmits === 'all') return 'receives and sends';
  if (r.transmits === 'crossings') return 'receives; sends bridged packets only';
  return 'receives only';
}

const radioById = computed(() => new Map((stats.value?.radios ?? []).map(r => [r.radio_id, r])));

// Which copy of a double send neighbours relayed. A neighbour relays the copy it
// hears first and drops the other, so a relay of the second copy is reach the
// second send added.
type RelayView = RelayNetworkStats & { addedBySecond: number; finding: string };
const relayByNetwork = computed(() => {
  const out = new Map<string, RelayView>();
  for (const n of relays.value?.networks ?? []) {
    if (!n.double_sent) continue;
    const addedBySecond = n.radios.reduce((sum, r) => sum + r.relayed_when_second, 0);
    let finding = '';
    if (n.tagged === 0) {
      finding = relays.value?.identity_codes
        ? 'None of the double-sent packets could be told apart yet: both copies carried the same code (1-byte paths and direct routes cannot carry per-radio codes).'
        : 'Identity codes are off, so both copies carry the same code and the relays cannot be told apart.';
    } else if (n.relayed === 0) {
      finding = `No neighbour was heard relaying any of the ${fmt(n.tagged)} packets whose copies could be told apart.`;
    } else {
      finding = `The second copy was relayed on ${fmt(addedBySecond)} of ${fmt(n.tagged)} packets (${pct(addedBySecond, n.tagged)}%): neighbours that had not heard the first copy.`;
    }
    out.set(n.network, { ...n, addedBySecond, finding });
  }
  return out;
});

// Only networks with two or more antennas have anything to compare.
const networks = computed(() => (stats.value?.networks ?? []).filter(n => n.radios.length > 1).map(n => {
  const radios = n.radios.map(id => radioById.value.get(id)).filter((r): r is AntennaRadioStats => !!r);
  const segments = n.heard_by.map((h, k) => ({
    key: h.radios.join('+'),
    label: h.radios.length === n.radios.length ? 'All antennas' : h.radios.length > 1 ? h.radios.map(radioLabel).join(' + ') : `Only ${radioLabel(h.radios[0]!)}`,
    packets: h.packets,
    share: pct(h.packets, n.packets),
    tone: h.radios.length === n.radios.length ? 'all' : `only${k % 3}`,
  }));
  const findings: string[] = [];
  for (const r of radios) {
    if (!r.recorded) findings.push(`${radioLabel(r.radio_id)} is a shadow radio: its receptions are compared live but not recorded, so it cannot be judged here.`);
    else if (!r.has_data) findings.push(`No data was recorded for ${radioLabel(r.radio_id)} in this window.`);
    else if (r.unique_packets > 0) findings.push(`${radioLabel(r.radio_id)} caught ${fmt(r.unique_packets)} packets (${pct(r.unique_packets, n.packets)}%) no other antenna here heard.`);
  }
  for (const g of n.signal_gaps) {
    // A shadow radio has no stored receptions; its finding above says so.
    if (radioById.value.get(g.a)?.recorded === false || radioById.value.get(g.b)?.recorded === false) continue;
    findings.push(signalFinding(g));
  }
  return { ...n, radios, segments, findings, relay: relayByNetwork.value.get(n.network) };
}));
const hasComparison = computed(() => networks.value.length > 0);



// rx rows depend on stored receptions, tx rows on the radio sending at all.
type Row = { label: string; hint: string; kind?: 'rx' | 'tx'; value: (r: AntennaRadioStats) => string; warn?: (r: AntennaRadioStats) => boolean };
const rows: Row[] = [
  { label: 'Packets received', hint: 'Every copy heard, duplicates and bridge echoes included', kind: 'rx', value: r => fmt(r.received) },
  { label: 'Only this antenna', hint: 'Packets no other antenna on this network heard', kind: 'rx', value: r => fmt(r.unique_packets) },
  { label: 'Bridge echoes', hint: 'Neighbours repeating packets we bridged; left out of the other figures', kind: 'rx', value: r => fmt(r.bridge_echoes) },
  { label: 'Average signal', hint: 'RSSI of received packets', kind: 'rx', value: r => db(r.rssi_avg) },
  { label: 'Average SNR', hint: 'Signal-to-noise ratio of received packets', kind: 'rx', value: r => db(r.snr_avg, 'dB') },
  { label: 'Noise floor', hint: 'Average, with the quiet (10%) to busy (90%) range', value: r => r.noise.avg === null ? '—' : `${db(r.noise.avg)} (${r.noise.p10} to ${r.noise.p90})` },
  { label: 'Corrupted packets', hint: 'CRC errors per hour', value: r => `${r.crc_errors_per_hour} / h` },
  { label: 'Repeaters heard', hint: 'Distinct repeaters heard relaying to us; in brackets, how many only this antenna heard', kind: 'rx', value: r => `${r.upstream_repeaters} (${r.unique_upstream_repeaters} only here)` },
  { label: 'Sends', hint: 'Transmissions on this antenna', kind: 'tx', value: r => fmt(r.sends) },
  { label: 'Waited for a busy channel', hint: 'Sends that held off because the channel was busy', kind: 'tx', value: r => r.sends ? `${fmt(r.busy_holds)} (${pct(r.busy_holds, r.sends)}%)` : '—', warn: r => r.sends > 0 && r.busy_holds / r.sends > 0.4 },
  { label: 'Average wait before sending', hint: 'Listen-before-talk back-off per send', kind: 'tx', value: r => r.backoff_avg_ms === null ? '—' : `${Math.round(r.backoff_avg_ms)} ms` },
  { label: 'Failed sends', hint: 'The radio reported it could not transmit', kind: 'tx', value: r => fmt(r.send_failures), warn: r => r.send_failures > 0 },
];

// "No data" and "not recorded" are not zero: say which.
function cell(row: Row, r: AntennaRadioStats): { text: string; missing: boolean } {
  if (row.kind === 'rx' && !r.recorded) return { text: 'Not recorded', missing: true };
  if (!r.has_data) return { text: 'No data', missing: true };
  if (row.kind === 'tx' && !r.sends && stats.value?.topology_source && !r.transmits) return { text: 'Does not send', missing: true };
  return { text: row.value(r), missing: false };
}
</script>

<template>
  <section class="antennas-page space-y-5" data-testid="antennas-page">
    <header class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-content-primary">Antennas</h2>
        <p class="text-sm text-content-secondary mt-1">
          What each antenna adds on its network: what it hears, how well, and how busy its channel is.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label for="antenna-window" class="text-sm text-content-secondary">Window</label>
        <select id="antenna-window" v-model.number="hours" class="modal-select w-auto" data-testid="antenna-window">
          <option v-for="w in WINDOWS" :key="w.hours" :value="w.hours">{{ w.label }}</option>
        </select>
        <button type="button" class="modal-btn-cancel !py-2 !px-3 !text-sm" :disabled="loading" @click="refresh">
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
    </header>

    <p v-if="error" role="alert" class="notice failed-notice">{{ error }}</p>
    <RetiredCodesNotice :retired="retiredCodes" />
    <p class="muted" role="status">
      <template v-if="loading && !stats">Loading antenna statistics…</template>
      <template v-else-if="updatedAt">Updated {{ updatedAt.toLocaleTimeString() }} · refreshes every minute.</template>
    </p>

    <p v-if="stats && !hasComparison" class="notice" data-testid="antennas-single">
      Each network here has a single antenna, so there is nothing to compare. Add a second receiver on the same network to see what it adds.
    </p>

    <section v-for="n in networks" :key="n.network" class="panel" :data-testid="`antenna-network-${n.network}`">
      <div class="panel-heading">
        <h3>{{ n.network }}</h3>
        <span class="badge">{{ fmt(n.packets) }} distinct packets</span>
      </div>

      <h4>Who heard each packet</h4>
      <div class="share-bar" role="img" :aria-label="n.segments.map(s => `${s.label} ${s.share}%`).join(', ')">
        <span v-for="s in n.segments" :key="s.key" :class="s.tone" :style="{ width: `${Math.max(s.share, s.packets ? 1 : 0)}%` }" :title="`${s.label}: ${fmt(s.packets)}`"></span>
      </div>
      <ul class="share-legend">
        <li v-for="s in n.segments" :key="s.key"><span :class="['swatch', s.tone]"></span>{{ s.label }} <strong>{{ fmt(s.packets) }}</strong> <span class="muted">{{ s.share }}%</span></li>
      </ul>
      <ul v-if="n.findings.length" class="findings" data-testid="antenna-findings">
        <li v-for="f in n.findings" :key="f">{{ f }}</li>
      </ul>

      <template v-if="n.relay">
        <h4 class="relay-heading">Which copy neighbours relayed</h4>
        <p class="muted">
          {{ fmt(n.relay.double_sent) }} packets sent on two antennas{{ relays?.random_order?.[n.network] ? ' in random order' : '' }};
          {{ fmt(n.relay.tagged) }} could be told apart, {{ fmt(n.relay.relayed) }} of those heard relayed.
        </p>
        <ul class="findings" data-testid="relay-finding"><li>{{ n.relay.finding }}</li></ul>
        <div v-if="n.relay.tagged > 0" class="table-wrap">
          <table data-testid="relay-radios">
            <thead>
              <tr>
                <th scope="col">Copy from</th>
                <th scope="col" class="num">Code</th>
                <th scope="col" class="num">Went first</th>
                <th scope="col" class="num">Relayed</th>
                <th scope="col" class="num">…when it went first</th>
                <th scope="col" class="num">…when it went second</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in n.relay.radios" :key="r.radio_id">
                <th scope="row">{{ radioLabel(r.radio_id) }}</th>
                <td class="num">{{ r.code?.toUpperCase() ?? '—' }}</td>
                <td class="num">{{ fmt(r.sent_first) }}</td>
                <td class="num">{{ fmt(r.relayed) }}</td>
                <td class="num">{{ fmt(r.relayed_when_first) }}</td>
                <td class="num">{{ fmt(r.relayed_when_second) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="n.relay.neighbours.length" class="table-wrap">
          <table data-testid="relay-neighbours">
            <thead>
              <tr>
                <th scope="col">Neighbour</th>
                <th scope="col" class="num">Relays</th>
                <th v-for="r in n.relay.radios" :key="r.radio_id" scope="col" class="num">{{ radioLabel(r.radio_id) }}'s copy</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="nb in n.relay.neighbours" :key="nb.neighbour">
                <th scope="row">{{ nb.neighbour }}</th>
                <td class="num">{{ fmt(nb.relays) }}</td>
                <td v-for="r in n.relay.radios" :key="r.radio_id" class="num">{{ fmt(nb.by_radio[r.radio_id] ?? 0) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else-if="relayError" class="muted">{{ relayError }}</p>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">Measure</span></th>
              <th v-for="r in n.radios" :key="r.radio_id" scope="col" class="num">
                {{ radioLabel(r.radio_id) }}<small v-if="roleLabel(r)">{{ roleLabel(r) }}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.label">
              <th scope="row">{{ row.label }}<small>{{ row.hint }}</small></th>
              <td v-for="r in n.radios" :key="r.radio_id" class="num" :class="cell(row, r).missing ? 'missing' : { warn: row.warn?.(r) }">{{ cell(row, r).text }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <details v-if="hasComparison" class="help-details">
      <summary>How to read this</summary>
      <p>Antennas are compared only with others on the same network (same frequency). A packet counts once per network; "only this antenna" packets are what that antenna adds.</p>
      <p>"Who heard each packet" is coverage: a message counts as heard by an antenna whichever relay it came from.</p>
      <p>The signal comparison is stricter: only the same radio frame (the same packet from the same relay, within {{ stats?.match_window_seconds ?? 1 }} s) heard by both antennas, so it reflects the antennas and their cabling rather than which relays each hears. SNR is the fair comparison; RSSI is not calibrated the same across radio models.</p>
      <p>Bridge echoes, neighbours repeating packets this node bridged onto their network, are left out of coverage and signal. A noisy channel (higher noise floor) makes a radio wait more often before sending.</p>
      <p>Radios that are no longer configured, such as names used before a rename, are left out.</p>
      <p>"Which copy neighbours relayed" applies where two antennas send the same packet. With per-radio identity codes each copy carries its antenna's code, and a neighbour relays whichever copy it hears first, so the relays this node hears back show which antenna's copy reached that neighbour. A relay of the copy that went second means that neighbour had not heard the first. Random order lets each antenna go first about half the time, so neither wins just by going first. Copies sent on 1-byte paths or direct routes cannot carry a code and are not counted. Only relays this node itself hears are seen.</p>
    </details>
  </section>
</template>

<style scoped>
.antennas-page { color: var(--color-text-secondary); }
h3 { color: var(--color-heading); font-size: 1rem; font-weight: 650; }
h4 { color: var(--color-heading); font-size: .8rem; font-weight: 650; margin-bottom: .5rem; }
.muted { color: var(--color-text-muted); font-size: .8rem; }
.notice { padding: .7rem .85rem; border-radius: .4rem; background: var(--color-background-soft); font-size: .8rem; border-left: 2px solid var(--color-border-hover); }
.failed-notice { color: var(--color-badge-red-text); background: var(--color-badge-red-bg); border-color: var(--color-accent-red); }
.panel { border: 1px solid var(--color-border-subtle); border-radius: .75rem; padding: 1.1rem; background: var(--color-surface); min-width: 0; }
.panel-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: .5rem; margin-bottom: .9rem; }
.badge { display: inline-block; background: var(--color-badge-neutral-bg); color: var(--color-badge-neutral-text); padding: .2rem .5rem; border-radius: .35rem; font-size: .68rem; font-weight: 600; }
.share-bar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: var(--color-background-mute); }
.share-bar span { display: block; height: 100%; }
.all { background: var(--color-accent-cyan); }
.only0 { background: var(--color-secondary); }
.only1 { background: var(--color-accent-green); }
.only2 { background: var(--color-badge-amber-text); }
.share-legend { display: flex; flex-wrap: wrap; gap: .4rem 1.2rem; list-style: none; padding: 0; margin: .6rem 0 0; font-size: .78rem; }
.share-legend li { display: flex; align-items: center; gap: .35rem; }
.share-legend strong { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.swatch { width: .7rem; height: .7rem; border-radius: .15rem; display: inline-block; }
.findings { margin: .9rem 0 0; padding-left: 1.1rem; font-size: .82rem; line-height: 1.6; color: var(--color-text-primary); list-style: disc; }
.table-wrap { overflow-x: auto; margin-top: 1rem; }
table { width: 100%; border-collapse: collapse; font-size: .8rem; }
th, td { padding: .5rem .6rem; border-bottom: 1px solid var(--color-border-subtle); vertical-align: top; }
thead th { font-size: .78rem; color: var(--color-heading); font-weight: 650; border-bottom: 1px solid var(--color-border); }
tbody th { text-align: left; font-weight: 600; color: var(--color-text-secondary); }
th small { display: block; font-weight: 400; font-size: .68rem; color: var(--color-text-muted); }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--color-text-primary); }
.warn { color: var(--color-badge-amber-text); font-weight: 600; }
.missing { font-style: italic; opacity: .75; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.relay-heading { margin-top: 1.1rem; }
.help-details { color: var(--color-text-muted); font-size: .78rem; }
.help-details summary { cursor: pointer; color: var(--color-text-secondary); }
.help-details p { margin-top: .5rem; line-height: 1.6; }
button:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
</style>
