import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import Companions from '@/views/Companions.vue';
import ApiService from '@/utils/api';
vi.mock('@/utils/api', () => ({ default: {
  get: vi.fn(), getIdentities: vi.fn(), createIdentity: vi.fn(), updateIdentity: vi.fn(),
}, API_SERVER_URL: '' }));
const mountView = () => mount(Companions, { global: { plugins: [createPinia()], stubs: {
  Teleport: true, RestartModal: true, ConfirmDialog: true, MessageDialog: true,
  ImportRepeaterContactsModal: true, MeshCoreQrModal: true,
} } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:true},radio_ids:['alias-a','alias-b']}});
  const data = {identities:[],configured_companions:[{name:'Bot',settings:{node_name:'Bot',tcp_port:5000,bind_address:'127.0.0.1',home_radio_id:'alias-b'}}]};
  vi.mocked(ApiService.getIdentities).mockResolvedValue({success:true,data});
  vi.mocked(ApiService.createIdentity).mockResolvedValue({success:true});
  vi.mocked(ApiService.updateIdentity).mockResolvedValue({success:true});
});
describe('companion home assignment', () => {
  it('requires a choice for creation and submits the selected home', async () => {
    const wrapper=mountView(); await flushPromises();
    await wrapper.findAll('button').find(b=>b.text()==='Add Companion')!.trigger('click');
    await wrapper.findAll('button').find(b=>b.text()==='Create')!.trigger('click'); await flushPromises();
    expect(ApiService.createIdentity).not.toHaveBeenCalled();
    await wrapper.get('[data-testid=newIdentity-home]').setValue('alias-a');
    await wrapper.findAll('button').find(b=>b.text()==='Create')!.trigger('click'); await flushPromises();
    expect(ApiService.createIdentity).toHaveBeenCalledWith(expect.objectContaining({settings:expect.objectContaining({home_radio_id:'alias-a'})}));
  });
  it('preserves the explicit home on edit and uses canonical radio choices', async () => {
    const wrapper=mountView(); await flushPromises();
    await wrapper.findAll('button').find(b=>b.text()==='Edit')!.trigger('click');
    const select=wrapper.get<HTMLSelectElement>('[data-testid=editingIdentity-home]');
    expect(select.element.value).toBe('alias-b');
    expect(select.findAll('option').map(o=>o.attributes('value'))).toEqual(['','alias-a','alias-b']);
    await wrapper.findAll('button').find(b=>b.text()==='Update')!.trigger('click'); await flushPromises();
    expect(ApiService.updateIdentity).toHaveBeenCalledWith(expect.objectContaining({settings:expect.objectContaining({home_radio_id:'alias-b'})}));
  });
  it('rejects an unset home without guessing a radio', async () => {
    const wrapper=mountView(); await flushPromises();
    await wrapper.findAll('button').find(b=>b.text()==='Edit')!.trigger('click');
    await wrapper.get('[data-testid=editingIdentity-home]').setValue('');
    await wrapper.findAll('button').find(b=>b.text()==='Update')!.trigger('click'); await flushPromises();
    expect(ApiService.updateIdentity).not.toHaveBeenCalled();
    expect(wrapper.findComponent({name:'MessageDialog'}).props('message')).toContain('Select a configured home radio');
  });
  it('fails closed when routing settings cannot be loaded', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:false,error:'unavailable'});
    const wrapper=mountView(); await flushPromises();
    await wrapper.findAll('button').find(b=>b.text()==='Edit')!.trigger('click');
    await wrapper.findAll('button').find(b=>b.text()==='Update')!.trigger('click'); await flushPromises();
    expect(ApiService.updateIdentity).not.toHaveBeenCalled();
    expect(wrapper.findComponent({name:'MessageDialog'}).props('message')).toContain('Reload this page');
  });
  it('allows no home when bridging is disabled', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:false},radio_ids:['alias-a','alias-b']}});
    const wrapper=mountView(); await flushPromises();
    await wrapper.findAll('button').find(b=>b.text()==='Edit')!.trigger('click');
    await wrapper.get('[data-testid=editingIdentity-home]').setValue('');
    await wrapper.findAll('button').find(b=>b.text()==='Update')!.trigger('click'); await flushPromises();
    expect(ApiService.updateIdentity).toHaveBeenCalledWith(expect.objectContaining({settings:expect.objectContaining({home_radio_id:null})}));
  });
});
