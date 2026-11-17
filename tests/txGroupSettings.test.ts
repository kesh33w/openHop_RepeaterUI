import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TxGroupSettings from '../src/components/configuration/TxGroupSettings.vue';
vi.mock('@/components/modals/RestartModal.vue', () => ({default:{props:['modelValue','startImmediately'],emits:['update:modelValue'],template:'<div v-if="modelValue" data-testid="restart-dialog"><button @click="$emit(\'update:modelValue\',false)">Cancel</button></div>'}}));
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
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/update_tx_group',{primary_radio_id:'bay',radio_ids:['rak','bay']});
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
});

it('opens the existing restart dialog without restarting, supports cancel and reopening, and blocks unsaved drafts', async () => {
  const wrapper = mount(TxGroupSettings); await flushPromises();
  const button = wrapper.get('[data-testid=tx-validate-restart]');
  await button.trigger('click');
  expect(wrapper.find('[data-testid=restart-dialog]').exists()).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
  await wrapper.get('[data-testid=restart-dialog] button').trigger('click');
  expect(wrapper.find('[data-testid=restart-dialog]').exists()).toBe(false);
  await button.trigger('click');
  expect(wrapper.find('[data-testid=restart-dialog]').exists()).toBe(true);
  await wrapper.get('[data-testid=restart-dialog] button').trigger('click');
  await wrapper.get('select').setValue('rak,bay');
  expect(button.attributes('disabled')).toBeDefined();
  expect(api.post).not.toHaveBeenCalled();
});

it('automatically prompts after a successful save that requires restart, without restarting', async () => {
  const wrapper = mount(TxGroupSettings); await flushPromises();
  api.get.mockResolvedValue({success:true,data:{groups:[{...state.groups[0],radio_ids:['rak','bay']}]}});
  await wrapper.get('select').setValue('rak,bay');
  await wrapper.findAll('button')[0]!.trigger('click'); await flushPromises();
  expect(wrapper.find('[data-testid=restart-dialog]').exists()).toBe(true);
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/update_tx_group',{primary_radio_id:'bay',radio_ids:['rak','bay']});
  await wrapper.get('[data-testid=restart-dialog] button').trigger('click');
  expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('rak,bay');
  expect(wrapper.text()).toContain('Running: bay. Saved: rak → bay.');
  expect(wrapper.find('[data-testid=restart-dialog]').exists()).toBe(false);
});
it('does not prompt after a rejected save', async () => {
  api.post.mockResolvedValue({success:false,error:'Unavailable'});
  const wrapper = mount(TxGroupSettings); await flushPromises();
  await wrapper.get('select').setValue('rak,bay');
  await wrapper.findAll('button')[0]!.trigger('click'); await flushPromises();
  expect(wrapper.find('[data-testid=restart-dialog]').exists()).toBe(false);
});

it.each([
  {active:['bay'],saved:['bay'],activeText:'OFF',savedText:'Applied.'},
  {active:['bay'],saved:['bay','rak'],activeText:'OFF',savedText:'PENDING RESTART'},
  {active:['bay','rak'],saved:['bay','rak'],activeText:'ON',savedText:'Applied.'},
  {active:null,saved:['bay'],activeText:'UNKNOWN',savedText:'Running state unavailable'},
])('distinguishes active TX from saved configuration: %j', async ({active,saved,activeText,savedText}) => {
  api.get.mockResolvedValue({success:true,data:{groups:[{...state.groups[0],active_radio_ids:active,radio_ids:saved}]}});
  const wrapper=mount(TxGroupSettings); await flushPromises();
  expect(wrapper.get('[data-testid=tx-active-bay]').text()).toContain(activeText);
  expect(wrapper.get('[data-testid=tx-saved-bay]').text()).toContain(savedText);
});
