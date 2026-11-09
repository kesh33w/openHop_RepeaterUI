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
