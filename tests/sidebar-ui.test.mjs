// Run against a local production build:
// SIDEBAR_UI_URL=http://127.0.0.1:3100 node --test tests/sidebar-ui.test.mjs
// All API requests are fulfilled by synthetic fixtures in the browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const url = process.env.SIDEBAR_UI_URL;
const session = `sidebar-ui-${process.pid}`;
const browser = (...args) => execFileSync('npm', ['exec', '--no', '--', 'agent-browser', '--session', session, ...args], { encoding: 'utf8', timeout: 45000 }).trim();
const evaluate = expression => JSON.parse(browser('eval', expression));
const layout = () => evaluate(`(() => {
  const sidebar = document.querySelector('.sidebar');
  const workspace = document.querySelector('.workspace');
  return { sidebar: sidebar.getBoundingClientRect().width, workspace: workspace.getBoundingClientRect().width,
    overflow: document.documentElement.scrollWidth > innerWidth, view: workspace.dataset.view,
    collapsed: document.querySelector('.app-shell').classList.contains('sidebar-collapsed') };
})()`);
const branding = () => evaluate(`(() => {
  const full = document.querySelector('.sidebar .brand-name');
  const icon = document.querySelector('.sidebar .brand-mark img');
  const state = image => { const box = image.getBoundingClientRect(); return {
    visible: box.width > 0 && box.height > 0, loaded: image instanceof HTMLImageElement ? image.complete && image.naturalWidth > 0 : true, text: image.textContent, color: getComputedStyle(image).color,
    width: box.width, height: box.height, src: image.getAttribute('src'), fit: getComputedStyle(image).objectFit, background: getComputedStyle(image).backgroundColor,
  }; };
  const logo = icon.getBoundingClientRect(), sidebar = document.querySelector('.sidebar').getBoundingClientRect(), toggle = document.querySelector('.sidebar-toggle').getBoundingClientRect();
  return { full: state(full), icon: state(icon), centered: Math.abs(logo.x + logo.width/2 - sidebar.x - sidebar.width/2)<1,
    toggleOverlap: logo.right>toggle.left && logo.left<toggle.right && logo.bottom>toggle.top && logo.top<toggle.bottom,
    iconBacking: getComputedStyle(icon.parentElement).backgroundColor };

})()`);
const fixture = role => ({
  user: { role, email: 'sidebar@example.test', name: 'Sidebar Test' },
  bookings: [{ id: 1, bookingNo: 'TEST-1', customer: 'Fixture customer', phone: '99112233', plate: '0001TEST', vehicle: 'Toyota', manufactureYear: 2010, branch: 'Яармаг', date: new Date().toISOString().slice(0, 10), time: '10:00', status: 'Баталгаажсан', totalPrice: 100, advance: 0, finalPaid: 0 }],
  preBookings: [{ id: 2, customer: 'Fixture preorder', phone: '99112233', vehicle: 'Toyota', source: 'manual', status: 'new', createdAt: new Date().toISOString(), note: '' }],
  programmingPending: 1, installationPending: 1, handoverPending: 1, outstandingBalance: 100, outstandingCount: 1,
  users: [], products: [], logs: [], rows: [{ id: 1, bookingNo: 'TEST-1', customer: 'Fixture customer', phone: '99112233', plate: '0001TEST', vehicle: 'Toyota', manufactureYear: 2010, branch: 'Яармаг', date: new Date().toISOString().slice(0, 10), time: '10:00', status: 'Баталгаажсан', productName: 'Fixture product', totalPrice: 100, advance: 0, finalPaid: 0, remaining: 100, source: 'manual' }],
  totals: { count: 1, sales: 100, advance: 0, remaining: 100, completed: 0, cancelled: 0 },
  branchSummary: [], productSummary: [], options: { branches: [], products: [] }, page: 1, pageSize: 50,
});
const mock = role => browser('network', 'route', '**/api/**', '--body', JSON.stringify(fixture(role)));
const navigate = (label, view) => {
  browser('click', `.sidebar nav button[aria-label="${label}"]`);
  browser('wait', '--fn', `document.querySelector('.workspace')?.dataset.view === '${view}'`);
  assert.equal(layout().view, view);
  assert.equal(evaluate(`document.querySelector('.sidebar button[aria-current="page"]').getAttribute('aria-label')`), label);
};

test('desktop collapse, content widths, navigation, permissions, persistence, mobile and logout', { skip: !url, timeout: 360000 }, () => {
  assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/);
  try {
    mock('admin');
    browser('set', 'viewport', '1280', '900');
    browser('open', url);
    browser('wait', '.sidebar-toggle');
    assert.equal(evaluate(`document.querySelector('[data-nextjs-dialog]') === null`), true);
    assert.equal(evaluate(`document.querySelectorAll('.sidebar nav button').length`), 7);
    for (const width of [1280, 1440, 1600, 1920]) {
      browser('set', 'viewport', String(width), '900');
      const expanded = layout();
      assert.equal(expanded.sidebar, 248);
      assert.equal(expanded.overflow, false);
      const full = branding();
      assert.equal(full.full.visible, true); assert.equal(full.icon.visible, true);
      assert.equal(full.full.text, 'GREEN ENGINE'); assert.equal(full.full.color, 'rgb(255, 255, 255)');
      assert.equal(full.icon.loaded, true); assert.ok(full.icon.src.includes('green-engine-sidebar-icon.png'));
      assert.equal(full.icon.width, full.icon.height); assert.equal(full.icon.fit, 'contain');
      assert.equal(evaluate(`getComputedStyle(document.querySelector('.sidebar .brand-mark img')).filter`), 'none');
      if (width === 1280) browser('screenshot', join(tmpdir(), 'sidebar-expanded.png'));
      assert.equal(full.full.background, 'rgba(0, 0, 0, 0)');
      browser('click', '.sidebar-toggle');
      browser('wait', '--fn', `document.querySelector('.sidebar').getBoundingClientRect().width === 80`);
      const collapsed = layout();
      assert.equal(collapsed.sidebar, 80);
      assert.ok(collapsed.workspace > expanded.workspace, `${width}: workspace expands`);
      assert.equal(collapsed.overflow, false);
      assert.equal(evaluate(`getComputedStyle(document.querySelector('.sidebar .nav-label')).display`), 'none');
      assert.equal(evaluate(`document.querySelector('.sidebar .brand-mark').getBoundingClientRect().width`), 48);
      const icon = branding();
      assert.equal(icon.full.visible, false); assert.equal(icon.icon.visible, true);
      assert.equal(icon.icon.loaded, true); assert.ok(icon.icon.src.includes('green-engine-sidebar-icon.png'));
      assert.equal(icon.icon.width, icon.icon.height); assert.equal(icon.icon.fit, 'contain');
      assert.equal(icon.centered, true); assert.equal(icon.toggleOverlap, false);
      assert.equal(icon.iconBacking, 'rgba(0, 0, 0, 0)');
      browser('click', '.sidebar-toggle');
      browser('wait', '--fn', `document.querySelector('.sidebar').getBoundingClientRect().width === 248`);
    }
    browser('click', '.sidebar-toggle');
    for (const [label, view] of [['Шинэ захиалга', 'new'], ['Урьдчилсан захиалга', 'preorders'], ['Цагийн хуваарь', 'schedule'], ['Тайлан', 'reports'], ['Эрхийн тохиргоо', 'users'], ['Үйл ажиллагааны түүх', 'audit'], ['Хяналтын самбар', 'dashboard']]) {
      navigate(label, view);
      assert.equal(layout().collapsed, true);
      assert.equal(layout().overflow, false);
      if (['preorders', 'schedule', 'reports', 'dashboard'].includes(view)) {
        for (const width of [1280, 1440, 1600, 1920]) {
          browser('set', 'viewport', String(width), '900');
          assert.equal(layout().overflow, false, `${view} at ${width}`);
          assert.equal(layout().workspace, width - 80);
        }
      }
    }
    navigate('Урьдчилсан захиалга', 'preorders');
    browser('focus', '.sidebar nav button.active');
    assert.equal(evaluate(`getComputedStyle(document.querySelector('.sidebar nav button.active'), '::after').visibility`), 'visible');
    assert.equal(evaluate(`getComputedStyle(document.querySelector('.sidebar nav button.active')).backgroundColor`), 'rgb(27, 54, 101)');
    browser('hover', '.sidebar nav button.active');
    assert.equal(evaluate(`getComputedStyle(document.querySelector('.sidebar')).overflow`), 'visible');
    browser('screenshot', join(tmpdir(), 'sidebar-collapsed.png'));
    browser('reload');
    browser('wait', '.sidebar-toggle');
    assert.equal(layout().collapsed, true);
    assert.equal(evaluate(`localStorage.getItem('sidebarCollapsed')`), 'true');
    browser('set', 'viewport', '390', '844');
    assert.equal(evaluate(`getComputedStyle(document.querySelector('.sidebar')).display`), 'none');
    assert.equal(evaluate(`getComputedStyle(document.querySelector('.sidebar-toggle')).display`), 'none');
    assert.equal(evaluate(`(() => { const img=document.querySelector('.mobile-header .brand-mark img'); return img.complete && img.naturalWidth > 0; })()`), true);
    const mobileWidth = layout().workspace;
    evaluate(`(() => { localStorage.setItem('sidebarCollapsed', 'false'); dispatchEvent(new StorageEvent('storage', { key: 'sidebarCollapsed' })); return true; })()`);
    assert.equal(layout().workspace, mobileWidth);
    evaluate(`(() => { localStorage.setItem('sidebarCollapsed', 'true'); dispatchEvent(new StorageEvent('storage', { key: 'sidebarCollapsed' })); return true; })()`);
    browser('click', '.mobile-bottom-nav button[aria-haspopup="dialog"]');
    browser('wait', '.mobile-more-sheet[open]');
    assert.equal(evaluate(`document.querySelectorAll('.mobile-more-sheet nav button').length`), 4);
    browser('click', '.mobile-more-sheet nav button[aria-label="Цагийн хуваарь"]');
    assert.equal(layout().view, 'schedule');
    assert.equal(evaluate(`document.querySelector('.mobile-more-sheet[open]') === null`), true);
    assert.equal(layout().overflow, false);
    browser('screenshot', join(tmpdir(), 'sidebar-mobile.png'));
    browser('set', 'viewport', '1280', '900');
    browser('wait', '--fn', `document.querySelector('.sidebar').getBoundingClientRect().width === 80`);
    browser('set', 'media', 'light', 'reduced-motion');
    assert.equal(evaluate(`getComputedStyle(document.querySelector('.app-shell')).transitionDuration`), '0s');
    for (const [role, count] of [['operator', 5], ['mechanic', 2]]) {
      browser('network', 'unroute', '**/api/**');
      mock(role);
      browser('reload');
      browser('wait', '.sidebar-toggle');
      assert.equal(evaluate(`document.querySelectorAll('.sidebar nav button').length`), count);
      assert.equal(layout().collapsed, true);
    }
    assert.equal(browser('errors'), '');
    // Submit to the intercepted endpoint: exercise the existing POST form without signing out a real user.
    assert.equal(evaluate(`document.querySelector('.sidebar form').method`), 'post');
    browser('click', '.sidebar .operator-signout');
    browser('wait', '--url', '**/api/auth/signout');
    assert.ok(browser('get', 'url').endsWith('/api/auth/signout'));
    browser('open', `${url.replace(/\/$/, '')}/login`);
    browser('wait', '.login-brand-logo');
    for (const width of [390, 1440]) {
      browser('set', 'viewport', String(width), '900');
      assert.equal(evaluate(`(() => { const img=document.querySelector('.login-brand-logo'); const r=img.getBoundingClientRect(); return img.complete && img.naturalWidth>0 && img.getAttribute('src').includes('green-engine-logo.png') && r.width===r.height && getComputedStyle(img).objectFit==='contain'; })()`), true);
      assert.equal(evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
      assert.equal(evaluate(`document.querySelectorAll('.login-card input').length`), 2);
    }
    assert.equal(browser('errors'), '');
    browser('screenshot', join(tmpdir(), 'branding-login.png'));
  } finally {
    browser('close');
  }
});
