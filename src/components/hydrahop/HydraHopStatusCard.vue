<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ApiService from '@/utils/api'
import type { BridgeStats, InternetLinkState, RelayNetworkStats, RelayStats } from '@/generated/openapi'
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig'
import { useAntennaCodes } from './useAntennaCodes'
import RetiredCodesNotice from './RetiredCodesNotice.vue'

defineOptions({ name: 'HydraHopStatusCard' })

const { radioLabel } = useMultiRadioConfig()
const codes = useAntennaCodes()

const REFRESH_MS = 60_000
// Below this many tagged double sends, a "leader" is mostly noise.
const MIN_TAGGED = 30

const bridge = ref<BridgeStats | null>(null)
const relays = ref<RelayStats | null>(null)
const link = ref<InternetLinkState | null>(null)
const failed = ref(false)

async function refresh() {
  const [b, r, l] = await Promise.all([
    ApiService.get<BridgeStats>('/bridge_stats', { hours: 24 }).catch(() => null),
    ApiService.get<RelayStats>('/relay_stats', { hours: 24 }).catch(() => null),
    ApiService.get<InternetLinkState>('/internet_link').catch(() => null),
    codes.refresh(),
  ])
  if (b?.success && b.data) bridge.value = b.data
  if (r?.success && r.data) relays.value = r.data
  if (l?.success && l.data) link.value = l.data
  failed.value = !b?.success
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refresh()
  timer = setInterval(() => { if (!document.hidden) void refresh() }, REFRESH_MS)
})
onUnmounted(() => { if (timer) clearInterval(timer) })

const fmt = (n: number) => n.toLocaleString()
const configured = computed(() => !!bridge.value?.configured)
const relayByNetwork = computed(() => new Map((relays.value?.networks ?? []).map(n => [n.network, n])))

/** Share of first sends a neighbour relayed, per radio, and which radio leads. */
function relaySummary(n: RelayNetworkStats | undefined) {
  if (!n || n.tagged === 0) return { text: 'No tagged double sends yet', leader: null as string | null }
  const rates = n.radios
    .filter(r => r.sent_first > 0)
    .map(r => ({ id: r.radio_id, rate: Math.round((r.relayed_when_first / r.sent_first) * 100) }))
  const text = rates.map(r => `${radioLabel(r.id)} ${r.rate}%`).join(' · ')
  if (n.tagged < MIN_TAGGED || rates.length < 2) return { text: `${text} (collecting: ${n.tagged} tagged)`, leader: null }
  const [a, b] = [...rates].sort((x, y) => y.rate - x.rate)
  return { text, leader: a!.rate - b!.rate >= 5 ? a!.id : null }
}

const networks = computed(() =>
  (bridge.value?.networks ?? []).map(n => {
    const relay = relayByNetwork.value.get(n.network)
    return {
      name: n.network,
      bridgedOut: n.bridged_out,
      repeated: n.repeated_local,
      radios: n.radios.map(id => ({ id, codes: codes.codesByRadio.value.get(id) ?? [] })),
      relay: relaySummary(relay),
    }
  }),
)

const linkSummary = computed(() => {
  const l = link.value
  if (!l || !l.enabled) return null
  const peers = l.peers ?? []
  const up = peers.filter(p => p.connected).length
  return { running: !!l.running, text: peers.length ? `${up} of ${peers.length} peers connected` : 'No peers enrolled' }
})
</script>

<template>
  <section v-if="configured" class="hh-card mb-4" aria-labelledby="hh-status-title" data-testid="hydrahop-status">
    <header class="hh-header">
      <h3 id="hh-status-title">HydraHop <span class="hh-badge">HH</span></h3>
      <span class="muted">Last 24 hours · refreshes every minute</span>
    </header>

    <RetiredCodesNotice :retired="codes.retired.value" class="mb-3" />
    <p v-if="failed" class="muted mb-2">Bridge statistics are unavailable right now; values may be out of date.</p>

    <div class="hh-grid">
      <router-link v-for="n in networks" :key="n.name" to="/bridge" class="hh-net" :data-testid="`hh-net-${n.name}`">
        <div class="hh-net-head">
          <strong>{{ n.name }}</strong>
          <span class="muted">{{ fmt(n.bridgedOut) }} bridged out · {{ fmt(n.repeated) }} repeated</span>
        </div>
        <ul class="hh-radios">
          <li v-for="r in n.radios" :key="r.id">
            <span :class="{ leader: n.relay.leader === r.id }">{{ radioLabel(r.id) }}</span>
            <span class="codes">
              <code
                v-for="c in r.codes"
                :key="c.code"
                :class="{ retired: c.retired.includes(c.code) }"
                :title="c.width === 1 ? '1-byte code' : '2- and 3-byte code'"
              >{{ c.code.toUpperCase() }}</code>
            </span>
          </li>
        </ul>
        <p class="hh-relay">
          <span class="label">Relayed when sent first</span>
          {{ n.relay.text }}<template v-if="n.relay.leader"> · <strong>{{ radioLabel(n.relay.leader) }} leads</strong></template>
        </p>
      </router-link>

      <router-link v-if="linkSummary" :to="{ path: '/configuration', query: { tab: 'bridge' } }" class="hh-net">
        <div class="hh-net-head">
          <strong>Internet Link</strong>
          <span class="muted">{{ linkSummary.running ? 'Running' : 'Not running' }}</span>
        </div>
        <p class="hh-relay">{{ linkSummary.text }}</p>
      </router-link>
    </div>
    <p class="muted mt-2">
      Details: <router-link to="/antennas">Antennas</router-link> ·
      <router-link to="/bridge">Bridge</router-link> ·
      <router-link :to="{ path: '/configuration', query: { tab: 'bridge' } }">Bridge settings</router-link>
    </p>
  </section>
</template>

<style scoped>
.hh-card { border: 1px solid var(--color-border-subtle); border-radius: 0.9rem; padding: 1rem 1.1rem; background: var(--color-surface); }
.hh-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.4rem; margin-bottom: 0.75rem; }
.hh-header h3 { color: var(--color-heading); font-size: 1rem; font-weight: 650; display: flex; align-items: center; gap: 0.4rem; }
.hh-badge { font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em; padding: 0.18rem 0.3rem; border-radius: 0.3rem; color: var(--color-accent-cyan); border: 1px solid currentColor; }
.muted { color: var(--color-text-muted); font-size: 0.78rem; }
.muted a { color: var(--color-primary); }
.hh-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 0.75rem; }
.hh-net { display: block; border: 1px solid var(--color-border-subtle); border-radius: 0.6rem; padding: 0.7rem 0.8rem; background: var(--color-background-soft); color: var(--color-text-primary); transition: border-color 150ms; }
.hh-net:hover { border-color: var(--color-border-hover); }
.hh-net-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.3rem; margin-bottom: 0.45rem; font-size: 0.85rem; }
.hh-radios { list-style: none; padding: 0; margin: 0 0 0.45rem; font-size: 0.82rem; }
.hh-radios li { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.15rem 0; }
.leader { font-weight: 650; color: var(--color-accent-green); }
.codes { display: flex; gap: 0.3rem; }
.codes code { font-size: 0.74rem; padding: 0.05rem 0.3rem; border-radius: 0.25rem; background: var(--color-badge-neutral-bg); color: var(--color-badge-neutral-text); }
.codes code.retired { background: var(--color-badge-red-bg); color: var(--color-badge-red-text); text-decoration: line-through; }
.hh-relay { font-size: 0.78rem; color: var(--color-text-secondary); }
.hh-relay .label { display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-muted); }
</style>
