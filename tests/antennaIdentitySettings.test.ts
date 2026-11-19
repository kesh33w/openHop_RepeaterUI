import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import AntennaIdentitySettings from '../src/components/configuration/AntennaIdentitySettings.vue';
vi.mock('@/components/modals/RestartModal.vue', () => ({default:{props:['modelValue','startImmediately','title','message'],emits:['update:modelValue'],template:'<div v-if="modelValue" data-testid="restart-dialog"></div>'}}));
const api = vi.hoisted(() => ({get: vi.fn(), post: vi.fn()}));
vi.mock('@/utils/api', () => ({default: api}));
const state = (over = {}) => ({success:true,data:{saved:'rx_tx',running:'rx_tx',restart_required:false,tx_available:true,...over}});
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(state()); api.post.mockResolvedValue({success:true}); });

it('shows the running and saved mode and saves a new mode for restart', async () => {
  const wrapper = mount(AntennaIdentitySettings); await flushPromises();
  expect(wrapper.get('[data-testid=antenna-running]').text()).toContain('Receiving + transmitting antenna');
  expect(wrapper.get('[data-testid=antenna-saved]').text()).toContain('Applied.');
  const save = wrapper.findAll('button').find(b => b.text() === 'Save for restart')!;
  expect(save.attributes('disabled')).toBeDefined();
  await wrapper.get('#antenna-identity-mode').setValue('off');
  expect(wrapper.text()).toContain('Codes other nodes already learned keep working');
  api.get.mockResolvedValue(state({saved:'off', restart_required:true}));
  await save.trigger('click'); await flushPromises();
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/update_antenna_identities', {mode:'off'});
  expect(wrapper.get('[data-testid=antenna-saved]').text()).toContain('PENDING RESTART');
  expect(wrapper.find('[data-testid=restart-dialog]').exists()).toBe(true);
});

it('disables transmit-only codes without per-transmitter keys', async () => {
  api.get.mockResolvedValue(state({tx_available:false}));
  const wrapper = mount(AntennaIdentitySettings); await flushPromises();
  const tx = wrapper.findAll('option').find(o => o.element.value === 'tx')!;
  expect(tx.attributes('disabled')).toBeDefined();
  expect(tx.text()).toContain('needs per-transmitter keys');
});

it('keeps the selection and shows the reason when a save is rejected', async () => {
  api.post.mockResolvedValue({success:false,error:'Antenna identity settings are invalid'});
  const wrapper = mount(AntennaIdentitySettings); await flushPromises();
  await wrapper.get('#antenna-identity-mode').setValue('tx');
  await wrapper.findAll('button').find(b => b.text() === 'Save for restart')!.trigger('click'); await flushPromises();
  expect((wrapper.get('#antenna-identity-mode').element as HTMLSelectElement).value).toBe('tx');
  expect(wrapper.text()).toContain('Antenna identity settings are invalid');
  expect(wrapper.find('[data-testid=restart-dialog]').exists()).toBe(false);
});
