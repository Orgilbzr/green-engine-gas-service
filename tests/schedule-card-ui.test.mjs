// Local production server only; all API requests use synthetic fixtures.
// SCHEDULE_UI_URL=http://127.0.0.1:3100 node --test tests/schedule-card-ui.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
const url = process.env.SCHEDULE_UI_URL;
const session = `schedule-ui-${process.pid}`;
const browser = (...args) => execFileSync('npm', ['exec', '--no', '--', 'agent-browser', '--session', session, ...args], { encoding:'utf8', timeout:45000 }).trim();
const firstCard = '.day-booked:has(.schedule-vehicle[title="Alpard10"])';
const evaluate = expression => JSON.parse(browser('eval', expression));
const date = new Date().toISOString().slice(0,10);
const nextDate = new Date(new Date(date).getTime()+86400000).toISOString().slice(0,10);
const bookings = ['Alpard10', 'Машины маш урт загвар '.repeat(8), 'Toyota Alphard Hybrid '.repeat(8)].map((vehicle,i) => ({ id:i+1, bookingNo:`TEST-HIDDEN-${i}`, customer:'Hidden customer', phone:i === 1 ? '' : '99007272', plate:i === 2 ? '1234ABC' : '3991УАХ', vehicle, branch:'16-ын салбар', date, time:'09:00', status:'Баталгаажсан', totalPrice:100, advance:0, finalPaid:0 }));
test('schedule cards, modal, keyboard, viewport and sidebar regressions', { skip:!url, timeout:360000 }, () => {
  assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/);
  try {
    browser('network','route','**/api/**','--body',JSON.stringify({ user:{role:'admin', email:'fixture@example.test', name:'Fixture'}, booking:{...bookings[0],date:nextDate}, bookings, preBookings:[], products:[], users:[], logs:[] }));
    browser('set','viewport','1280','900'); browser('open',url); browser('wait','.sidebar-toggle');
    browser('click','.sidebar nav button[aria-label="Цагийн хуваарь"]'); browser('wait','.day-booked');
    assert.equal(evaluate(`document.querySelectorAll('.day-booked').length`),3);
    const cardText = evaluate(`document.querySelector('.day-booked').innerText`);
    for (const text of ['09:00','3991УАХ','Alpard10','99007272','Хуваарь өөрчлөх']) assert.ok(cardText.includes(text));
    for (const text of ['TEST-HIDDEN','Hidden customer','16-ын салбар','Үндсэн захиалга']) assert.ok(!cardText.includes(text));
    assert.equal(evaluate(`document.querySelector('.schedule-phone').getAttribute('href')`),'tel:99007272');
    assert.equal(evaluate(`document.querySelectorAll('.day-booked')[1].querySelector('.schedule-phone')`),null);
    const baselineCss = readFileSync(new URL('../app/globals.css', import.meta.url),'utf8').split('/* Compact schedule cards;')[0];
    const heights = evaluate(`(() => {
      const card=document.querySelector('.day-booked');
      const host=document.createElement('div'); host.style.width=card.getBoundingClientRect().width+'px';
      const shadow=host.attachShadow({mode:'open'}); const style=document.createElement('style'); style.textContent=${JSON.stringify(baselineCss)};
      shadow.append(style); const old=document.createElement('button'); old.className='day-booked';
      old.innerHTML='<span class="schedule-time">09:00</span><strong>3991УАХ</strong><span>Alpard10</span><small>TEST-HIDDEN-0 · Hidden customer</small><span class="process-badge process-green">Үндсэн захиалга</span><em>Хуваарь өөрчлөх</em>';
      shadow.append(old); document.body.append(host);
      const result={before:old.getBoundingClientRect().height,after:card.getBoundingClientRect().height}; host.remove(); return result;
    })()`);
    assert.ok(heights.after < heights.before); console.log('Card heights',heights);
    const measurements = [];
    for (const width of [1280,1440,1600,1920]) {
      browser('set','viewport',String(width),'900');
      for (const collapsed of [false,true]) {
        browser('wait','--fn',`document.querySelector('.app-shell').classList.contains('sidebar-collapsed') === ${collapsed}`);
        const result = evaluate(`(() => {
          const cards=[...document.querySelectorAll('.day-booked')];
          return { overflow:document.documentElement.scrollWidth>innerWidth, workspace:document.querySelector('.workspace').getBoundingClientRect().width,
            heights:cards.map(c=>c.getBoundingClientRect().height), cardOverflow:cards.some(c=>c.scrollWidth>c.clientWidth),
            overlap:cards.some((c,i)=>i && c.getBoundingClientRect().top<cards[i-1].getBoundingClientRect().bottom),
            columns:getComputedStyle(document.querySelector('.calendar-seven')).gridTemplateColumns.split(' ').length };
        })()`);
        assert.equal(result.overflow,false); assert.equal(result.cardOverflow,false); assert.equal(result.overlap,false); assert.equal(result.columns,7);
        assert.equal(result.workspace,collapsed ? width-80 : Math.min(1600,width-248));
        measurements.push({width,collapsed,...result});
        browser('click','.sidebar-toggle');
      }
    }
    browser('focus',`${firstCard} .schedule-phone`); assert.equal(evaluate(`document.activeElement.className`),'schedule-phone');
    browser('press','Tab'); assert.equal(evaluate(`document.activeElement.className`),'schedule-action');
    browser('press','Enter'); browser('wait','.modal');
    assert.equal(evaluate(`document.querySelector('.modal .eyebrow').textContent`),'TEST-HIDDEN-0');
    assert.equal(evaluate(`document.querySelector('.modal input[type="time"]').value`),'09:00');
    browser('click','.modal .cancel'); browser('wait','--fn',`!document.querySelector('.modal')`);
    browser('screenshot',join(tmpdir(),'schedule-desktop.png'));
    browser('set','viewport','390','844');
    assert.equal(evaluate(`document.documentElement.scrollWidth>innerWidth`),false);
    assert.equal(evaluate(`[...document.querySelectorAll('.day-booked')].some(c=>c.scrollWidth>c.clientWidth)`),false);
    assert.equal(evaluate(`document.querySelectorAll('.mobile-bottom-nav button').length > 0`),true);
    browser('click',`${firstCard} .schedule-action`); browser('wait','.modal'); browser('click','.modal .cancel');
    browser('screenshot',join(tmpdir(),'schedule-mobile.png'));
    evaluate(`(() => { const original=window.fetch; window.scheduleRequests=[]; window.fetch=(url,options)=> { if(options?.method==='PATCH') window.scheduleRequests.push({url,body:JSON.parse(options.body)}); return original(url,options); }; return true; })()`);
    browser('click',`${firstCard} .schedule-action`); browser('wait','.modal');
    browser('click','.modal .shift-buttons button:last-child');
    assert.equal(evaluate(`document.querySelector('.modal input[type="date"]').value`),nextDate);
    browser('click','.modal .primary');
    browser('wait','--fn',`!document.querySelector('.modal') && document.querySelector('.calendar-day:nth-child(2) .schedule-time')?.textContent==='09:00'`);
    const requests=evaluate(`window.scheduleRequests`);
    assert.equal(requests.length,1); assert.equal(requests[0].url,'/api/bookings/1');
    assert.deepEqual(requests[0].body,{branch:'16-ын салбар',date:nextDate,time:'09:00',manufactureYear:''});
    assert.equal(browser('errors'),'');
    console.log(JSON.stringify(measurements));
  } finally { browser('close'); }
});
