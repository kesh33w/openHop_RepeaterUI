import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BridgeSettings from '@/components/configuration/BridgeSettings.vue';
import ApiService from '@/utils/api';
vi.mock('@/utils/api', () => ({default:{get:vi.fn(),post:vi.fn()}}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:false,channels:{Public:'*** REDACTED ***'},mappings:[],echo_database:'/tmp/echo.sqlite'},radio_ids:['a','b']}});
  vi.mocked(ApiService.post).mockResolvedValue({success:true,data:{restart_required:true}});
});
describe('native bridge settings', () => {
  it('keeps mapping DOM values and selected labels correct after save reorders channels and radios', async () => {
    const settings = {enabled:true, channels:{Public:'*** REDACTED ***','#test':'*** REDACTED ***'}, mappings:[{source_radio:'a',target_radio:'b',source_channel:'Public',target_channel:'#test'}],echo_database:'/tmp/echo.sqlite'};
    vi.mocked(ApiService.get)
      .mockResolvedValueOnce({success:true,data:{settings,radio_ids:['a','b']}})
      .mockResolvedValueOnce({success:true,data:{settings:{...settings,channels:{'#test':'*** REDACTED ***',Public:'*** REDACTED ***'}},radio_ids:['b','a']}});
    const wrapper = mount(BridgeSettings); await flushPromises();
    const values = () => wrapper.findAll<HTMLSelectElement>('select').map(s => s.element.value);
    const labels = () => wrapper.findAll<HTMLSelectElement>('select').map(s => s.element.selectedOptions[0]?.textContent);
    expect(values()).toEqual(['a','Public','b','#test']);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({mappings:settings.mappings}));
    expect(values()).toEqual(['a','Public','b','#test']);
    expect(labels()).toEqual(['a','Public','b','#test']);
  });
  it('renders saved channels without key values and retains keys on save',async () => {
    const wrapper=mount(BridgeSettings);await flushPromises();
    expect(wrapper.get<HTMLInputElement>('input[type=password]').element.value).toBe('');
    expect(wrapper.get<HTMLInputElement>('input[type=password]').attributes('autocomplete')).toBe('new-password');
    expect(wrapper.get<HTMLInputElement>('input[type=checkbox]').element.checked).toBe(false);
    await wrapper.get('form').trigger('submit');await flushPromises();
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({channels:{Public:'*** REDACTED ***'}}));
    expect(wrapper.text()).toContain('Restart OpenHop');
  });
  it('sends an explicit replacement and clears it after failed save',async () => {
    vi.mocked(ApiService.post).mockResolvedValue({success:false,error:'rejected'});
    const wrapper=mount(BridgeSettings);await flushPromises();
    await wrapper.get<HTMLInputElement>('input[type=password]').setValue('a'.repeat(32));
    await wrapper.get('form').trigger('submit');await flushPromises();
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({channels:{Public:'a'.repeat(32)}}));
    expect(wrapper.get<HTMLInputElement>('input[type=password]').element.value).toBe('');
    expect(wrapper.text()).toContain('Not saved');
  });
  it('adds mappings using configured radios',async () => {
    const wrapper=mount(BridgeSettings);await flushPromises();
    await wrapper.findAll('button').find(b=>b.text()==='Add mapping')!.trigger('click');
    expect(wrapper.findAll('select')[0]!.element.value).toBe('a');
    expect(wrapper.findAll('select')[2]!.element.value).toBe('b');
  });
});
