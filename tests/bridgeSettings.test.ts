import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSystemStore } from '@/stores/system';
import { flushPromises, mount } from '@vue/test-utils';
import BridgeSettings from '@/components/configuration/BridgeSettings.vue';
import ApiService from '@/utils/api';
vi.mock('@/components/configuration/InternetLinkSettings.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/utils/api', () => ({default:{get:vi.fn(),post:vi.fn()}}));
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:false,channels:{Public:'*** REDACTED ***'},mappings:[],echo_database:'/tmp/echo.sqlite'},radio_ids:['a','b']}});
  vi.mocked(ApiService.post).mockResolvedValue({success:true,data:{restart_required:true}});
});
describe('native bridge settings', () => {
  it('defaults direct transit off and saves explicitly selected routes without channel keys', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:true,origin_home:'a',channels:{},mappings:[]},radio_ids:['a','b']}});
    const wrapper = mount(BridgeSettings); await flushPromises();
    expect(wrapper.findAll('.direct-route-row')).toHaveLength(0);
    await wrapper.findAll('button').find(b=>b.text()==='Add direct route')!.trigger('click');
    const selects=wrapper.findAll<HTMLSelectElement>('.direct-route-row select');
    expect(selects.map(s=>s.element.value)).toEqual(['','']);
    await selects[0]!.setValue('a'); await selects[1]!.setValue('b');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({channels:{},direct_routes:[{source_radio:'a',target_radio:'b'}]}));
  });
  it.each([
    {direct_routes:[{source_radio:'a',target_radio:'a'}]},
    {direct_routes:[{source_radio:'unknown',target_radio:'b'}]},
    {direct_routes:[{source_radio:'a',target_radio:'b'},{source_radio:'a',target_radio:'b'}]},
  ])('rejects invalid or ambiguous direct routes %j', async ({direct_routes}) => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:true,origin_home:'a',channels:{},mappings:[],direct_routes},radio_ids:['a','b']}});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('only one destination per source radio');
  });
  it('removes direct routes explicitly without changing channel mappings', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:false,channels:{},mappings:[],direct_routes:[{source_radio:'a',target_radio:'b'}]},radio_ids:['a','b']}});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.findAll('button').find(b=>b.text()==='Remove direct route')!.trigger('click');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({direct_routes:[],mappings:[]}));
  });
  it('requires an explicit configured origin home when enabling the bridge', async () => {
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('input[type=checkbox]').setValue(true);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Select an origin home radio');
    await wrapper.get('[data-testid=origin-home]').setValue('b');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings', expect.objectContaining({origin_home:'b'}));
  });
  it('uses canonical server choices without inventing a default home', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:true,origin_home:'missing',channels:{},mappings:[]},radio_ids:['alias-a','alias-b']}});
    const wrapper = mount(BridgeSettings); await flushPromises();
    expect(wrapper.get('[data-testid=origin-home]').findAll('option').map(o=>o.attributes('value'))).toEqual(['','alias-a','alias-b']);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).not.toHaveBeenCalled();
  });
  it('directs incomplete companion assignments to the companion editor', async () => {
    vi.mocked(ApiService.post).mockResolvedValue({success:false,error:'bridge_home_assignment_required'});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.text()).toContain('Companions page');
  });
  it('keeps mapping DOM values and selected labels correct after save reorders channels and radios', async () => {
    const settings = {enabled:true, origin_home: 'a', channels:{Public:'*** REDACTED ***','#test':'*** REDACTED ***'}, mappings:[{source_radio:'a',target_radio:'b',source_channel:'Public',target_channel:'#test'}],echo_database:'/tmp/echo.sqlite'};
    vi.mocked(ApiService.get)
      .mockResolvedValueOnce({success:true,data:{settings,radio_ids:['a','b']}})
      .mockResolvedValueOnce({success:true,data:{settings:{...settings,channels:{'#test':'*** REDACTED ***',Public:'*** REDACTED ***'}},radio_ids:['b','a']}});
    const wrapper = mount(BridgeSettings); await flushPromises();
    const values = () => wrapper.findAll<HTMLSelectElement>('.mapping-row select').map(s => s.element.value);
    const labels = () => wrapper.findAll<HTMLSelectElement>('.mapping-row select').map(s => s.element.selectedOptions[0]?.textContent);
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
    expect(wrapper.findAll<HTMLSelectElement>('.mapping-row select')[0]!.element.value).toBe('a');
    expect(wrapper.findAll<HTMLSelectElement>('.mapping-row select')[2]!.element.value).toBe('b');
  });
});


it('loads the real disabled Pi response when optional collections are omitted', async () => {
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:false,echo_database:'/var/lib/openhop_repeater/bridge-echo.sqlite',direct_routes:[],max_pending_crossings:64,queue_ttl_seconds:30},radio_ids:['host-rf'],restart_required:true}});
  const wrapper = mount(BridgeSettings); await flushPromises();
  expect(wrapper.text()).not.toContain('Bridge settings could not be loaded');
  expect(wrapper.find('form').exists()).toBe(true);
  expect(wrapper.get('[data-testid=origin-home]').text()).toContain('host-rf');
  wrapper.unmount();
});


it('shows configured radio labels while retaining route IDs in saved mappings', async () => {
  Object.assign(useSystemStore(), {stats:{radios:[{id:'host-rf',label:'Sacramento'},{id:'bay'}]}});
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:true,origin_home:'host-rf',channels:{Public:'*** REDACTED ***'},mappings:[{source_radio:'bay',target_radio:'host-rf',source_channel:'Public',target_channel:'Public'}]},radio_ids:['host-rf','bay']}});
  const wrapper=mount(BridgeSettings); await flushPromises();
  const options=wrapper.get('[data-testid=origin-home]').findAll('option');
  expect(options.find(o=>o.text()==='Sacramento')?.element.value).toBe('host-rf');
  const destination=wrapper.findAll<HTMLSelectElement>('.mapping-row select')[2]!;
  expect(destination.element.selectedOptions[0]?.textContent).toBe('Sacramento');
  expect(destination.element.value).toBe('host-rf');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({origin_home:'host-rf',mappings:[expect.objectContaining({target_radio:'host-rf'})]}));
  wrapper.unmount();
});
