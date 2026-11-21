import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import BridgeDiagnostics from '@/components/configuration/BridgeDiagnostics.vue';
import ApiService from '@/utils/api';
vi.mock('@/utils/api', () => ({default:{get:vi.fn(),post:vi.fn()}}));
beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks(); });
const status = {
  reception:{enabled:true, window_seconds:120, counts:{observed:1,unconfirmed:2}, feeds:[{broker:'outside',state:'connected',accepted:1,ignored:0,last_report_at:'2026-11-09T12:00:03Z'}],recent:[{id:'crossing',source_radio:'a',target_radio:'b',packet_type:2,tx_state:'tx_confirmed',reception_state:'observed',started_at:'2026-11-09T12:00:00Z',deadline:'2026-11-09T12:02:00Z',observers:[{public_key:'abc123',broker:'outside',radio_id:'b',observed_at:'2026-11-09T12:00:01Z',received_at:'2026-11-09T12:00:02Z',match:'outgoing_bytes'}]}]},
  traffic:{limits:{per_minute:12,burst:3,max_pending_per_direction:16},directions:[{source_radio:'a',target_radio:'b',pending:1,admitted:2,rate_limited:3,queue_full:4}]},
};
describe('bridge diagnostics', () => {
  it('separates local transmit from independent observation without claiming delivery', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:status});
    const wrapper = mount(BridgeDiagnostics); await flushPromises();
    expect(ApiService.get).toHaveBeenCalledWith('/bridge_diagnostics');
    expect(wrapper.text()).toContain('Encrypted text message');
    expect(wrapper.text()).toContain('Modem confirmed TX');
    expect(wrapper.text()).toContain('Independent observer heard it');
    expect(wrapper.text()).toContain('Neither proves delivery');
    expect(wrapper.text()).toContain('3 rate-limited');
    expect(wrapper.text()).not.toContain('abc123');
    await wrapper.get('.evidence-button').trigger('click');
    expect(wrapper.text()).toContain('abc123');
    expect(wrapper.text()).toContain(new Date('2026-11-09T12:00:01Z').toLocaleString());
    expect(wrapper.text()).not.toContain('Invalid Date');
    expect(wrapper.text()).toContain('Direct and TRACE traffic bypass that rate budget');
    expect(ApiService.post).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('retains values with an explicit stale warning after a failed refresh', async () => {
    vi.mocked(ApiService.get).mockResolvedValueOnce({success:true,data:status}).mockRejectedValue(new Error('offline'));
    const wrapper = mount(BridgeDiagnostics); await flushPromises();
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('out of date');
    expect(wrapper.text()).toContain('Modem confirmed TX');
    wrapper.unmount();
  });
  it('does not imply local receive is independent evidence when unconfigured', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{...status,reception:{enabled:false,window_seconds:120,counts:{},feeds:[],recent:[]}}});
    const wrapper = mount(BridgeDiagnostics); await flushPromises();
    expect(wrapper.text()).toContain('not configured');
    expect(wrapper.text()).toContain('No observation is inferred from local RX');
    wrapper.unmount();
  });
});

it('does not label fallback limits as running when the bridge is inactive', async () => {
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:status});
  const wrapper = mount(BridgeDiagnostics, {props:{running:false}}); await flushPromises();
  expect(wrapper.text()).toContain('The bridge is not running');
  expect(wrapper.text()).not.toContain('Running directional limits');
  wrapper.unmount();
});

it('lists antenna identity codes with receiving and sending radios', async () => {
  const antenna_identities = {enabled:true, mode:'rx_tx', aliases:[
    {prefix:'3f9a', crossing_prefix:'c41e', rx:'a', tx:'b'},
    {prefix:'2855', crossing_prefix:'e184', rx:null, tx:'a'},
  ]};
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{...status, antenna_identities}});
  const wrapper = mount(BridgeDiagnostics); await flushPromises();
  const rows = wrapper.findAll('.antenna-identities tbody tr').map(row => row.findAll('td').map(cell => cell.text()));
  expect(rows[0]![0]).toBe('3f9a');
  expect(rows[0]![1]).toBe('c41e');
  expect(rows[1]![2]).toBe('2- and 3-byte');
  expect(rows[1]![3]).toBe('Any');
  expect(rows[1]![5]).toBe('In use');
  expect(wrapper.text()).toContain('which antenna heard it and which sent it on');
  wrapper.unmount();
});

it('shows one-byte codes and why a retired one stopped being used', async () => {
  const antenna_identities = {enabled:true, mode:'tx', aliases:[
    {prefix:'d4', crossing_prefix:'14', rx:null, tx:'g3909', width:1, retired:['d4'], retired_reasons:{d4:'relay Hilltop advertises d4aa0000 1 hop(s) away'}},
  ]};
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{...status, antenna_identities}});
  const wrapper = mount(BridgeDiagnostics); await flushPromises();
  const row = wrapper.get('.antenna-identities tbody tr');
  expect(row.findAll('td')[2]!.text()).toBe('1-byte');
  expect(row.find('code.retired').text()).toBe('d4');
  expect(row.text()).toContain('Retired D4');
  expect(row.text()).toContain('relay Hilltop advertises d4aa0000 1 hop(s) away');
  wrapper.unmount();
});

it('hides the antenna identity table when no aliases exist', async () => {
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{...status, antenna_identities:{enabled:false,mode:'rx_tx',aliases:[]}}});
  const wrapper = mount(BridgeDiagnostics); await flushPromises();
  expect(wrapper.find('.antenna-identities').exists()).toBe(false);
  wrapper.unmount();
});

describe('crossing exploration', () => {
  const manyCrossings = () => ({
    ...status,
    reception: {
      ...status.reception,
      recent: Array.from({ length: 23 }, (_, index) => ({
        ...status.reception.recent[0]!,
        id: `crossing-${index}`,
        source_radio: index % 2 ? 'b' : 'a',
        target_radio: index % 2 ? 'a' : 'b',
        tx_state: index % 2 ? 'tx_failed' : 'tx_confirmed',
        reception_state: index % 2 ? 'unconfirmed' : 'observed',
      })),
    },
  });

  it('paginates ten crossings and filters direction and outcome independently', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: manyCrossings() });
    const wrapper = mount(BridgeDiagnostics); await flushPromises();
    expect(wrapper.findAll('[data-testid="crossing-row"]')).toHaveLength(10);
    expect(wrapper.text()).toContain('Page 1 of 3');
    const next = wrapper.findAll('button').find(button => button.text() === 'Next')!;
    await next.trigger('click');
    expect(wrapper.text()).toContain('Page 2 of 3');
    expect(wrapper.text()).toContain('Auto-refresh paused while you inspect');
    await next.trigger('click');
    expect(wrapper.findAll('[data-testid="crossing-row"]')).toHaveLength(3);
    expect(next.attributes('disabled')).toBeDefined();
    await wrapper.get('[aria-label="Filter by status"]').setValue('tx_failed');
    expect(wrapper.text()).toContain('Page 1 of 2');
    expect(wrapper.text()).toContain('11 matching crossings');
    await wrapper.get('[aria-label="Filter by direction"]').setValue(JSON.stringify(['a', 'b']));
    expect(wrapper.text()).toContain('No crossings match these filters');
    expect(wrapper.findAll('[data-testid="crossing-row"]')).toHaveLength(0);
    wrapper.unmount();
  });

  it('preserves filters and page safely when a refreshed result shrinks', async () => {
    vi.mocked(ApiService.get).mockResolvedValueOnce({ success: true, data: manyCrossings() })
      .mockResolvedValue({ success: true, data: status });
    const wrapper = mount(BridgeDiagnostics); await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === 'Next')!.trigger('click');
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Page 1 of 1');
    expect(wrapper.findAll('[data-testid="crossing-row"]')).toHaveLength(1);
    wrapper.unmount();
  });

  it('pauses automatic refresh during evidence inspection and clears its timer on unmount', async () => {
    vi.useFakeTimers();
    vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: status });
    const wrapper = mount(BridgeDiagnostics);
    try {
      await flushPromises();
      await wrapper.get('.evidence-button').trigger('click');
      expect(wrapper.get('.evidence-button').attributes('aria-expanded')).toBe('true');
      expect(wrapper.text()).toContain('Observation deadline');
      expect(wrapper.text()).toContain('Received');
      await vi.advanceTimersByTimeAsync(5000);
      expect(ApiService.get).toHaveBeenCalledTimes(1);
      await wrapper.get('.evidence-button').trigger('click');
      await vi.advanceTimersByTimeAsync(5000);
      expect(ApiService.get).toHaveBeenCalledTimes(2);
      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(10000);
      expect(ApiService.get).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });
});

it('loads and polls diagnostics only when its section is active', async () => {
  vi.useFakeTimers();
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:status});
  const wrapper = mount(BridgeDiagnostics, {props:{active:false}});
  try {
    await vi.advanceTimersByTimeAsync(5000);
    expect(ApiService.get).not.toHaveBeenCalled();
    await wrapper.setProps({active:true}); await flushPromises();
    expect(ApiService.get).toHaveBeenCalledTimes(1);
    await wrapper.setProps({active:false});
    await vi.advanceTimersByTimeAsync(10000);
    expect(ApiService.get).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); vi.useRealTimers(); }
});
