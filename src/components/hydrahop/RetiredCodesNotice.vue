<script setup lang="ts">
import type { RetiredCode } from './useAntennaCodes'
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig'

defineProps<{ retired: RetiredCode[] }>()
const { radioLabel } = useMultiRadioConfig()
</script>

<template>
  <div v-if="retired.length" class="retired-notice" role="alert" data-testid="retired-codes-notice">
    <p class="title">
      {{ retired.length === 1 ? 'A one-byte antenna code was retired' : `${retired.length} one-byte antenna codes were retired` }}
    </p>
    <ul>
      <li v-for="r in retired" :key="`${r.tx}-${r.code}`">
        <strong>{{ radioLabel(r.tx) }}</strong> stopped using <code>{{ r.code.toUpperCase() }}</code><template v-if="r.crossing"> (bridged packets)</template>: {{ r.reason }}.
      </li>
    </ul>
    <p class="hint">
      Its 1-byte sends now go out untagged, so they cannot be told apart in relay statistics.
      Pick a free byte for <code>tx_identity_experiment.one_byte</code> and restart to tag them again.
      <router-link :to="{ path: '/configuration', query: { tab: 'bridge' } }">Crossing diagnostics</router-link>
    </p>
  </div>
</template>

<style scoped>
.retired-notice {
  padding: 0.75rem 0.9rem;
  border-radius: 0.5rem;
  border-left: 3px solid var(--color-accent-red);
  background: var(--color-badge-red-bg);
  color: var(--color-text-primary);
  font-size: 0.82rem;
}
.title { font-weight: 650; color: var(--color-badge-red-text); margin-bottom: 0.3rem; }
ul { margin: 0 0 0.35rem; padding-left: 1.1rem; list-style: disc; line-height: 1.55; }
.hint { color: var(--color-text-secondary); font-size: 0.78rem; }
.hint a { color: var(--color-primary); text-decoration: underline; margin-left: 0.25rem; }
code { font-size: 0.78rem; }
</style>
