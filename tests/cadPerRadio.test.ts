import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import CADCalibration from '@/views/CADCalibration.vue';
import { ApiService } from '@/utils/api';

vi.mock('@/utils/api', () => ({ API_SERVER_URL: '', ApiService: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/utils/auth', () => ({ getToken: () => 'test token' }));
vi.mock('@/stores/system', () => ({ useSystemStore: () => ({ setCadCalibrationRunning: vi.fn() }) }));
vi.mock('@/components/modals/RestartModal.vue', () => ({ default: { template: '<div />' } }));
class Stream {
  static all: Stream[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { Stream.all.push(this); }
  send(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
const radio = (id: string, label: string, sf: number) => ({ radio_id: id, label, frequency: 910100000,
  spreading_factor: sf, bandwidth: 62500, coding_rate: 5, current_cad_peak: 24,
  current_cad_min: 10, cad_symbol_num: 2, supports_cad: true });
const inventory = (running = false) => ({ success: true, data: { radios: [radio('smf', 'SMF', 7), radio('bay', 'Bay', 9)],
  default_radio_id: 'smf', active_radio_id: running ? 'bay' : null, running } });
const candidate = { det_peak: 24, det_min: 10, detection_rate: 90, detections: 9,
  non_detections: 1, timeouts: 0, errors: 0, attempts: 10, samples: 10 };
let wrapper: VueWrapper;
function button(text: string) {
  const found = wrapper.findAll('button').find(b => b.text().trim() === text || b.text().startsWith(text));
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function render() { wrapper = mount(CADCalibration); await flushPromises(); }
function currentStream() { return Stream.all[Stream.all.length - 1]!; }
function complete(id: string) {
  currentStream().send({ type: 'complete', radio_id: id, results: { recommended: candidate, known_signal_effective: true } });
}
beforeEach(() => {
  vi.clearAllMocks();
  Stream.all = [];
  vi.stubGlobal('EventSource', Stream);
  document.cookie = 'cad_calibration_info_dismissed=1';
  vi.mocked(ApiService.get).mockResolvedValue(inventory());
  vi.mocked(ApiService.post).mockResolvedValue({ success: true });
});
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals(); });

describe('CAD receiver selection', () => {
  it('loads radio names and RF settings without starting or applying anything', async () => {
    await render();
    expect(wrapper.get('#cad-radio').text()).toContain('Bay · 910.100 MHz · SF9');
    expect(ApiService.post).not.toHaveBeenCalled();
    expect(currentStream().url).toContain('radio_id=smf');
    expect(currentStream().url).toContain('token=test+token');
  });
  it('routes start, stream, stop and save to Bay and locks selection during requests', async () => {
    await render();
    await wrapper.get('#cad-radio').setValue('bay');
    let resolve!: (value: { success: boolean }) => void;
    vi.mocked(ApiService.post).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await button('Start Calibration').trigger('click');
    expect(ApiService.post).toHaveBeenCalledWith('/cad-calibration-start', expect.objectContaining({ radio_id: 'bay' }));
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeDefined();
    expect(currentStream().url).toContain('radio_id=bay');
    // Old stream completion must not unlock an in-flight start.
    complete('bay');
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeDefined();
    resolve({ success: true });
    await flushPromises();
    // The new connection replays even a run that finished before the response.
    complete('bay');
    await flushPromises();
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeUndefined();
    await button('Save Settings').trigger('click');
    expect(ApiService.post).toHaveBeenLastCalledWith('/save_cad_settings', expect.objectContaining({ radio_id: 'bay', peak: 24 }));
    await flushPromises();
    await button('Start Calibration').trigger('click');
    await flushPromises();
    await button('Stop').trigger('click');
    expect(ApiService.post).toHaveBeenLastCalledWith('/cad-calibration-stop', { radio_id: 'bay' });
  });
  it('clears old results on switching and ignores closed-stream or other-radio events', async () => {
    await render();
    const old = currentStream();
    complete('smf');
    await flushPromises();
    expect(wrapper.text()).toContain('Save Settings');
    await wrapper.get('#cad-radio').setValue('bay');
    expect(old.close).toHaveBeenCalled();
    old.send({ type: 'complete', radio_id: 'smf', results: { recommended: candidate } });
    currentStream().send({ type: 'complete', radio_id: 'smf', results: { recommended: candidate } });
    currentStream().send({ type: 'complete', radio_id: null, results: { recommended: candidate } });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Save Settings');
    expect(wrapper.text()).toContain('No recommendation yet');
  });
  it('restores the active Bay session without starting a new calibration', async () => {
    vi.mocked(ApiService.get).mockResolvedValue(inventory(true));
    await render();
    expect((wrapper.get('#cad-radio').element as HTMLSelectElement).value).toBe('bay');
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeDefined();
    expect(currentStream().url).toContain('radio_id=bay');
    expect(ApiService.post).not.toHaveBeenCalled();
  });
  it('routes manual checks to Bay and remains locked after stop until the in-flight check returns', async () => {
    await render();
    await wrapper.get('#cad-radio').setValue('bay');
    await button('Manual CAD Check').trigger('click');
    let resolve!: (value: object) => void;
    vi.mocked(ApiService.post).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await wrapper.findAll('button').find(b => b.text().trim() === 'Start')!.trigger('click');
    expect(ApiService.post).toHaveBeenLastCalledWith('/cad-manual-check', expect.objectContaining({ radio_id: 'bay', det_peak: 24 }));
    await wrapper.findAll('button').find(b => b.text().trim() === 'Stop')!.trigger('click');
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeDefined();
    resolve({ success: true, data: { attempts: 1, detections: 1, detected: true } });
    await flushPromises();
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeUndefined();
  });
  it('locks the receiver while saving and ignores inventory that arrives after unmount', async () => {
    await render();
    complete('smf');
    await flushPromises();
    let resolve!: (value: { success: boolean }) => void;
    vi.mocked(ApiService.post).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await button('Save Settings').trigger('click');
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeDefined();
    resolve({ success: true });
    await flushPromises();
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
    let load!: (value: ReturnType<typeof inventory>) => void;
    vi.mocked(ApiService.get).mockImplementationOnce(() => new Promise(r => { load = r; }));
    wrapper = mount(CADCalibration);
    const streamCount = Stream.all.length;
    wrapper.unmount();
    load(inventory(true));
    await flushPromises();
    expect(Stream.all).toHaveLength(streamCount);
  });
  it('does not issue stop or any other mutation when a previous error is replayed on mount', async () => {
    vi.mocked(ApiService.get).mockResolvedValue(inventory(true));
    await render();
    currentStream().send({ type: 'error', radio_id: 'bay', message: 'Previous run failed' });
    await flushPromises();
    expect(ApiService.post).not.toHaveBeenCalled();
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeUndefined();
  });
  it('unlocks a restored Bay run when stopped without showing a successful recommendation', async () => {
    vi.mocked(ApiService.get).mockResolvedValue(inventory(true));
    await render();
    const stream = currentStream();
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeDefined();
    stream.send({ type: 'result', radio_id: 'bay', ...candidate });
    stream.send({ type: 'stopped', radio_id: 'bay', message: 'Calibration stopped by user' });
    await flushPromises();
    expect(wrapper.get('#cad-radio').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('Calibration stopped by user');
    expect(wrapper.text()).not.toContain('Save Settings');
    expect(wrapper.text()).toContain('No recommendation yet');
    expect(stream.close).toHaveBeenCalled();
    expect(ApiService.post).not.toHaveBeenCalled();
    await wrapper.get('#cad-radio').setValue('smf');
    expect(currentStream().url).toContain('radio_id=smf');
  });
  it('keeps an unsupported default receiver selected and disables CAD instead of falling back', async () => {
    const data = inventory().data;
    data.radios[0]!.supports_cad = false;
    vi.mocked(ApiService.get).mockResolvedValue({ success: true, data });
    await render();
    expect((wrapper.get('#cad-radio').element as HTMLSelectElement).value).toBe('smf');
    expect(button('Start Calibration').attributes('disabled')).toBeDefined();
    expect(button('Manual CAD Check').attributes('disabled')).toBeDefined();
    expect(ApiService.post).not.toHaveBeenCalled();
    await wrapper.get('#cad-radio').setValue('bay');
    expect(button('Start Calibration').attributes('disabled')).toBeUndefined();
  });
  it('fails closed when inventory cannot identify the running receiver', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({ success: true, data: { ...inventory(true).data, active_radio_id: 'missing' } });
    await render();
    expect(button('Start Calibration').attributes('disabled')).toBeDefined();
    expect(ApiService.post).not.toHaveBeenCalled();
  });
});
