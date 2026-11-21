import { computed, ref } from 'vue'
import ApiService from '@/utils/api'
import type { BridgeDiagnostics } from '@/generated/openapi'

type Alias = NonNullable<NonNullable<BridgeDiagnostics['antenna_identities']>['aliases']>[number]

export type RetiredCode = { tx: string; code: string; crossing: boolean; reason: string }

/** Antenna identity codes from /bridge_diagnostics, with any retired one-byte codes. */
export function useAntennaCodes() {
  const aliases = ref<Alias[]>([])
  const enabled = ref(false)
  const loaded = ref(false)

  async function refresh() {
    try {
      const response = await ApiService.get<BridgeDiagnostics>('/bridge_diagnostics')
      const ids = response.success ? response.data?.antenna_identities : undefined
      aliases.value = ids?.aliases ?? []
      enabled.value = !!ids?.enabled
      loaded.value = true
    } catch {
      // Leave the last known codes; the pages that use this show their own errors.
    }
  }

  const retired = computed<RetiredCode[]>(() =>
    aliases.value.flatMap(a =>
      (a.retired ?? []).map(code => ({
        tx: a.tx ?? '',
        code,
        crossing: code === a.crossing_prefix,
        reason: a.retired_reasons?.[code] ?? 'a nearby relay uses the same byte',
      })),
    ),
  )

  /** Codes each transmitting radio uses, for display: [{ code, width, retired }]. */
  const codesByRadio = computed(() => {
    const out = new Map<string, { code: string; crossing: string | null; width: number; retired: string[] }[]>()
    for (const a of aliases.value) {
      if (!a.tx || a.rx) continue // pair aliases (rx_tx mode) are listed in Crossing diagnostics
      const list = out.get(a.tx) ?? []
      list.push({ code: a.prefix ?? '', crossing: a.crossing_prefix ?? null, width: a.width ?? 2, retired: a.retired ?? [] })
      out.set(a.tx, list.sort((x, y) => y.width - x.width))
    }
    return out
  })

  return { aliases, enabled, loaded, retired, codesByRadio, refresh }
}
