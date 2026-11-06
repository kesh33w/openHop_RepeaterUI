import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import InternetLink from '@/components/configuration/InternetLinkSettings.vue';
import ApiService from '@/utils/api';
vi.mock('@/utils/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const data = () => ({ enabled: true, running: true, listening: true, editable: true, listener_port: 7443,
  node_id: 'host', enrollment_available: true, packet_ttl_ms: 15000,
  settings: { send_timeout: 1, max_inflight: 4, max_rx_tasks: 16 },
  peers: [{ id: 'device-a', connected: false }], routes: [], pending_rf: 0, dropped_tasks: 0, transport_failures: 0 });
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: data() }); });
afterEach(() => { vi.useRealTimers(); });
it('refreshes disconnected peers after reconnect without replacing unsaved options and stops on unmount', async () => {
  const w = mount(InternetLink); await flushPromises();
  expect(w.text()).toContain('Disconnected');
  await w.get('[data-testid=link-timeout]').setValue('2');
  vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: { ...data(), peers: [{ id: 'device-a', connected: true }] } });
  await vi.advanceTimersByTimeAsync(5000); await flushPromises();
  expect(w.text()).toContain('Connected');
  expect(w.get<HTMLInputElement>('[data-testid=link-timeout]').element.value).toBe('2');
  w.unmount(); const calls = vi.mocked(ApiService.get).mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000); expect(ApiService.get).toHaveBeenCalledTimes(calls);
});
it('saves only the supported options and reports a confirmed live apply', async () => {
  vi.mocked(ApiService.post).mockResolvedValue({ success: true });
  const w = mount(InternetLink); await flushPromises();
  await w.get('[data-testid=link-inflight]').setValue('8');
  await w.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenCalledWith('/update_internet_link', { send_timeout: 1, max_inflight: 8, max_rx_tasks: 16 });
  expect(w.text()).toContain('Saved and applied'); w.unmount();
});
it('retains edits on save failure and marks stale status after a refresh failure', async () => {
  vi.mocked(ApiService.post).mockResolvedValue({ success: false });
  const w = mount(InternetLink); await flushPromises();
  await w.get('[data-testid=link-tasks]').setValue('20');
  await w.get('form').trigger('submit'); await flushPromises();
  expect(w.text()).toContain('save was not confirmed');
  expect(w.get<HTMLInputElement>('[data-testid=link-tasks]').element.value).toBe('20');
  vi.mocked(ApiService.get).mockRejectedValue(new Error('offline'));
  await vi.advanceTimersByTimeAsync(5000); await flushPromises();
  expect(w.get('[role=alert]').text()).toContain('out of date'); w.unmount();
});
it('guards unsaved changes and disables controls for an unavailable listener', async () => {
  const w = mount(InternetLink); await flushPromises();
  await w.get('[data-testid=link-tasks]').setValue('20');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); const accept = vi.fn(); const cancel = vi.fn();
  w.vm.requestLeave(accept, cancel); expect(accept).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalled(); confirm.mockRestore(); w.unmount();
  vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: { ...data(), editable: false, listening: false } });
  const unavailable = mount(InternetLink); await flushPromises(); expect(unavailable.get('fieldset').attributes()).toHaveProperty('disabled'); unavailable.unmount();
});

it.each([
  [null, 'Not recorded'], [0, '0 seconds ago'], [1, '1 second ago'],
  [62, '1 minute ago'], [125, '2 minutes ago'], [7200, '2 hours ago'],
])('shows inbound frame age %s without treating it as delivery', async (age, expected) => {
  vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: {
    ...data(), peers: [{ id: 'device-a', connected: true, last_valid_inbound_frame_age_seconds: age }],
  } });
  const w = mount(InternetLink); await flushPromises();
  expect(w.text()).toContain(`Last valid inbound frame: ${expected}`);
  expect(w.text()).toContain('Connected');
  expect(w.text()).toContain('Neither connection nor frame activity confirms RF delivery');
  w.unmount();
});

it('handles an older status response and refreshes connection and activity independently', async () => {
  const w = mount(InternetLink); await flushPromises();
  expect(w.text()).toContain('Last valid inbound frame: Not recorded');
  vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: {
    ...data(), peers: [{ id: 'device-a', connected: false, last_valid_inbound_frame_age_seconds: 125 }],
  } });
  await vi.advanceTimersByTimeAsync(5000); await flushPromises();
  expect(w.text()).toContain('Disconnected');
  expect(w.text()).toContain('Last valid inbound frame: 2 minutes ago');
  vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: {
    ...data(), peers: [{ id: 'device-a', connected: true, last_valid_inbound_frame_age_seconds: 130 }],
  } });
  await vi.advanceTimersByTimeAsync(5000); await flushPromises();
  expect(w.text()).toContain('Connected');
  expect(w.text()).toContain('Last valid inbound frame: 2 minutes ago');
  w.unmount();
});
