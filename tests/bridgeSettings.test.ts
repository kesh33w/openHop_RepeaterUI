import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSystemStore } from '@/stores/system';
import { flushPromises, mount } from '@vue/test-utils';
import BridgeSettings from '@/components/configuration/BridgeSettings.vue';
import ApiService from '@/utils/api';
import type { BridgeMapping } from '@/generated/openapi';
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
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
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

it('trims a new channel name and preserves its disabled state', async () => {
  const wrapper = mount(BridgeSettings); await flushPromises();
  await wrapper.get('[data-testid=add-connection]').trigger('click');
  await wrapper.get('[data-testid=new-channel-a]').setValue('');
  await wrapper.get('[data-testid=new-name-a]').setValue(' Y ');
  await wrapper.get('[data-testid=new-key-a]').setValue('a'.repeat(32));
  await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
  const row = wrapper.findAll('.channel-row')[1]!;
  await row.get('input[type=checkbox]').setValue(false);
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings', expect.objectContaining({
    disabled_channels: ['Y'], channels: {Public:'*** REDACTED ***', Y:'a'.repeat(32)},
    mappings: [
      {source_radio:'a',target_radio:'b',source_channel:'Y',target_channel:'Y',enabled:true},
      {source_radio:'b',target_radio:'a',source_channel:'Y',target_channel:'Y',enabled:true},
    ],
  }));
  wrapper.unmount();
});

it('reports saved but unverified after the post-save refresh fails, and retains new keys safely', async () => {
  vi.mocked(ApiService.get).mockResolvedValueOnce({success:true,data:{settings:{enabled:false,channels:{Public:'*** REDACTED ***'},mappings:[]},radio_ids:['a','b'],running:true,restart_required:false,controls_available:true}}).mockRejectedValue(new Error('offline'));
  const wrapper = mount(BridgeSettings); await flushPromises();
  await wrapper.get('[data-testid=add-connection]').trigger('click');
  await wrapper.get('[data-testid=new-channel-a]').setValue('');
  await wrapper.get('[data-testid=new-name-a]').setValue('New');
  await wrapper.get('[data-testid=new-key-a]').setValue('b'.repeat(32));
  await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
  const row = wrapper.findAll('.channel-row')[1]!;
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


describe('rebuilt bridge editor safety', () => {
  function current() {
    return {
      settings: {
        enabled: true, origin_home: 'a', paused: false,
        channels: {Public: '*** REDACTED ***'},
        mappings: [{source_radio:'a',target_radio:'b',source_channel:'Public',target_channel:'Public'}],
        direct_routes: [{source_radio:'b',target_radio:'a'}],
        echo_database: '/tmp/echo.sqlite',
      },
      radio_ids: ['a','b'], running: true, paused: false,
      restart_required: false, controls_available: true,
    };
  }

  it('keeps drafts and replacement keys through status refresh without mutating the server snapshot', async () => {
    const snapshot = current();
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:snapshot});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('[data-testid=origin-home]').setValue('b');
    await wrapper.get('.mapping-row input[type=checkbox]').setValue(false);
    await wrapper.get('.direct-route-row input[type=checkbox]').setValue(false);
    await wrapper.get('.channel-row input[type=password]').setValue('a'.repeat(32));
    await wrapper.findAll('button').find(button => button.text() === 'Refresh running state')!.trigger('click');
    await flushPromises();
    expect(wrapper.get<HTMLSelectElement>('[data-testid=origin-home]').element.value).toBe('b');
    expect(wrapper.get<HTMLInputElement>('.mapping-row input[type=checkbox]').element.checked).toBe(false);
    expect(wrapper.get<HTMLInputElement>('.direct-route-row input[type=checkbox]').element.checked).toBe(false);
    expect(wrapper.get<HTMLInputElement>('.channel-row input[type=password]').element.value).toBe('a'.repeat(32));
    expect(snapshot.settings.mappings[0]).not.toHaveProperty('enabled');
    expect(snapshot.settings.direct_routes[0]).not.toHaveProperty('enabled');
    expect(ApiService.post).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does not send the independently controlled pause state in a settings save', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:current()});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.any(Object));
    expect(vi.mocked(ApiService.post).mock.calls[0]![1]).not.toHaveProperty('paused');
    wrapper.unmount();
  });

  it.each(['lost response', 'unknown response'])('blocks another settings write after an unconfirmed %s', async (failure) => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:current()});
    if (failure === 'lost response') vi.mocked(ApiService.post).mockRejectedValue(new Error('connection lost'));
    else vi.mocked(ApiService.post).mockResolvedValue({success:false,outcome:'unknown'});
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('.channel-row input[type=password]').setValue('b'.repeat(32));
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.text()).toMatch(/not confirmed|unconfirmed/i);
    expect(wrapper.text()).not.toContain('Not saved.');
    expect(wrapper.get<HTMLInputElement>('.channel-row input[type=password]').element.value).toBe('');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledTimes(1);
    // A routine status read cannot silently turn a lost write response into permission to retry.
    await wrapper.findAll('button').find(button => button.text() === 'Refresh running state')!.trigger('click');
    await flushPromises();
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(ApiService.post).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('keeps edits when discard is cancelled and reloads only after confirmation', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:current()});
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('[data-testid=origin-home]').setValue('b');
    const discard = wrapper.findAll('button').find(button => button.text() === 'Discard changes')!;
    await discard.trigger('click'); await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(ApiService.get).toHaveBeenCalledTimes(1);
    expect(wrapper.get<HTMLSelectElement>('[data-testid=origin-home]').element.value).toBe('b');
    confirm.mockReturnValue(true);
    await discard.trigger('click'); await flushPromises();
    expect(ApiService.get).toHaveBeenCalledTimes(2);
    expect(wrapper.get<HTMLSelectElement>('[data-testid=origin-home]').element.value).toBe('a');
    confirm.mockRestore();
    wrapper.unmount();
  });

  it('reveals a hidden invalid replacement key before attempting a save', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:current()});
    const wrapper = mount(BridgeSettings, {attachTo: document.body}); await flushPromises();
    await wrapper.get('[data-testid=bridge-nav-channels]').trigger('click');
    await wrapper.get('.channel-row input[type=password]').setValue('invalid-key');
    await wrapper.get('[data-testid=bridge-nav-overview]').trigger('click');
    expect(wrapper.get('[data-panel=channels]').isVisible()).toBe(false);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.get('[data-panel=channels]').isVisible()).toBe(true);
    expect(ApiService.post).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('blocks leaving during a settings write and protects dirty browser navigation', async () => {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:current()});
    let finish!: (value: {success: boolean}) => void;
    vi.mocked(ApiService.post).mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    const wrapper = mount(BridgeSettings); await flushPromises();
    await wrapper.get('[data-testid=origin-home]').setValue('b');
    const unload = new Event('beforeunload', {cancelable:true});
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await wrapper.get('form').trigger('submit');
    const accept = vi.fn();
    const cancel = vi.fn();
    (wrapper.vm as unknown as {requestLeave: (accept: () => void, cancel: () => void) => void}).requestLeave(accept, cancel);
    expect(accept).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    finish({success:true}); await flushPromises();
    wrapper.unmount();
  });
});

it('preserves replacement keys and focuses a revealed field when local validation blocks saving', async () => {
  const wrapper = mount(BridgeSettings, {attachTo: document.body}); await flushPromises();
  await wrapper.get('[data-testid=bridge-nav-channels]').trigger('click');
  await wrapper.get('.channel-row input[type=password]').setValue('c'.repeat(32));
  const limit = wrapper.get<HTMLInputElement>('[data-panel=safeguards] input[type=number]');
  await limit.setValue('0');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).not.toHaveBeenCalled();
  expect(wrapper.get('[data-panel=safeguards]').isVisible()).toBe(true);
  expect(document.activeElement).toBe(limit.element);
  expect(wrapper.get<HTMLInputElement>('.channel-row input[type=password]').element.value).toBe('c'.repeat(32));
  await limit.setValue('12');
  await wrapper.get('form').trigger('submit'); await flushPromises();
  expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings', expect.objectContaining({channels:{Public:'c'.repeat(32)}}));
  wrapper.unmount();
});

describe('channel connection editor', () => {
  const forward: BridgeMapping = {source_radio:'a',target_radio:'b',source_channel:'Public',target_channel:'Private'};
  const reverse: BridgeMapping = {source_radio:'b',target_radio:'a',source_channel:'Private',target_channel:'Public'};
  async function editor(mappings: BridgeMapping[] = []) {
    vi.mocked(ApiService.get).mockResolvedValue({success:true,data:{
      settings:{enabled:false,channels:{Public:'*** REDACTED ***',Private:'*** REDACTED ***',Other:'*** REDACTED ***'},mappings},
      radio_ids:['a','b','c'],running:true,restart_required:false,controls_available:true,
    }});
    const wrapper = mount(BridgeSettings);
    await flushPromises();
    await wrapper.get('[data-testid=bridge-nav-channels]').trigger('click');
    return wrapper;
  }
  async function save(wrapper: Awaited<ReturnType<typeof editor>>) {
    await wrapper.get('form').trigger('submit');
    await flushPromises();
  }

  it('groups nonadjacent reciprocal routes and preserves exact no-op payload order and disabled flags', async () => {
    const mappings = [
      {...forward, future:{mode:'keep'}},
      {...forward,source_radio:'c',enabled:false},
      {...reverse,enabled:false},
    ];
    const wrapper = await editor(mappings);
    expect(wrapper.findAll('.connection-card')).toHaveLength(2);
    expect(wrapper.findAll('.connection-card')[0]!.text()).toContain('Cross-channel');
    expect(wrapper.findAll('.connection-card')[0]!.text()).toContain('A → B only');
    expect(wrapper.findAll('.connection-card')[1]!.text()).toContain('Disabled');
    await save(wrapper);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({mappings}));
    expect(mappings[0]).not.toHaveProperty('enabled');
    wrapper.unmount();
  });

  it('keeps a loaded one-way route one-way until reverse is explicitly enabled', async () => {
    const wrapper = await editor([forward]);
    const directions = wrapper.findAll<HTMLInputElement>('.connection-directions input');
    expect(directions.map(input => input.element.checked)).toEqual([true,false]);
    await save(wrapper);
    expect(ApiService.post).toHaveBeenLastCalledWith('/update_bridge_settings',expect.objectContaining({mappings:[forward]}));
    await wrapper.findAll('.connection-directions input')[1]!.setValue(true);
    await save(wrapper);
    expect(ApiService.post).toHaveBeenLastCalledWith('/update_bridge_settings',expect.objectContaining({mappings:[forward,{...reverse,enabled:true}]}));
    wrapper.unmount();
  });

  it('edits both reciprocal endpoints without changing enable flags or unknown fields', async () => {
    const extraForward = {...forward,future:'keep'};
    const wrapper = await editor([extraForward,{...reverse,enabled:false}]);
    const selects = wrapper.findAll('.connection-card select');
    await selects[0]!.setValue('c');
    await selects[3]!.setValue('Other');
    await save(wrapper);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({mappings:[
      {...extraForward,source_radio:'c',target_channel:'Other'},
      {...reverse,target_radio:'c',source_channel:'Other',enabled:false},
    ]}));
    wrapper.unmount();
  });

  it.each(['Public','Private'])('creates both directions for stored channel connection Public to %s', async (target) => {
    const wrapper = await editor();
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-testid=new-channel-b]').setValue(target);
    expect(wrapper.get('[data-new-connection]').text()).toContain(target === 'Public' ? 'Same channel' : 'Cross-channel');
    await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
    expect(wrapper.find('[data-new-connection]').exists()).toBe(false);
    expect(wrapper.get('.connection-card').text()).toContain('Two-way');
    expect(ApiService.post).not.toHaveBeenCalled();
    await save(wrapper);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({mappings:[
      {...forward,target_channel:target,enabled:true},
      {...reverse,source_channel:target,enabled:true},
    ]}));
    wrapper.unmount();
  });

  it('creates two named channels with distinct keys atomically as a translation', async () => {
    const wrapper = await editor();
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-testid=new-channel-a]').setValue('');
    await wrapper.get('[data-testid=new-name-a]').setValue(' Local ');
    await wrapper.get('[data-testid=new-key-a]').setValue('a'.repeat(32));
    await wrapper.get('[data-new-connection] input[type=checkbox]').setValue(false);
    await wrapper.get('[data-testid=new-channel-b]').setValue('');
    await wrapper.get('[data-testid=new-name-b]').setValue(' Remote ');
    await wrapper.get('[data-testid=new-key-b]').setValue('b'.repeat(32));
    expect(wrapper.get('[data-new-connection]').text()).toContain('Cross-channel');
    await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
    expect(wrapper.findAll('.channel-row')).toHaveLength(5);
    expect(wrapper.get('.connection-card').text()).toContain('Cross-channel');
    await save(wrapper);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({
      channels:{Public:'*** REDACTED ***',Private:'*** REDACTED ***',Other:'*** REDACTED ***',Local:'a'.repeat(32),Remote:'b'.repeat(32)},
      mappings:[
        {...forward,source_channel:'Local',target_channel:'Remote',enabled:true},
        {...reverse,source_channel:'Remote',target_channel:'Local',enabled:true},
      ],
    }));
    wrapper.unmount();
  });

  it('blocks global saving during a builder draft and cancel clears it without making settings dirty', async () => {
    const wrapper = await editor();
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-testid=new-channel-a]').setValue('');
    await wrapper.get('[data-testid=new-name-a]').setValue('Temporary');
    await wrapper.get('[data-testid=new-key-a]').setValue('b'.repeat(32));
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined();
    await save(wrapper);
    expect(ApiService.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Finish adding the channel link or cancel');
    await wrapper.get('[data-new-connection]').findAll('button').find(button => button.text() === 'Cancel')!.trigger('click');
    expect(wrapper.find('[data-new-connection]').exists()).toBe(false);
    expect(wrapper.get('.save-bar strong').text()).toBe('Saved settings');
    expect(wrapper.findAll('.channel-row')).toHaveLength(3);
    expect(wrapper.findAll('.connection-card')).toHaveLength(0);
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-testid=new-channel-a]').setValue('');
    expect(wrapper.get<HTMLInputElement>('[data-testid=new-name-a]').element.value).toBe('');
    expect(wrapper.get<HTMLInputElement>('[data-testid=new-key-a]').element.value).toBe('');
    wrapper.unmount();
  });

  it('cancel keeps previously edited settings dirty', async () => {
    const wrapper = await editor([forward]);
    await wrapper.get('.connection-directions input').setValue(false);
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-new-connection]').findAll('button').find(button => button.text() === 'Cancel')!.trigger('click');
    expect(wrapper.get('.save-bar strong').text()).toBe('Unsaved changes');
    await save(wrapper);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({mappings:[{...forward,enabled:false}]}));
    wrapper.unmount();
  });

  it.each(['duplicate','ambiguous'])('rejects a %s connection atomically without adding its keys', async (kind) => {
    const wrapper = await editor([forward]);
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    if (kind === 'duplicate') await wrapper.get('[data-testid=new-channel-b]').setValue('Private');
    else {
      await wrapper.get('[data-testid=new-channel-b]').setValue('');
      await wrapper.get('[data-testid=new-name-b]').setValue('New target');
      await wrapper.get('[data-testid=new-key-b]').setValue('a'.repeat(32));
    }
    await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
    expect(wrapper.get('[data-new-connection]').text()).toContain('already uses');
    expect(wrapper.findAll('.channel-row')).toHaveLength(3);
    expect(wrapper.findAll('.connection-card')).toHaveLength(1);
    expect(ApiService.post).not.toHaveBeenCalled();
    await wrapper.get('[data-new-connection]').findAll('button').find(button => button.text() === 'Cancel')!.trigger('click');
    await save(wrapper);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({mappings:[forward],channels:{Public:'*** REDACTED ***',Private:'*** REDACTED ***',Other:'*** REDACTED ***'}}));
    wrapper.unmount();
  });

  it.each([
    ['identical', 'a'.repeat(32)],
    ['case-insensitive', 'A'.repeat(32)],
    ['zero-padded', 'a'.repeat(32) + '0'.repeat(32)],
  ])('rejects %s effective keys for distinct new channel names atomically', async (_, duplicateKey) => {
    const wrapper = await editor();
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-testid=new-channel-a]').setValue('');
    await wrapper.get('[data-testid=new-name-a]').setValue('Local');
    await wrapper.get('[data-testid=new-key-a]').setValue('a'.repeat(32));
    await wrapper.get('[data-new-connection] input[type=checkbox]').setValue(false);
    await wrapper.get('[data-testid=new-channel-b]').setValue('');
    await wrapper.get('[data-testid=new-name-b]').setValue('Remote');
    await wrapper.get('[data-testid=new-key-b]').setValue(duplicateKey);
    await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
    expect(wrapper.find('[data-new-connection]').exists()).toBe(true);
    expect(wrapper.findAll('.channel-row')).toHaveLength(3);
    expect(wrapper.findAll('.connection-card')).toHaveLength(0);
    expect(ApiService.post).not.toHaveBeenCalled();
    // Correcting one key allows the same draft to be added without leaving partial state.
    await wrapper.get('[data-testid=new-key-b]').setValue('b'.repeat(32));
    await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
    expect(wrapper.find('[data-new-connection]').exists()).toBe(false);
    expect(wrapper.findAll('.channel-row')).toHaveLength(5);
    expect(wrapper.findAll('.connection-card')).toHaveLength(1);
    wrapper.unmount();
  });

  it.each(['A'.repeat(32), 'a'.repeat(32) + '0'.repeat(32)])('blocks duplicate typed replacement keys on save: %s', async (duplicateKey) => {
    const wrapper = await editor([forward,reverse]);
    const inputs = wrapper.findAll('.channel-row input[type=password]');
    await inputs[0]!.setValue('a'.repeat(32));
    await inputs[1]!.setValue(duplicateKey);
    await save(wrapper);
    expect(ApiService.post).not.toHaveBeenCalled();
    // Local validation retains typed keys so the user can correct them.
    expect(wrapper.findAll<HTMLInputElement>('.channel-row input[type=password]').map(input => input.element.value)).toEqual(['a'.repeat(32),duplicateKey,'']);
    await inputs[1]!.setValue('b'.repeat(32));
    await save(wrapper);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({
      channels:{Public:'a'.repeat(32),Private:'b'.repeat(32),Other:'*** REDACTED ***'},
      mappings:[forward,reverse],
    }));
    wrapper.unmount();
  });

  it('rejects a new channel key that duplicates a known stored-channel replacement', async () => {
    const wrapper = await editor();
    await wrapper.findAll('.channel-row input[type=password]')[0]!.setValue('a'.repeat(32));
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-testid=new-channel-b]').setValue('');
    await wrapper.get('[data-testid=new-name-b]').setValue('Remote');
    await wrapper.get('[data-testid=new-key-b]').setValue('A'.repeat(32) + '0'.repeat(32));
    await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
    expect(wrapper.find('[data-new-connection]').exists()).toBe(true);
    expect(wrapper.findAll('.channel-row')).toHaveLength(3);
    expect(wrapper.findAll('.connection-card')).toHaveLength(0);
    expect(ApiService.post).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('rejects invalid new keys without adding either endpoint', async () => {
    const wrapper = await editor();
    await wrapper.get('[data-testid=add-connection]').trigger('click');
    await wrapper.get('[data-testid=new-channel-a]').setValue('');
    await wrapper.get('[data-testid=new-name-a]').setValue('New');
    await wrapper.get('[data-testid=new-key-a]').setValue('not-hex');
    await wrapper.get('[data-testid=confirm-add-connection]').trigger('click');
    expect(wrapper.get('[data-new-connection]').text()).toContain('hexadecimal key');
    expect(wrapper.findAll('.channel-row')).toHaveLength(3);
    expect(wrapper.findAll('.connection-card')).toHaveLength(0);
    expect(ApiService.post).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('protects keys used by either endpoint and removes both directions without deleting keys', async () => {
    const wrapper = await editor([forward,reverse]);
    const keys = wrapper.findAll('.channel-row');
    expect(keys[0]!.get('button').attributes('disabled')).toBeDefined();
    expect(keys[1]!.get('button').attributes('disabled')).toBeDefined();
    expect(keys[2]!.get('button').attributes('disabled')).toBeUndefined();
    await wrapper.get('.connection-card .remove-button').trigger('click');
    expect(wrapper.findAll('.connection-card')).toHaveLength(0);
    expect(wrapper.findAll('.channel-row')).toHaveLength(3);
    expect(keys[0]!.get('button').attributes('disabled')).toBeUndefined();
    await save(wrapper);
    expect(ApiService.post).toHaveBeenCalledWith('/update_bridge_settings',expect.objectContaining({mappings:[],channels:{Public:'*** REDACTED ***',Private:'*** REDACTED ***',Other:'*** REDACTED ***'}}));
    wrapper.unmount();
  });
});
