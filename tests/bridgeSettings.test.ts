import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSystemStore } from '@/stores/system';
import { flushPromises, mount } from '@vue/test-utils';
import BridgeSettings from '@/components/configuration/BridgeSettings.vue';
import ApiService from '@/utils/api';
vi.mock('@/components/configuration/BridgeDiagnostics.vue', () => ({ default: { template: '<div />' } }));
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
    expect(wrapper.text()).toContain('Saved. Running status could not be verified');
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

describe('operational bridge controls', () => {
  function current(overrides = {}) {
    return { settings: {enabled: true, origin_home: 'a', channels: {Public: '*** REDACTED ***'}, mappings: [{source_radio:'a', target_radio:'b', source_channel:'Public', target_channel:'Public'}], direct_routes: [{source_radio:'b',target_radio:'a'}], protocols: {}, paused: false}, radio_ids:['a','b'], running:true, paused:false, controls_available:true, restart_required:false, pending_crossings:0, ...overrides };
  }
  it('preserves channel keys and mappings when disabling a channel and direction', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true, data:current()});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('.channel-row input[type=checkbox]').setValue(false);
    await wrapper.get('.mapping-row input[type=checkbox]').setValue(false);
    await wrapper.get('.direct-route-row input[type=checkbox]').setValue(false);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings', expect.objectContaining({
      disabled_channels:['Public'], channels:{Public:'*** REDACTED ***'},
      mappings:[expect.objectContaining({source_radio:'a',target_radio:'b',enabled:false})],
      direct_routes:[{source_radio:'b',target_radio:'a',enabled:false}],
    }));
    wrapper.unmount();
  });
  it('keeps unsaved route changes through a live pause and sends only the pause', async () => {
    vi.mocked(ApiService.get).mockResolvedValueOnce({success:true,data:current()})
      .mockResolvedValue({success:true,data:current({paused:true, restart_required:true})});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('.mapping-row input[type=checkbox]').setValue(false);
    await wrapper.get('[data-testid=pause-bridge]').trigger('click'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledTimes(1);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_controls', {paused:true});
    expect(wrapper.get<HTMLInputElement>('.mapping-row input[type=checkbox]').element.checked).toBe(false);
    expect(wrapper.text()).toContain('Crossings paused');
    expect(wrapper.text()).toContain('Unsaved changes');
    expect(wrapper.text()).toContain('Restart required');
    wrapper.unmount();
  });
  it('does not send a second pause while one is pending and disables control on stale status', async () => {
    vi.mocked(ApiService.get).mockResolvedValueOnce({success:true,data:current()}).mockRejectedValue(new Error('offline'));
    let resolve!: (value: {success: boolean}) => void;
    vi.mocked(ApiService.post).mockImplementation(() => new Promise(r => { resolve = r; }));
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('[data-testid=pause-bridge]').trigger('click');
    await wrapper.get('[data-testid=pause-bridge]').trigger('click');
    expect(ApiService.post).toHaveBeenCalledTimes(1);
    resolve({success:true}); await flushPromises();
    expect(wrapper.get('[data-testid=pause-bridge]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('out of date');
    wrapper.unmount();
  });
  it('reports a definite pause save failure without claiming work may still complete', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:current()});
    vi.mocked(ApiService.post).mockResolvedValue({success:false,error:'Bridge pause could not be saved. No settings were changed.'});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('[data-testid=pause-bridge]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Pause change was not applied. No settings were changed by this request.');
    expect(wrapper.text()).not.toContain('may still complete');
    expect(wrapper.get('[data-testid=pause-bridge]').attributes('disabled')).toBeUndefined();
    expect(ApiService.post).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('keeps an unknown pause outcome blocked while the accepted operation is pending', async () => {
    vi.mocked(ApiService.get).mockResolvedValueOnce({success:true,data:current()})
      .mockResolvedValue({success:true,data:current({control_pending:true,controls_available:false,restart_required:null})});
    vi.mocked(ApiService.post).mockResolvedValue({success:false,outcome:'unknown',error:'Refresh status'});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('[data-testid=pause-bridge]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Pause outcome is not confirmed and may still complete');
    expect(wrapper.text()).not.toContain('No settings were changed by this request');
    expect(wrapper.get('[data-testid=pause-bridge]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid=pause-bridge]').trigger('click');
    expect(ApiService.post).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('treats a lost pause response as uncertain and never retries on failed refresh', async () => {
    vi.mocked(ApiService.get).mockResolvedValueOnce({success:true,data:current()})
      .mockRejectedValue(new Error('offline'));
    vi.mocked(ApiService.post).mockRejectedValue(new Error('response lost'));
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('[data-testid=pause-bridge]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Pause outcome is not confirmed and may still complete');
    expect(wrapper.text()).not.toContain('No settings were changed by this request');
    expect(wrapper.get('[data-testid=pause-bridge]').attributes('disabled')).toBeDefined();
    expect(ApiService.post).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it('shows unknown running state on older servers rather than assuming running or applied', async () => {
    const wrapper = mount(BridgeSettings); await flushPromises();
    expect(wrapper.text()).toContain('Unknown');
    expect(wrapper.text()).toContain('Running comparison unavailable');
    expect(wrapper.get('[data-testid=pause-bridge]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});

it('keeps a disabled new channel disabled through renaming and trimming', async () => {
  const wrapper = mount(BridgeSettings); await flushPromises();
  await wrapper.findAll('button').find(button => button.text() === 'Add channel')!.trigger('click');
  const row = wrapper.findAll('.channel-row')[1]!;
  await row.get('input[maxlength]').setValue('X');
  await row.get('input[type=checkbox]').setValue(false);
  await row.get('input[maxlength]').setValue(' Y ');
  await row.get('input[type=password]').setValue('a'.repeat(32));
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings', expect.objectContaining({
    disabled_channels: ['Y'], channels: {Public:'*** REDACTED ***', Y:'a'.repeat(32)},
  }));
  wrapper.unmount();
});

it('reports saved but unverified after the post-save refresh fails, and retains new keys safely', async () => {
  vi.mocked(ApiService.get).mockResolvedValueOnce({success:true,data:{settings:{enabled:false,channels:{Public:'*** REDACTED ***'},mappings:[]},radio_ids:['a','b'],running:true,restart_required:false,controls_available:true}}).mockRejectedValue(new Error('offline'));
  const wrapper = mount(BridgeSettings); await flushPromises();
  await wrapper.findAll('button').find(button => button.text() === 'Add channel')!.trigger('click');
  const row = wrapper.findAll('.channel-row')[1]!;
  await row.get('input[maxlength]').setValue('New');
  await row.get('input[type=password]').setValue('b'.repeat(32));
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(wrapper.text()).toContain('Saved. Running status could not be verified');
  expect(wrapper.text()).toContain('Running comparison unavailable');
  expect(wrapper.text()).not.toContain('These settings match the running bridge');
  expect(wrapper.text()).not.toContain('Unsaved changes.');
  expect(wrapper.get('[data-testid=pause-bridge]').attributes('disabled')).toBeDefined();
  expect(row.get<HTMLInputElement>('input[type=password]').element.value).toBe('');
  // A second edit preserves the newly saved key instead of requiring re-entry.
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenLastCalledWith('/update_bridge_settings', expect.objectContaining({channels:{Public:'*** REDACTED ***',New:'*** REDACTED ***'}}));
  wrapper.unmount();
});

it('displays enforced default traffic limits when the host section is absent', async () => {
  const wrapper = mount(BridgeSettings); await flushPromises();
  const input = (label: string) => wrapper.findAll('label').find(item => item.text().includes(label))!.get<HTMLInputElement>('input');
  expect(input('Flood crossings per minute').element.value).toBe('12');
  expect(input('Allowed burst').element.value).toBe('3');
  expect(input('Pending per direction').element.value).toBe('16');
  expect(wrapper.text()).toContain('Defaults are enforced even when');
  expect(wrapper.text()).toContain('Upgrading activates these defaults');
  expect(wrapper.text()).not.toContain('Configure traffic limits');
  expect(wrapper.text()).toContain('ordinary flood direct messages (TXT_MSG)');
  wrapper.unmount();
});

it('does not round-trip the host-managed observer allowlist when saving', async () => {
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:false,channels:{},mappings:[],reception_evidence:{enabled:false,observers:[]}},radio_ids:['a','b']}});
  const wrapper = mount(BridgeSettings); await flushPromises();
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(vi.mocked(ApiService.post).mock.calls[0]![1]).not.toHaveProperty('reception_evidence');
  wrapper.unmount();
});

it('disables new pause actions while an accepted operation is still completing', async () => {
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:true,origin_home:'a',channels:{},mappings:[]},radio_ids:['a','b'],running:true,paused:false,control_pending:true,controls_available:true,restart_required:null}});
  const wrapper = mount(BridgeSettings); await flushPromises();
  expect(wrapper.text()).toContain('A pause change is still completing');
  expect(wrapper.get('[data-testid=pause-bridge]').attributes('disabled')).toBeDefined();
  await wrapper.get('[data-testid=pause-bridge]').trigger('click');
  expect(ApiService.post).not.toHaveBeenCalled();
  wrapper.unmount();
});

it('defaults omitted peer routing to legacy and preserves existing mappings', async () => {
  const wrapper = mount(BridgeSettings); await flushPromises();
  expect(wrapper.get<HTMLSelectElement>('[data-testid=peer-routing]').element.value).toBe('legacy');
  expect(wrapper.get('[data-testid=peer-routing-migration]').text()).toContain('Clear and relearn cross-network contact paths');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings', expect.objectContaining({peer_routing:'legacy',channels:{Public:'*** REDACTED ***'},mappings:[]}));
  wrapper.unmount();
});

it.each(['Discovery and contact path', 'Repeater administration and opaque', 'TRACE across'])('requires distinct mode for %s even in a disabled draft', async (label) => {
  const wrapper = mount(BridgeSettings); await flushPromises();
  await wrapper.findAll('label').find(item => item.text().includes(label))!.get('input').setValue(true);
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain('Not saved. Discovery, repeater administration and TRACE require distinct peer routing');
  await wrapper.get('[data-testid=peer-routing]').setValue('distinct');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings', expect.objectContaining({enabled:false,peer_routing:'distinct',channels:{Public:'*** REDACTED ***'},mappings:[]}));
  wrapper.unmount();
});

it('shows saved and active modes separately and displays only the running public marker', async () => {
  const settings = {enabled:true,origin_home:'a',peer_routing:'legacy',channels:{},mappings:[]};
  const marker = '42'.repeat(32);
  vi.mocked(ApiService.get).mockResolvedValueOnce({success:true,data:{settings,radio_ids:['a','b'],running:true,active_settings:{...settings,peer_routing:'distinct'},crossing_route_id:marker,restart_required:true}}).mockRejectedValue(new Error('offline'));
  const wrapper = mount(BridgeSettings); await flushPromises();
  expect(wrapper.get<HTMLSelectElement>('[data-testid=peer-routing]').element.value).toBe('legacy');
  expect(wrapper.get('[data-testid=running-peer-routing]').text()).toContain('Distinct local and crossing routes');
  expect(wrapper.get('[data-testid=crossing-route-id]').text()).toContain(marker);
  expect(wrapper.get('[data-testid=crossing-route-id]').text()).toContain('not a credential or a signed endpoint identity');
  await wrapper.findAll('button').find(button => button.text() === 'Refresh running state')!.trigger('click'); await flushPromises();
  expect(wrapper.find('[data-testid=crossing-route-id]').exists()).toBe(false);
  wrapper.unmount();
});

it('changing routing mode leaves channels, mappings and directions intact', async () => {
  const mappings = [{source_radio:'a',target_radio:'b',source_channel:'Public',target_channel:'Public',enabled:false}];
  const direct_routes = [{source_radio:'b',target_radio:'a',enabled:false}];
  vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{settings:{enabled:true,origin_home:'a',channels:{Public:'*** REDACTED ***'},mappings,direct_routes},radio_ids:['a','b']}});
  const wrapper = mount(BridgeSettings); await flushPromises();
  await wrapper.get('[data-testid=peer-routing]').setValue('distinct');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({peer_routing:'distinct',channels:{Public:'*** REDACTED ***'},mappings,direct_routes,protocols:{discovery:false,repeater_admin:false,trace:false}}));
  wrapper.unmount();
});
