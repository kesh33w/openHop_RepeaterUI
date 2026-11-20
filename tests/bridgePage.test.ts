import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import BridgeView from '../src/views/Bridge.vue';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/utils/api', () => ({ default: api }));
vi.mock('@/composables/useMultiRadioConfig', () => ({
  useMultiRadioConfig: () => ({ radioLabel: (id: string) => id.toUpperCase() }),
}));

const now = Math.floor(Date.now() / 1000 / 3600) * 3600;
const stats = (over = {}) => ({
  success: true,
  data: {
    configured: true,
    hours: 24,
    node_code: 'bd6e',
    bucket_seconds: 3600,
    networks: [
      { network: 'smf909', tx_radio: 'g3909', radios: ['g3909', 'rak909'], heard: 200, repeated_local: 30, bridged_out: 10, not_sent: 160, originated: 5, reasons: [{ reason: 'Channel bridge echo', count: 150 }] },
      { network: 'bay910', tx_radio: 'g3910', radios: ['g3910', 'rak910'], heard: 100, repeated_local: 70, bridged_out: 25, not_sent: 5, originated: 1, reasons: [] },
    ],
    directions: [
      { from: 'smf909', to: 'bay910', packets: 10, buckets: [{ timestamp: now, count: 10 }] },
      { from: 'bay910', to: 'smf909', packets: 25, buckets: [{ timestamp: now - 3600, count: 25 }] },
    ],
    local: [],
    radio_pairs: [
      { rx_radio: 'rak910', tx_radio: 'rak909', rx_network: 'bay910', tx_network: 'smf909', bridged: true, sent: 25, failed: 0, antenna_code: '9c5b', antenna_codes: [{ code: '9c5b', sends: 20 }, { code: 'bd6e', sends: 5 }] },
      { rx_radio: 'g3910', tx_radio: 'rak910', rx_network: 'bay910', tx_network: 'bay910', bridged: false, sent: 69, failed: 1, antenna_code: 'bd6e', antenna_codes: [{ code: 'bd6e', sends: 69 }] },
      { rx_radio: null, tx_radio: 'g3909', rx_network: null, tx_network: 'smf909', bridged: false, sent: 5, failed: 0, antenna_code: null, antenna_codes: [] },
    ],
    unattributed: { packets: 0, transmissions: 0 },
    ...over,
  },
});

beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(stats()); });

it('shows bridged packets per direction with share of what was heard', async () => {
  const wrapper = mount(BridgeView); await flushPromises();
  expect(api.get).toHaveBeenCalledWith('/bridge_stats', { hours: 24 });
  const toBay = wrapper.get('[data-testid=direction-smf909-bay910]').text();
  expect(toBay).toContain('10');
  expect(toBay).toContain('5% of what smf909 heard');
  expect(wrapper.get('[data-testid=direction-bay910-smf909]').text()).toContain('25% of what bay910 heard');
  expect(wrapper.get('[data-testid=bridged-total]').text()).toBe('35');
  expect(wrapper.findAll('svg.timeline rect')).toHaveLength(2);
});

it('labels networks, reasons and antenna pairs in plain words', async () => {
  const wrapper = mount(BridgeView); await flushPromises();
  const smf = wrapper.get('[data-testid=network-smf909]').text();
  expect(smf).toContain('G3909 + RAK909');
  expect(smf).toContain('Our own bridged message heard back');
  const rows = wrapper.get('[data-testid=bridge-pairs]').findAll('tbody tr').map(r => r.text());
  expect(rows[0]).toContain('RAK910');
  expect(rows[0]).toContain('Bridged');
  expect(rows[0]).toContain('9C5B +1');
  expect(rows[1]).toContain('BD6E (own)');
  expect(rows[2]).toContain('Sent by this node');
});

it('reloads for a new window and explains unattributed history', async () => {
  const wrapper = mount(BridgeView); await flushPromises();
  api.get.mockResolvedValue(stats({ hours: 168, unattributed: { packets: 12, transmissions: 3 } }));
  await wrapper.get('[data-testid=bridge-window]').setValue('168'); await flushPromises();
  expect(api.get).toHaveBeenLastCalledWith('/bridge_stats', { hours: 168 });
  expect(wrapper.get('[data-testid=bridge-unattributed]').text()).toContain('12 packets and 3 transmissions');
});

it('says so when no bridge is configured, and shows errors', async () => {
  api.get.mockResolvedValue(stats({ configured: false, networks: [], directions: [], radio_pairs: [] }));
  const wrapper = mount(BridgeView); await flushPromises();
  expect(wrapper.find('[data-testid=bridge-unconfigured]').exists()).toBe(true);

  api.get.mockRejectedValue(new Error('down'));
  await wrapper.findAll('button').find(b => b.text() === 'Refresh')!.trigger('click'); await flushPromises();
  expect(wrapper.get('[role=alert]').text()).toContain('unavailable');
});

it('reports an unreadable history as an error, not as no traffic', async () => {
  api.get.mockResolvedValue({ success: false, error: 'Bridge statistics are unavailable' });
  const wrapper = mount(BridgeView); await flushPromises();
  expect(wrapper.get('[role=alert]').text()).toContain('unavailable');
  expect(wrapper.text()).not.toContain('No transmissions in this window');
});
