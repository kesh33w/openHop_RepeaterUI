from playwright.sync_api import sync_playwright
import json,base64,os
from pathlib import Path
module=str(Path(__file__).resolve().parents[2] / 'public/assets/cad-mode-control-v1.js')
radios=[dict(radio_id=x,label=x,frequency=910525000,spreading_factor=7,bandwidth=250000,coding_rate=5,current_cad_peak=22,current_cad_min=10,cad_symbol_num=2,supports_cad=True,cad_enabled=True,supports_cad_toggle=(x!='unsupported'),cad_mode_explicit=False) for x in ['radio-a','radio-b','unsupported']]
posts=[];fail=False
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN', '/usr/bin/google-chrome'),headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1366,'height':768})
 token='x.'+base64.urlsafe_b64encode(json.dumps({'exp':9999999999,'sub':'layout-test'}).encode()).decode()+'.x'
 page.add_init_script('localStorage.setItem("pymc_jwt_token",'+json.dumps(token)+')')
 def api(r):
  url=r.request.url
  if 'cad-calibration-stream' in url:
   r.fulfill(status=200,content_type='text/event-stream',body=': keepalive\n\n');return
  if 'set_cad_enabled' in url:
   posts.append(r.request.post_data_json)
   d={'success':False,'error':'ACK unsupported'} if fail else {'success':True,'settings':r.request.post_data_json}
  elif 'cad-radios' in url or 'cad_radios' in url:d={'success':True,'data':{'radios':radios,'default_radio_id':'radio-a','running':False}}
  else:d={'success':True,'setup_required':False,'needs_setup':False,'radios':radios,'config':{},'status':'idle'}
  r.fulfill(status=200,content_type='application/json',body=json.dumps(d))
 page.route('**/api/**',api)
 page.route('http://cad.test/',lambda r:r.fulfill(content_type='text/html',body='<html><body><div><select id="cad-radio"><option value="radio-a">A</option><option value="radio-b">B</option><option value="unsupported">Unsupported</option></select></div></body></html>'))
 page.goto('http://cad.test/')
 page.add_script_tag(path=module,type='module');page.wait_for_timeout(600)
 c=page.locator('#cad-before-transmit');assert c.is_checked() and c.is_enabled();assert not posts
 c.uncheck();page.get_by_role('button',name='Save CAD mode').click();page.wait_for_timeout(300)
 assert posts==[{'radio_id':'radio-a','enabled':False}],posts
 assert 'Current mode: Off.' in page.locator('#cad-mode-control').inner_text()
 page.locator('#cad-radio').select_option('radio-b');page.wait_for_timeout(300);assert c.is_checked()
 fail=True;c.uncheck();page.get_by_role('button',name='Save CAD mode').click();page.wait_for_timeout(300)
 assert 'Not saved: ACK unsupported' in page.locator('#cad-mode-control').inner_text();assert c.is_checked()
 page.locator('#cad-radio').select_option('unsupported');page.wait_for_timeout(300);assert c.is_disabled()
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(400)
 page.screenshot(path='/tmp/cad-mode-mobile.png',full_page=True)
 print('PASS: no startup mutation, selected-radio save, supported/unsupported modes, ACK error, 390px render; mocked API only')
 b.close()
