import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import NavItem from '@/components/nav/NavItem.vue'
import type { NavItemConfig } from '@/config/navigation'
import { navigationItems } from '@/config/navigation'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/utils/api', () => ({ default: api }))
vi.mock('@/composables/useMultiRadioConfig', () => ({
  useMultiRadioConfig: () => ({ radioLabel: (id: string) => id.toUpperCase() }),
}))

function makeRouter(path = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/antennas', '/bridge', '/configuration'].map(p => ({ path: p, component: { template: '<div/>' } })),
  })
  void router.push(path)
  return router
}

const antennas: NavItemConfig = { id: 'antennas-test', label: 'Antennas', route: '/antennas', hydrahop: true, newIn: '1.5' }

beforeEach(() => { localStorage.clear() })

it('marks HydraHop pages with a badge and fork features in the menu', () => {
  const flat = (items: NavItemConfig[]): NavItemConfig[] => items.flatMap(i => [i, ...flat(i.children ?? [])])
  const marked = flat(navigationItems).filter(i => i.hydrahop).map(i => i.id)
  expect(marked).toEqual(expect.arrayContaining(['bridge', 'antennas', 'config-bridge', 'config-radio-names']))
})

it('shows a new dot until the page is opened, then remembers it', async () => {
  const router = makeRouter('/')
  await router.isReady()
  const wrapper = mount(NavItem, { props: { item: antennas }, global: { plugins: [router] } })
  expect(wrapper.find('.fork-badge').attributes('title')).toBe('HydraHop feature')
  expect(wrapper.find('.new-dot').exists()).toBe(true)
  await router.push('/antennas'); await flushPromises()
  expect(wrapper.find('.new-dot').exists()).toBe(false)
  const again = mount(NavItem, { props: { item: antennas }, global: { plugins: [makeRouter('/')] } })
  expect(again.find('.new-dot').exists()).toBe(false)
})

const ok = (data: unknown) => ({ success: true, data })
function mockApi(retired = true) {
  api.get.mockImplementation((path: string) => {
    if (path === '/bridge_stats') return Promise.resolve(ok({
      configured: true, hours: 24, bucket_seconds: 3600, directions: [], local: [], radio_pairs: [], unattributed: { packets: 0, transmissions: 0 },
      networks: [{ network: 'bay910', tx_radio: 'g3910', radios: ['g3910', 'rak910'], heard: 900, repeated_local: 400, bridged_out: 120, not_sent: 0, originated: 0, reasons: [] }],
    }))
    if (path === '/relay_stats') return Promise.resolve(ok({
      hours: 24, configured: true, networks: [{ network: 'bay910', double_sent: 60, tagged: 50, untagged: 10, relayed: 40, neighbours: [],
        radios: [
          { radio_id: 'g3910', code: '44', sent_first: 25, relayed: 20, relayed_when_first: 20, relayed_when_second: 0 },
          { radio_id: 'rak910', code: '49', sent_first: 25, relayed: 12, relayed_when_first: 12, relayed_when_second: 0 },
        ] }],
    }))
    if (path === '/internet_link') return Promise.resolve(ok({ enabled: true, running: true, peers: [{ id: 'a', connected: true }, { id: 'b', connected: false }] }))
    if (path === '/bridge_diagnostics') return Promise.resolve(ok({ antenna_identities: { enabled: true, mode: 'tx', aliases: [
      { prefix: '273e', crossing_prefix: '0629', rx: null, tx: 'g3910' },
      { prefix: '44', crossing_prefix: '37', rx: null, tx: 'g3910', width: 1,
        retired: retired ? ['44'] : [], retired_reasons: retired ? { '44': 'relay Hilltop advertises 44aa0000 1 hop(s) away' } : {} },
    ] } }))
    return Promise.resolve(ok({}))
  })
}

it('dashboard card summarises each network and warns about retired codes', async () => {
  mockApi()
  const { default: Card } = await import('@/components/hydrahop/HydraHopStatusCard.vue')
  const router = makeRouter('/'); await router.isReady()
  const wrapper = mount(Card, { global: { plugins: [router] } }); await flushPromises()
  const net = wrapper.get('[data-testid=hh-net-bay910]').text()
  expect(net).toContain('120 bridged out')
  expect(net).toContain('G3910 80% · RAK910 48%')
  expect(net).toContain('G3910 leads')
  expect(wrapper.find('code.retired').text()).toBe('44')
  const notice = wrapper.get('[data-testid=retired-codes-notice]').text()
  expect(notice).toContain('G3910 stopped using 44: relay Hilltop')
  expect(notice).toContain('relay Hilltop advertises 44aa0000 1 hop(s) away')
  expect(wrapper.text()).toContain('1 of 2 peers connected')
})

it('dashboard card shows no warning while every code is in use', async () => {
  mockApi(false)
  const { default: Card } = await import('@/components/hydrahop/HydraHopStatusCard.vue')
  const router = makeRouter('/'); await router.isReady()
  const wrapper = mount(Card, { global: { plugins: [router] } }); await flushPromises()
  expect(wrapper.find('[data-testid=retired-codes-notice]').exists()).toBe(false)
  expect(wrapper.find('code.retired').exists()).toBe(false)
})
