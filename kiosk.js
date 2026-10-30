import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Public-only kiosk page. It intentionally does not load admin or signup controls.
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[character]));
const configOkay = typeof SUPABASE_URL === 'string' && SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('YOUR_') && !SUPABASE_URL.endsWith('/rest/v1/') &&
  typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_ANON_KEY.includes('YOUR_');
const db = configOkay ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const TOPIC = 'vb:intermediate-queue:v1'; // Same public broadcast topic as the main app.
const FALLBACK_MS = 60_000;
let channel = null;
let isLive = false;
let busy = false;
let isLoading = false;
let needsAnotherLoad = false;
let reloadTimer = null;
let retryTimer = null;
let lastReload = 0;
let waiting = [];
let hasHistory = false;
let maxSize = 6;
let themeName = 'default';

function status(message, isError=false) {
  $('kioskStatus').textContent = message;
  $('kioskStatus').dataset.error = String(isError);
}
function connection(value) {
  const text = {
    connecting:'◌ Connecting', live:'● Live updates', fallback:'◌ Backup refresh · 60s',
    offline:'○ Offline', paused:'◌ Paused'
  };
  $('kioskConnection').textContent = text[value] || text.fallback;
  $('kioskConnection').dataset.state = value;
}
function showActions() {
  $('kioskPrevious').disabled = busy || !db || !hasHistory;
  $('kioskNext').disabled = busy || !db || waiting.length === 0;
}
function draw() {
  const first = waiting[0];
  if (!first) {
    $('kioskTeamName').textContent = 'No teams waiting';
    $('kioskPlayerCount').textContent = '0 players';
    $('kioskRoster').innerHTML = '<div class="kiosk-empty">There are no teams in the queue yet.</div>';
    showActions();
    return;
  }
  $('kioskTeamName').textContent = first.name;
  const count = first.members.length;
  $('kioskPlayerCount').textContent = `${count} / ${maxSize} players`;
  $('kioskRoster').innerHTML = count
    ? first.members.map(person => `<article class="kiosk-person"><div class="kiosk-name">${escapeHtml(person.name)}${person.isSub ? '<span class="kiosk-sub">SUB</span>' : ''}</div><div class="kiosk-position">${escapeHtml(person.preferred_position || 'Flexible / Any')}</div></article>`).join('')
    : '<div class="kiosk-empty">This team does not have any players signed up yet.</div>';
  showActions();
}
function scheduleLoad(delay=350) {
  if (!db || document.hidden || reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    lastReload = Date.now();
    void load();
  }, Math.max(delay, 1000-(Date.now()-lastReload), 0));
}
async function load() {
  if (!db || document.hidden) return;
  if (isLoading) { needsAnotherLoad = true; return; }
  isLoading = true;
  try {
    const results = await Promise.all([
      db.from('teams').select('id,name,status,queue_order,created_at').eq('status','waiting').order('queue_order'),
      db.from('players').select('id,team_id,name,preferred_position,created_at').order('created_at'),
      db.from('team_subs').select('id,team_id,name,preferred_position,created_at').order('created_at'),
      db.from('queue_settings').select('max_team_size,site_theme').eq('id',true).maybeSingle(),
      db.from('completed_teams').select('id').order('id',{ascending:false}).limit(1)
    ]);
    for (const result of results) if (result.error) throw result.error;
    const [teamRows, playerRows, subRows, settings, history] = results;
    const members = new Map();
    for (const row of playerRows.data ?? []) {
      if (!members.has(row.team_id)) members.set(row.team_id, []);
      members.get(row.team_id).push({...row,isSub:false});
    }
    for (const row of subRows.data ?? []) {
      if (!members.has(row.team_id)) members.set(row.team_id, []);
      members.get(row.team_id).push({...row,isSub:true});
    }
    waiting = (teamRows.data ?? []).slice().sort((a,b)=>
      Number(a.queue_order)-Number(b.queue_order) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
      String(a.id).localeCompare(String(b.id))
    ).map(team=>({...team,members:members.get(team.id) || []}));
    hasHistory = (history.data || []).length > 0;
    maxSize = Number(settings.data?.max_team_size) || 6;
    themeName = String(settings.data?.site_theme || 'default');
    document.documentElement.dataset.theme = themeName;
    draw();
    $('kioskUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    if (!busy) status('');
  } catch(error) {
    status(`Couldn't refresh queue: ${error?.message || 'Connection error'}`, true);
    $('kioskUpdated').textContent = 'Refresh unsuccessful — will retry';
  } finally {
    isLoading = false;
    if (needsAnotherLoad) { needsAnotherLoad = false; scheduleLoad(0); }
  }
}
async function rotate(which) {
  if (!db || busy) return;
  if (which === 'advance' && waiting.length === 0) return;
  if (which === 'undo' && !hasHistory) return;
  busy = true;
  showActions();
  status(which === 'advance' ? 'Moving to the next team…' : 'Restoring previous team…');
  try {
    const {error} = await db.rpc(which === 'advance' ? 'advance_global_queue' : 'undo_global_queue',{});
    if (error) throw error;
    await load();
    status(which === 'advance' ? 'Queue advanced.' : 'Previous team restored with its players.');
  } catch(error) {
    status(`Could not ${which === 'advance' ? 'advance' : 'undo'}: ${error?.message || 'Unknown error'}`,true);
  } finally {
    busy = false;
    showActions();
  }
}
$('kioskNext').addEventListener('click',()=>void rotate('advance'));
$('kioskPrevious').addEventListener('click',()=>void rotate('undo'));

// Browsers only permit fullscreen following a tap. On unsupported devices,
// including many iPhone Safari versions, this button is hidden.
const fullscreenButton = $('fullscreenBtn');
if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
  fullscreenButton.hidden = false;
  const updateFullscreen = () => {
    fullscreenButton.textContent = document.fullscreenElement ? '↙ Exit fullscreen' : '⛶ Fullscreen';
  };
  fullscreenButton.addEventListener('click',async()=>{
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch(error) {
      status('Fullscreen is unavailable in this browser. Try browser fullscreen or add to Home Screen.',true);
    }
  });
  document.addEventListener('fullscreenchange',updateFullscreen);
}

function scheduleRetry() {
  if (retryTimer || document.hidden || !navigator.onLine) return;
  retryTimer = setTimeout(()=>{retryTimer=null; if (!isLive) void reconnect();},15_000);
}
function subscribe() {
  if (!db || channel || document.hidden || !navigator.onLine) return;
  connection('connecting');
  const nextChannel = db.channel(TOPIC,{config:{private:false}});
  channel = nextChannel;
  nextChannel.on('broadcast',{event:'queue_changed'},()=>scheduleLoad(400));
  nextChannel.subscribe(state=>{
    if (channel!==nextChannel) return;
    if (state==='SUBSCRIBED') {
      isLive=true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer=null;
      connection('live');
      scheduleLoad(0);
    } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(state)) {
      isLive=false;
      connection(navigator.onLine?'fallback':'offline');
      scheduleRetry();
    }
  });
}
async function unsubscribe() {
  const prior = channel;
  channel=null;
  isLive=false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer=null;
  if (prior) try { await db.removeChannel(prior); } catch (_) {}
}
async function reconnect() {
  await unsubscribe();
  if (!document.hidden && navigator.onLine) subscribe();
}

if (!db) {
  status('Database not connected. Check your existing config.js file.',true);
  $('kioskTeamName').textContent = 'Connection needed';
  $('kioskRoster').innerHTML = '<div class="kiosk-empty">The kiosk requires the same Supabase configuration as the homepage.</div>';
  connection('offline');
} else {
  await load();
  subscribe();
  setInterval(()=>{
    if (document.hidden) return;
    scheduleLoad(0);
    if (!isLive && navigator.onLine && !retryTimer) void reconnect();
  },FALLBACK_MS);
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer=null;
      connection('paused');
      void unsubscribe();
    } else {
      subscribe();
      scheduleLoad(0);
    }
  });
  window.addEventListener('online',()=>{void reconnect();scheduleLoad(0);});
  window.addEventListener('offline',()=>connection('offline'));
  window.addEventListener('pageshow',event=>{if (event.persisted && !document.hidden){subscribe();scheduleLoad(0);}});
}
