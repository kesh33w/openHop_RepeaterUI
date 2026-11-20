<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ApiService from '@/utils/api';
import type { BridgeStats } from '@/generated/openapi';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';

defineOptions({ name: 'BridgeView' });

const { radioLabel } = useMultiRadioConfig();

const WINDOWS = [
  { hours: 1, label: 'Last hour' },
  { hours: 6, label: 'Last 6 hours' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 168, label: 'Last 7 days' },
];
const REFRESH_MS = 60_000;

// Drop reasons are recorded verbatim by the repeater; these read better on a page.
const REASONS: Record<string, string> = {
  'Channel bridge echo': 'Our own bridged message heard back',
  'Channel bridge has no allowed destination': 'No network allowed to receive it',
  'Marked do not retransmit': 'Marked do not retransmit',
  'Direct: no path': 'Direct packet with no path left',
  'FLOOD loop detected (minimal)': 'Already passed through this node',
  'No unclaimed forwarding destination': 'No unclaimed forwarding destination',
  'Transport code not allowed to flood': 'Region code not allowed to flood',
  'Not recorded': 'Reason not recorded',
};

const hours = ref(24);
const stats = ref<BridgeStats | null>(null);
const loading = ref(false);
const error = ref('');
const updatedAt = ref<Date | null>(null);
let generation = 0;

async function refresh() {
  const mine = ++generation;
  loading.value = true;
  try {
    const response = await ApiService.get<BridgeStats>('/bridge_stats', { hours: hours.value });
    if (mine !== generation) return;
    if (!response.success || !response.data) throw new Error(response.error || 'unavailable');
    stats.value = response.data;
    updatedAt.value = new Date();
    error.value = '';
  } catch {
    if (mine === generation) error.value = 'Bridge statistics are unavailable right now. Shown values may be out of date.';
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

const networks = computed(() => stats.value?.networks ?? []);
const networkByName = computed(() => new Map(networks.value.map(n => [n.network, n])));
function networkRadios(name: string | null | undefined) {
  const net = name ? networkByName.value.get(name) : undefined;
  return net ? net.radios.map(radioLabel).join(' + ') : '';
}
function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}
const fmt = (n: number) => n.toLocaleString();

const directions = computed(() => (stats.value?.directions ?? []).map(d => {
  const source = networkByName.value.get(d.from ?? '');
  return { ...d, share: pct(d.packets, source?.heard ?? 0) };
}));
const totalBridged = computed(() => directions.value.reduce((t, d) => t + d.packets, 0));

// Fixed bucket grid across the whole window so quiet periods show as gaps.
const chart = computed(() => {
  const s = stats.value;
  if (!s || !s.directions.length) return null;
  const step = s.bucket_seconds;
  const end = Math.floor(Date.now() / 1000 / step) * step;
  const count = Math.max(1, Math.round((s.hours * 3600) / step));
  const start = end - (count - 1) * step;
  const series = s.directions.map(d => new Map(d.buckets.map(b => [b.timestamp, b.count])));
  const bars = Array.from({ length: count }, (_, i) => {
    const ts = start + i * step;
    return { ts, values: series.map(m => m.get(ts) ?? 0) };
  });
  const max = Math.max(1, ...bars.map(b => b.values.reduce((a, v) => a + v, 0)));
  const width = 100 / count;
  return {
    max,
    bars: bars.map((b, i) => {
      let y = 100;
      return {
        ts: b.ts,
        title: `${new Date(b.ts * 1000).toLocaleString()}: ` + s.directions.map((d, k) => `${d.from} → ${d.to} ${b.values[k]}`).join(', '),
        segments: b.values.map((v, k) => {
          const h = (v / max) * 100;
          y -= h;
          return { x: i * width + width * 0.1, y, w: width * 0.8, h, k };
        }).filter(seg => seg.h > 0),
      };
    }),
    startLabel: new Date(start * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
});

const pairs = computed(() => stats.value?.radio_pairs ?? []);
const unattributed = computed(() => stats.value?.unattributed ?? { packets: 0, transmissions: 0 });
function pairKind(p: BridgeStats['radio_pairs'][number]) {
  if (p.rx_radio === null) return 'Sent by this node';
  return p.bridged ? 'Bridged' : 'Local';
}
</script>

<template>
  <section class="bridge-page space-y-5" data-testid="bridge-page">
    <header class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-content-primary">Bridge</h2>
        <p class="text-sm text-content-secondary mt-1">
          Traffic between your two networks, from this repeater's own packet history.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label for="bridge-window" class="text-sm text-content-secondary">Window</label>
        <select id="bridge-window" v-model.number="hours" class="modal-select w-auto" data-testid="bridge-window">
          <option v-for="w in WINDOWS" :key="w.hours" :value="w.hours">{{ w.label }}</option>
        </select>
        <button type="button" class="modal-btn-cancel !py-2 !px-3 !text-sm" :disabled="loading" @click="refresh">
          {{ loading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
    </header>

    <p v-if="error" role="alert" class="notice failed-notice">{{ error }}</p>
    <p class="muted" role="status">
      <template v-if="loading && !stats">Loading bridge statistics…</template>
      <template v-else-if="updatedAt">Updated {{ updatedAt.toLocaleTimeString() }} · refreshes every minute.</template>
    </p>

    <p v-if="stats && !stats.configured" class="notice" data-testid="bridge-unconfigured">
      This repeater has no two-network bridge configured, so there is no bridge traffic to show.
    </p>

    <template v-else-if="stats">
      <div class="stats-grid">
        <div v-for="d in directions" :key="`${d.from}-${d.to}`" class="stat" :data-testid="`direction-${d.from}-${d.to}`">
          <span>{{ d.from }} → {{ d.to }}</span>
          <strong>{{ fmt(d.packets) }}</strong>
          <small>packets bridged · {{ d.share }} of what {{ d.from }} heard</small>
        </div>
        <div class="stat">
          <span>Bridged in total</span>
          <strong data-testid="bridged-total">{{ fmt(totalBridged) }}</strong>
          <small>packets sent on the other network</small>
        </div>
      </div>

      <section class="panel" aria-labelledby="bridge-timeline-title">
        <div class="panel-heading">
          <h3 id="bridge-timeline-title">Bridged packets over time</h3>
          <ul class="legend">
            <li v-for="(d, k) in directions" :key="k"><span :class="`swatch s${k}`"></span>{{ d.from }} → {{ d.to }}</li>
          </ul>
        </div>
        <p v-if="!totalBridged" class="empty">No packets were bridged in this window.</p>
        <template v-else-if="chart">
          <svg class="timeline" viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
               :aria-label="`Bridged packets per ${stats.bucket_seconds / 60} minutes; busiest interval ${chart.max} packets`">
            <g v-for="bar in chart.bars" :key="bar.ts">
              <title>{{ bar.title }}</title>
              <rect v-for="seg in bar.segments" :key="seg.k" :class="`s${seg.k}`" :x="seg.x" :y="seg.y" :width="seg.w" :height="seg.h" />
            </g>
          </svg>
          <div class="axis muted"><span>{{ chart.startLabel }}</span><span>peak {{ chart.max }} per {{ stats.bucket_seconds >= 3600 ? 'hour' : `${stats.bucket_seconds / 60} min` }}</span><span>now</span></div>
        </template>
      </section>

      <div class="networks-grid">
        <section v-for="n in networks" :key="n.network" class="panel" :data-testid="`network-${n.network}`">
          <div class="panel-heading">
            <h3>{{ n.network }}</h3>
            <span class="badge">{{ networkRadios(n.network) }}</span>
          </div>
          <dl class="figures">
            <div><dt>Heard</dt><dd>{{ fmt(n.heard) }}</dd></div>
            <div><dt>Repeated on {{ n.network }}</dt><dd>{{ fmt(n.repeated_local) }}</dd></div>
            <div><dt>Bridged across</dt><dd>{{ fmt(n.bridged_out) }}</dd></div>
            <div><dt>Not sent on</dt><dd>{{ fmt(n.not_sent) }}</dd></div>
            <div><dt>Sent by this node</dt><dd>{{ fmt(n.originated) }}</dd></div>
          </dl>
          <template v-if="n.reasons.length">
            <h4>Why heard packets were not sent</h4>
            <ul class="reasons">
              <li v-for="r in n.reasons" :key="r.reason" :title="r.reason">
                <span>{{ REASONS[r.reason] ?? r.reason }}</span><span>{{ fmt(r.count) }}</span>
              </li>
            </ul>
          </template>
        </section>
      </div>

      <section class="panel" aria-labelledby="bridge-pairs-title">
        <div class="panel-heading">
          <h3 id="bridge-pairs-title">Antenna pairs</h3>
          <span class="badge">transmissions</span>
        </div>
        <p class="muted">Which antenna heard each packet and which antenna sent it. A packet sent by a two-antenna group counts once per antenna. The code is what other nodes see as this repeater's hop when antenna identities are on.</p>
        <p v-if="!pairs.length" class="empty">No transmissions in this window.</p>
        <div v-else class="table-wrap">
          <table data-testid="bridge-pairs">
            <thead><tr><th scope="col">Heard on</th><th scope="col">Sent on</th><th scope="col">Type</th><th scope="col">Code</th><th scope="col" class="num">Sent</th><th scope="col" class="num">Failed</th></tr></thead>
            <tbody>
              <tr v-for="p in pairs" :key="`${p.rx_radio}-${p.tx_radio}`" :class="{ bridged: p.bridged }">
                <td>{{ p.rx_radio === null ? '—' : radioLabel(p.rx_radio) }}</td>
                <td>{{ radioLabel(p.tx_radio) }}</td>
                <td><span class="badge" :class="{ confirmed: p.bridged }">{{ pairKind(p) }}</span></td>
                <td class="mono">{{ p.antenna_code ?? '—' }}</td>
                <td class="num">{{ fmt(p.sent) }}</td>
                <td class="num" :class="{ warn: p.failed > 0 }">{{ fmt(p.failed) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <details class="help-details">
        <summary>How these numbers are counted</summary>
        <p>Network figures count each packet once. A packet heard on one network and sent on the other is bridged; one sent on both counts as both repeated and bridged. Duplicates heard by a second antenna are not counted as heard.</p>
        <p>Antenna pairs count transmissions, so a packet sent by both antennas of a group appears twice. A failed send means the radio reported it could not transmit.</p>
        <p v-if="unattributed.packets || unattributed.transmissions" data-testid="bridge-unattributed">
          {{ fmt(unattributed.packets) }} packets and {{ fmt(unattributed.transmissions) }} transmissions from radios that are no longer configured (for example, under a name used before a rename) are left out.
        </p>
      </details>
    </template>
  </section>
</template>

<style scoped>
.bridge-page { color: var(--color-text-secondary); }
h3 { color: var(--color-heading); font-size: 1rem; font-weight: 650; }
h4 { color: var(--color-heading); font-size: .8rem; font-weight: 650; margin: 1rem 0 .4rem; }
.muted { color: var(--color-text-muted); font-size: .8rem; }
.empty { color: var(--color-text-muted); font-size: .85rem; padding: 1rem 0; }
.notice { padding: .7rem .85rem; border-radius: .4rem; background: var(--color-background-soft); font-size: .8rem; border-left: 2px solid var(--color-border-hover); }
.failed-notice { color: var(--color-badge-red-text); background: var(--color-badge-red-bg); border-color: var(--color-accent-red); }
.stats-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
.stat { display: flex; flex-direction: column; border: 1px solid var(--color-border-subtle); border-radius: .75rem; padding: 1rem; background: var(--color-surface-elevated); min-width: 0; }
.stat > span { font-size: .75rem; font-weight: 600; }
.stat > strong { color: var(--color-text-primary); font-size: 1.8rem; font-variant-numeric: tabular-nums; margin: .3rem 0; line-height: 1.3; }
.stat small { color: var(--color-text-muted); font-size: .72rem; }
.panel { border: 1px solid var(--color-border-subtle); border-radius: .75rem; padding: 1.1rem; background: var(--color-surface); min-width: 0; }
.panel-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: .5rem; margin-bottom: .8rem; }
.badge { display: inline-block; background: var(--color-badge-neutral-bg); color: var(--color-badge-neutral-text); padding: .2rem .5rem; border-radius: .35rem; font-size: .68rem; font-weight: 600; }
.confirmed { background: var(--color-badge-cyan-bg); color: var(--color-badge-cyan-text); }
.legend { display: flex; gap: 1rem; list-style: none; padding: 0; margin: 0; font-size: .75rem; }
.legend li { display: flex; align-items: center; gap: .35rem; }
.swatch { width: .7rem; height: .7rem; border-radius: .15rem; display: inline-block; }
.s0 { fill: var(--color-accent-cyan); background: var(--color-accent-cyan); }
.s1 { fill: var(--color-secondary); background: var(--color-secondary); }
.timeline { width: 100%; height: 160px; display: block; background: var(--color-background-soft); border-radius: .4rem; }
.axis { display: flex; justify-content: space-between; margin-top: .35rem; font-size: .7rem; }
.networks-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); gap: .6rem; margin: 0; }
.figures div { display: flex; flex-direction: column; }
.figures dt { font-size: .7rem; color: var(--color-text-muted); }
.figures dd { margin: 0; color: var(--color-text-primary); font-size: 1.15rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.reasons { list-style: none; padding: 0; margin: 0; font-size: .78rem; }
.reasons li { display: flex; justify-content: space-between; gap: 1rem; padding: .3rem 0; border-top: 1px solid var(--color-border-subtle); }
.reasons li span:last-child { font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .8rem; }
th { text-align: left; font-size: .7rem; font-weight: 600; color: var(--color-text-muted); padding: .4rem .5rem; border-bottom: 1px solid var(--color-border); }
td { padding: .45rem .5rem; border-bottom: 1px solid var(--color-border-subtle); white-space: nowrap; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.mono { font-family: monospace; }
.warn { color: var(--color-badge-amber-text); font-weight: 600; }
.help-details { color: var(--color-text-muted); font-size: .78rem; }
.help-details summary { cursor: pointer; color: var(--color-text-secondary); }
.help-details p { margin-top: .5rem; line-height: 1.6; }
button:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
@media (max-width: 900px) {
  .stats-grid, .networks-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
