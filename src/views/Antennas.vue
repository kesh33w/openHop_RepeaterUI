<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ApiService from '@/utils/api';
import type { AntennaRadioStats, AntennaStats } from '@/generated/openapi';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';

defineOptions({ name: 'AntennasView' });

const { radioLabel } = useMultiRadioConfig();

const WINDOWS = [
  { hours: 1, label: 'Last hour' },
  { hours: 6, label: 'Last 6 hours' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 168, label: 'Last 7 days' },
];
const REFRESH_MS = 60_000;

const hours = ref(24);
const stats = ref<AntennaStats | null>(null);
const loading = ref(false);
const error = ref('');
const updatedAt = ref<Date | null>(null);
let generation = 0;

async function refresh() {
  const mine = ++generation;
  loading.value = true;
  try {
    const response = await ApiService.get<AntennaStats>('/antenna_stats', { hours: hours.value });
    if (mine !== generation) return;
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

watch(hours, () => { stats.value = null; void refresh(); });
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void refresh();
  timer = setInterval(() => { if (!document.hidden && !loading.value) void refresh(); }, REFRESH_MS);
});
onUnmounted(() => { generation++; if (timer) clearInterval(timer); });

const fmt = (n: number) => n.toLocaleString();
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const db = (v: number | null | undefined, unit = 'dBm') => (v === null || v === undefined ? '—' : `${v.toFixed(1)} ${unit}`);

const radioById = computed(() => new Map((stats.value?.radios ?? []).map(r => [r.radio_id, r])));

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
    if (r.unique_packets > 0) findings.push(`${radioLabel(r.radio_id)} caught ${fmt(r.unique_packets)} packets (${pct(r.unique_packets, n.packets)}%) no other antenna here heard.`);
  }
  for (const g of n.signal_gaps) {
    if (g.rssi_db === null || g.packets === 0) continue;
    const stronger = g.rssi_db >= 0 ? g.a : g.b;
    const weaker = g.rssi_db >= 0 ? g.b : g.a;
    const gap = Math.abs(g.rssi_db);
    findings.push(gap < 1
      ? `${radioLabel(g.a)} and ${radioLabel(g.b)} hear shared packets at about the same strength.`
      : `On the ${fmt(g.packets)} packets both heard, ${radioLabel(stronger)} hears them ${gap.toFixed(1)} dB stronger than ${radioLabel(weaker)}.`);
  }
  return { ...n, radios, segments, findings };
}));
const hasComparison = computed(() => networks.value.length > 0);

type Row = { label: string; hint: string; value: (r: AntennaRadioStats) => string; warn?: (r: AntennaRadioStats) => boolean };
const rows: Row[] = [
  { label: 'Packets received', hint: 'Every copy heard, duplicates included', value: r => fmt(r.received) },
  { label: 'Only this antenna', hint: 'Packets no other antenna on this network heard', value: r => fmt(r.unique_packets) },
  { label: 'Average signal', hint: 'RSSI of received packets', value: r => db(r.rssi_avg) },
  { label: 'Average SNR', hint: 'Signal-to-noise ratio of received packets', value: r => db(r.snr_avg, 'dB') },
  { label: 'Noise floor', hint: 'Average, with the quiet (10%) to busy (90%) range', value: r => r.noise.avg === null ? '—' : `${db(r.noise.avg)} (${r.noise.p10} to ${r.noise.p90})` },
  { label: 'Corrupted packets', hint: 'CRC errors per hour', value: r => `${r.crc_errors_per_hour} / h` },
  { label: 'Repeaters heard', hint: 'Distinct repeaters heard relaying to us; in brackets, how many only this antenna heard', value: r => `${r.upstream_repeaters} (${r.unique_upstream_repeaters} only here)` },
  { label: 'Sends', hint: 'Transmissions on this antenna', value: r => fmt(r.sends) },
  { label: 'Waited for a busy channel', hint: 'Sends that held off because the channel was busy', value: r => r.sends ? `${fmt(r.busy_holds)} (${pct(r.busy_holds, r.sends)}%)` : '—', warn: r => r.sends > 0 && r.busy_holds / r.sends > 0.4 },
  { label: 'Average wait before sending', hint: 'Listen-before-talk back-off per send', value: r => r.backoff_avg_ms === null ? '—' : `${Math.round(r.backoff_avg_ms)} ms` },
  { label: 'Failed sends', hint: 'The radio reported it could not transmit', value: r => fmt(r.send_failures), warn: r => r.send_failures > 0 },
];
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

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">Measure</span></th>
              <th v-for="r in n.radios" :key="r.radio_id" scope="col" class="num">
                {{ radioLabel(r.radio_id) }}<small v-if="r.role">{{ r.role === 'transceiver' ? 'sends and receives' : r.role === 'receiver' ? 'receives (sends in TX group)' : r.role }}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.label">
              <th scope="row">{{ row.label }}<small>{{ row.hint }}</small></th>
              <td v-for="r in n.radios" :key="r.radio_id" class="num" :class="{ warn: row.warn?.(r) }">{{ row.value(r) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <details v-if="hasComparison" class="help-details">
      <summary>How to read this</summary>
      <p>Antennas are compared only with others on the same network (same frequency). A packet counts once per network; "only this antenna" packets are what that antenna adds.</p>
      <p>The signal difference uses only packets both antennas heard, so it reflects the antennas and their cabling rather than which packets each catches. A noisy channel (higher noise floor) makes a radio wait more often before sending.</p>
      <p>Radios that are no longer configured, such as names used before a rename, are left out.</p>
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
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.help-details { color: var(--color-text-muted); font-size: .78rem; }
.help-details summary { cursor: pointer; color: var(--color-text-secondary); }
.help-details p { margin-top: .5rem; line-height: 1.6; }
button:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
</style>
