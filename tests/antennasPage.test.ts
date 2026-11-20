import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import AntennasView from '../src/views/Antennas.vue';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/utils/api', () => ({ default: api }));
vi.mock('@/composables/useMultiRadioConfig', () => ({
  useMultiRadioConfig: () => ({ radioLabel: (id: string) => id.toUpperCase() }),
}));

const radio = (radio_id: string, network: string, over = {}) => ({
  radio_id, network, role: radio_id.startsWith('rak') ? 'receiver' : 'transceiver',
  recorded: true, transmits: 'all', has_data: true, bridge_echoes: 0,
  received: 100, duplicates: 10, rssi_avg: -90, snr_avg: 2, unique_packets: 0,
  noise: { avg: -100, p10: -105, p90: -95, samples: 50 }, crc_errors: 24, crc_errors_per_hour: 1,
  upstream_repeaters: 10, unique_upstream_repeaters: 1, sends: 100, send_failures: 0,
  busy_holds: 10, backoff_avg_ms: 50, ...over,
});
const stats = (over = {}) => ({
  success: true,
  data: {
    hours: 24,
    match_window_seconds: 1,
    topology_source: 'running',
    radios: [
      radio('g3909', 'smf909', { unique_packets: 110 }),
      radio('rak909', 'smf909', { unique_packets: 1463, busy_holds: 60, send_failures: 2, transmits: 'crossings', bridge_echoes: 1964 }),
      radio('solo', 'other'),
    ],
    networks: [
      { network: 'smf909', radios: ['g3909', 'rak909'], packets: 3283,
        heard_by: [{ radios: ['g3909', 'rak909'], packets: 1710 }, { radios: ['rak909'], packets: 1463 }, { radios: ['g3909'], packets: 110 }],
        signal_gaps: [{ a: 'g3909', b: 'rak909', frames: 2010, rssi_db: -20.6, snr_db: -1.9 }] },
      { network: 'other', radios: ['solo'], packets: 5, heard_by: [], signal_gaps: [] },
    ],
    ...over,
  },
});

beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(stats()); });

it('compares antennas on a shared network in plain words', async () => {
  const wrapper = mount(AntennasView); await flushPromises();
  expect(api.get).toHaveBeenCalledWith('/antenna_stats', { hours: 24 });
  expect(wrapper.find('[data-testid=antenna-network-other]').exists()).toBe(false);
  const net = wrapper.get('[data-testid=antenna-network-smf909]');
  expect(net.text()).toContain('All antennas 1,710');
  expect(net.text()).toContain('Only RAK909 1,463');
  const findings = net.get('[data-testid=antenna-findings]').text();
  expect(findings).toContain('RAK909 caught 1,463 packets (45%) no other antenna here heard.');
  expect(findings).toContain('On 2,010 frames both heard from the same relay, RAK909 gets 1.9 dB better SNR than G3909.');
  expect(findings).toContain('RSSI differs by 20.6 dB');
  expect(net.text()).toContain('receives; sends bridged packets only');
  expect(net.text()).toContain('60 (60%)');
  expect(net.findAll('td.warn').map(td => td.text())).toEqual(['60 (60%)', '2']);
});

it('explains when there is nothing to compare, and reloads per window', async () => {
  api.get.mockResolvedValue(stats({ networks: [{ network: 'other', radios: ['solo'], packets: 5, heard_by: [], signal_gaps: [] }] }));
  const wrapper = mount(AntennasView); await flushPromises();
  expect(wrapper.find('[data-testid=antennas-single]').exists()).toBe(true);
  await wrapper.get('[data-testid=antenna-window]').setValue('168'); await flushPromises();
  expect(api.get).toHaveBeenLastCalledWith('/antenna_stats', { hours: 168 });
});

it('shows an error when statistics cannot be loaded', async () => {
  api.get.mockRejectedValue(new Error('down'));
  const wrapper = mount(AntennasView); await flushPromises();
  expect(wrapper.get('[role=alert]').text()).toContain('unavailable');
});

it('tells no data, not recorded and receive-only apart from zero', async () => {
  api.get.mockResolvedValue(stats({
    radios: [
      radio('g3910', 'bay910'),
      radio('rak910', 'bay910', { transmits: null, sends: 0, busy_holds: 0, backoff_avg_ms: null }),
      radio('v3910', 'bay910', { role: 'shadow', recorded: false, transmits: null, has_data: false, received: 0, sends: 0 }),
      radio('rak911', 'bay910', { has_data: false, received: 0 }),
    ],
    networks: [{ network: 'bay910', radios: ['g3910', 'rak910', 'v3910', 'rak911'], packets: 10,
      heard_by: [{ radios: ['g3910'], packets: 10 }],
      signal_gaps: [{ a: 'g3910', b: 'rak910', frames: 3, rssi_db: 1, snr_db: 1 }, { a: 'g3910', b: 'v3910', frames: 0, rssi_db: null, snr_db: null }] }],
  }));
  const wrapper = mount(AntennasView); await flushPromises();
  const net = wrapper.get('[data-testid=antenna-network-bay910]');
  expect(net.text()).toContain('receives only');
  expect(net.text()).toContain('shadow: compared live, not recorded');
  const missing = net.findAll('td.missing').map(td => td.text());
  expect(missing).toContain('Does not send');
  expect(missing).toContain('Not recorded');
  expect(missing).toContain('No data');
  const findings = net.get('[data-testid=antenna-findings]').text();
  expect(findings).toContain('V3910 is a shadow radio');
  expect(findings).toContain('No data was recorded for RAK911');
  expect(findings).toContain('too few of the same frames (3)');
  expect(findings).not.toContain('V3910 heard too few');
});
