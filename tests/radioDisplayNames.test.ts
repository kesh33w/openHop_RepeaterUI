import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defaultRadioName, normalizeRadioNames } from '@/utils/radioDisplayNames';
import { useMultiRadioConfig } from '@/composables/useMultiRadioConfig';
import RadioNamesSettings from '@/components/configuration/RadioNamesSettings.vue';

interface TestStore {
  stats: { config: { web: { site_name: string; radio_labels?: Record<string, string> }; radios: Array<{ id: string; label?: string; radio: { frequency: number } }> } };
  fetchStats: ReturnType<typeof vi.fn>;
}
const mocks = vi.hoisted(() => ({ post: vi.fn(), store: null as unknown as TestStore }));
vi.mock('@/stores/system', () => ({ useSystemStore: () => mocks.store }));
vi.mock('@/utils/api', () => ({ ApiService: { post: mocks.post } }));
const radioEntries = [
  { id: 'host-rf', label: 'Sacramento', radio: { frequency: 909875000 } },
  { id: 'bay', radio: { frequency: 910525000 } },
];

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({ success: true });
  mocks.store = reactive({
    stats: { config: { web: { site_name: 'OpenHop' }, radios: structuredClone(radioEntries) } },
    fetchStats: vi.fn().mockResolvedValue(undefined),
  });
});
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: RadioNamesSettings }, { path: '/other', component: { template: '<div>Other</div>' } },
  ] });
  await router.push('/'); await router.isReady();
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

describe('display-only radio names', () => {
  it('preserves configured labels, uses frequencies for unnamed radios, and falls back safely', () => {
    expect(defaultRadioName(radioEntries[0]!)).toBe('Sacramento');
    expect(defaultRadioName(radioEntries[1]!)).toBe('910.525 MHz');
    expect(defaultRadioName({ id: 'offline' })).toBe('offline');
    expect(normalizeRadioNames({ a: ' One ', b: null, c: '  ' })).toEqual({ a: 'One' });
  });
  it('uses saved names reactively while keeping menu values as stable radio IDs', async () => {
    const config = useMultiRadioConfig();
    expect(config.radioOptions.value.map(r => r.label)).toEqual(['Sacramento', '910.525 MHz']);
    mocks.store.stats.config.web.radio_labels = { 'host-rf': '909', bay: '910' };
    await nextTick();
    expect(config.radioOptions.value.map(r => [r.id, r.label])).toEqual([['host-rf', '909'], ['bay', '910']]);
    expect(config.radioLabel('unknown')).toBe('unknown');
  });
  it('saves only name metadata and updates labels immediately, without restart or RF writes', async () => {
    const { wrapper } = await setup();
    await wrapper.get('[data-radio-id="host-rf"]').setValue('  909  ');
    await wrapper.get('[data-radio-id="bay"]').setValue('910');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/update_web_config', { web: { radio_labels: { 'host-rf': '909', bay: '910' } } });
    expect(mocks.store.stats.config.radios).toEqual(radioEntries);
    expect(mocks.store.stats.config.web.site_name).toBe('OpenHop');
    expect(useMultiRadioConfig().radioLabel('bay')).toBe('910');
    expect(wrapper.text()).toContain('no restart needed');
    wrapper.unmount();
    const reloaded = await setup();
    expect((reloaded.wrapper.get('[data-radio-id="bay"]').element as HTMLInputElement).value).toBe('910');
    reloaded.wrapper.unmount();
  });
  it('clears a custom name to its automatic label without losing unlisted names', async () => {
    mocks.store.stats.config.web.radio_labels = { 'host-rf': '909', disconnected: 'Spare' };
    const { wrapper } = await setup();
    await wrapper.get('[data-radio-id="host-rf"]').setValue('');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(mocks.post).toHaveBeenCalledWith('/update_web_config', { web: { radio_labels: { disconnected: 'Spare' } } });
    expect(useMultiRadioConfig().radioLabel('host-rf')).toBe('Sacramento');
    wrapper.unmount();
  });
  it('does not overwrite edits when stats refresh and rejects ambiguous duplicate names', async () => {
    const { wrapper } = await setup();
    await wrapper.get('[data-radio-id="host-rf"]').setValue('Same');
    mocks.store.stats.config.radios = structuredClone(radioEntries); await nextTick();
    expect((wrapper.get('[data-radio-id="host-rf"]').element as HTMLInputElement).value).toBe('Same');
    await wrapper.get('[data-radio-id="bay"]').setValue('same');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('different name');
    wrapper.unmount();
  });
  it('retains edits after a definite failure', async () => {
    mocks.post.mockResolvedValue({ success: false, error: 'Read only' });
    const { wrapper } = await setup();
    await wrapper.get('[data-radio-id="bay"]').setValue('910');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.text()).toContain('Read only');
    expect((wrapper.get('[data-radio-id="bay"]').element as HTMLInputElement).value).toBe('910');
    expect(useMultiRadioConfig().radioLabel('bay')).toBe('910.525 MHz');
    wrapper.unmount();
  });
  it('blocks an uncertain save until explicit reload rather than silently retrying', async () => {
    mocks.post.mockRejectedValue(new Error('timeout'));
    const { wrapper } = await setup();
    await wrapper.get('[data-radio-id="bay"]').setValue('910');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Save outcome is unknown');
    await wrapper.findAll('button').find(b => b.text() === 'Reload saved names')!.trigger('click'); await flushPromises();
    expect(mocks.store.fetchStats).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Saved names reloaded');
    wrapper.unmount();
  });
  it('protects unfinished edits on navigation and allows explicit discard', async () => {
    const { wrapper, router } = await setup();
    await wrapper.get('[data-radio-id="bay"]').setValue('Unsaved');
    const navigation = router.push('/other'); await flushPromises();
    const modal = wrapper.findComponent({ name: 'UnsavedChangesModal' });
    expect(modal.props('show')).toBe(true);
    modal.vm.$emit('discard'); await navigation;
    expect(router.currentRoute.value.path).toBe('/other');
    expect(mocks.post).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
