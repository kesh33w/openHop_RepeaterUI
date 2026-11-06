import { it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BrokerEditModal from '@/components/modals/BrokerEditModal.vue';

it('lets the operator edit the existing broker destination, radio and region together', async () => {
  const wrapper=mount(BrokerEditModal,{props:{show:true,isNew:false,broker:{_id:1,name:'SacMesh SMF',enabled:false,host:'mqtt.sacmesh.org',port:443,format:'letsmesh',transport:'websockets',retain_status:false,neighbors:false,tls:{enabled:true,insecure:false},radio_id:'host-rf',iata_code:'SMF'},radioOptions:[{id:'host-rf',label:'Sacramento'},{id:'bay',label:'Bay'}]},global:{stubs:{Teleport:true}}});
  expect(wrapper.get('[data-testid=observer-radio]').text()).toContain('Sacramento');
  await wrapper.get('[data-testid=observer-radio]').setValue('bay');
  await wrapper.get('[data-testid=observer-iata]').setValue('SFO');
  await wrapper.get('form').trigger('submit');
  expect(wrapper.emitted('done')?.[0]?.[0]).toMatchObject({host:'mqtt.sacmesh.org',radio_id:'bay',iata_code:'SFO'});
  wrapper.unmount();
});
