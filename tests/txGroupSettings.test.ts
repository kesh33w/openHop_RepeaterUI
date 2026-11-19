import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TxGroupSettings from '../src/components/configuration/TxGroupSettings.vue';
const api = vi.hoisted(() => ({get: vi.fn(), post: vi.fn()}));
vi.mock('@/utils/api', () => ({default: api}));
const state = {groups: [{network:'sfo', primary_radio_id:'bay', radio_ids:['bay'], active_radio_ids:['bay'], members:[{id:'bay',label:'Directional'},{id:'rak',label:'RAK'}]}]};
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({success:true,data:state}); api.post.mockResolvedValue({success:true}); });
describe('ordered transmitter controls', () => {
  it('offers single or either order and stages RAK first without restarting', async () => {
    const wrapper = mount(TxGroupSettings); await flushPromises();
    expect(wrapper.findAll('option').map(o => o.text())).toEqual(['Single: Directional','Directional → RAK','RAK → Directional']);
    await wrapper.get('select').setValue('rak,bay');
    await wrapper.findAll('button')[0]!.trigger('click'); await flushPromises();
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/update_tx_group',{primary_radio_id:'bay',radio_ids:['rak','bay'],scope:'all'});
    expect(wrapper.text()).toContain('Running transmitters have not changed');
  });
  it('preserves selection on rejected save and shows validation reason', async () => {
    api.post.mockResolvedValue({success:false,error:'Both radios must be available'});
    const wrapper = mount(TxGroupSettings); await flushPromises();
    await wrapper.get('select').setValue('rak,bay');
    await wrapper.findAll('button')[0]!.trigger('click'); await flushPromises();
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('rak,bay');
    expect(wrapper.text()).toContain('Both radios must be available');
  });
  it('does not submit twice while pending', async () => {
    api.post.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(TxGroupSettings); await flushPromises();
    await wrapper.get('select').setValue('rak,bay');
    await wrapper.findAll('button')[0]!.trigger('click');
    await wrapper.findAll('button')[0]!.trigger('click');
    expect(api.post).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('saves bridged-only dual TX for a pair and explains it', async () => {
    const wrapper = mount(TxGroupSettings); await flushPromises();
    expect(wrapper.find('select[aria-label="Packets sent through both transmitters"]').exists()).toBe(false);
    await wrapper.get('select').setValue('rak,bay');
    const scope = wrapper.get('select[aria-label="Packets sent through both transmitters"]');
    await scope.setValue('crossings');
    expect(wrapper.text()).toContain('Everything else uses Directional alone');
    await wrapper.findAll('button')[0]!.trigger('click'); await flushPromises();
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/update_tx_group',{primary_radio_id:'bay',radio_ids:['rak','bay'],scope:'crossings'});
  });
  it('shows saved and running scope and enables save when only the scope changes', async () => {
    api.get.mockResolvedValue({success:true,data:{groups:[{...state.groups[0], radio_ids:['rak','bay'], active_radio_ids:['rak','bay'], scope:'crossings', active_scope:'all'}]}});
    const wrapper = mount(TxGroupSettings); await flushPromises();
    expect(wrapper.text()).toContain('Running: rak → bay for every packet');
    expect(wrapper.text()).toContain('Saved: rak → bay for bridged packets only');
    const save = wrapper.findAll('button')[0]!;
    expect(save.attributes('disabled')).toBeDefined();
    await wrapper.get('select[aria-label="Packets sent through both transmitters"]').setValue('all');
    expect(save.attributes('disabled')).toBeUndefined();
  });
});
