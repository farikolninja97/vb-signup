import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Kiosk displays public rosters; Next requires approved Supabase admin login.
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
let kioskAdmin = false;
let isLoading = false;
let needsAnotherLoad = false;
let reloadTimer = null;
let retryTimer = null;
let lastReload = 0;
let waiting = [];
let hasHistory = false;
let previousTeam = null;
let sessionStartedAt = null;
let maxSize = 6;
let themeName = 'default';
// Fail closed: do not reveal preferred positions until settings explicitly permit them.
let showPlayerPositions = false;
document.documentElement.dataset.positions = 'hidden';

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
  $('kioskNext').innerHTML = 'Next Team <span class="kiosk-action-icon" aria-hidden="true">▶</span>';
}
function renderFollowingTeams() {
  const upcoming = waiting.slice(1, 3);
  const list = $('kioskFollowingTeams');
  if (!upcoming.length) {
    list.innerHTML = '<p class="kiosk-next-empty">No teams waiting behind this one.</p>';
    return;
  }
  list.innerHTML = upcoming.map((team, index) => {
    const players = team.members.length
      ? `<ul class="kiosk-next-players">${team.members.map(person => `<li title="${escapeHtml(person.name)}"><span>${escapeHtml(person.name)}</span>${person.isSub ? '<small class="kiosk-next-sub">SUB</small>' : ''}</li>`).join('')}</ul>`
      : '<div class="kiosk-next-empty-roster">No players signed up yet</div>';
    return `<section class="kiosk-next-team" aria-label="${index === 0 ? 'Second' : 'Third'} team in line">
      <div class="kiosk-next-team-heading"><strong>${escapeHtml(team.name)}</strong><span>${team.members.length}/${maxSize}</span></div>
      ${players}
    </section>`;
  }).join('');
}
function renderPreviousTeam() {
  $('kioskPreviousTeamName').textContent=previousTeam?.team_name || 'No previous team';
  const people=Array.isArray(previousTeam?.roster) ? previousTeam.roster : [];
  $('kioskPreviousTeamPlayers').innerHTML = people.length
    ? people.map(person => `<span class="kiosk-previous-person">${escapeHtml(person.name)}${person.is_sub ? '<small class="kiosk-next-sub">SUB</small>' : ''}</span>`).join('')
    : (previousTeam ? 'No players were registered.' : 'No team has been called yet.');
}
function draw() {
  renderPreviousTeam();
  $('kioskMembersTitle').textContent = showPlayerPositions ? 'PLAYERS & PREFERRED POSITIONS' : 'PLAYERS';
  const first = waiting[0];
  renderFollowingTeams();
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
    ? first.members.map(person => `<article class="kiosk-person"><div class="kiosk-name">${escapeHtml(person.name)}${person.isSub ? '<span class="kiosk-sub">SUB</span>' : ''}</div>${showPlayerPositions && person.preferred_position && person.preferred_position !== 'Flexible / Any' ? `<div class="kiosk-position">${escapeHtml(person.preferred_position)}</div>` : ''}</article>`).join('')
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
      db.from('queue_settings').select('max_team_size,site_theme,show_player_positions,registration_closed,session_started_at').eq('id',true).maybeSingle(),
      db.from('completed_teams').select('id,team_name,roster,completed_at').order('id',{ascending:false}).limit(1)
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
    sessionStartedAt = settings.data?.session_started_at || null;
    previousTeam = (history.data || []).find(item=>sessionStartedAt && new Date(item.completed_at || 0)>=new Date(sessionStartedAt)) || null;
    hasHistory = Boolean(previousTeam);
    maxSize = Number(settings.data?.max_team_size) || 6;
    showPlayerPositions = settings.data?.show_player_positions === true;
    document.documentElement.dataset.positions = showPlayerPositions ? 'visible' : 'hidden';
    $('kioskPositionMode').textContent = showPlayerPositions ? 'Positions shown' : 'Positions hidden';
    themeName = String(settings.data?.site_theme || 'default');
    document.documentElement.dataset.theme = themeName;
    draw();
    $('kioskUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    if (!busy) status('');
  } catch(error) {
    // Never keep previously visible positions displayed if settings cannot be verified.
    showPlayerPositions = false;
    document.documentElement.dataset.positions = 'hidden';
    $('kioskPositionMode').textContent = 'Positions hidden (settings unavailable)';
    draw();
    status(`Couldn't refresh queue: ${error?.message || 'Connection error'}`, true);
    $('kioskUpdated').textContent = 'Refresh unsuccessful — will retry';
  } finally {
    isLoading = false;
    if (needsAnotherLoad) { needsAnotherLoad = false; scheduleLoad(0); }
  }
}
// PIN is checked by a database function on each press; never stored locally.
const kioskPinOverlay=$('kioskPinOverlay');
let kioskPendingAction=null;
function openKioskPin(which){
  kioskPendingAction=which;
  $('kioskPinTitle').textContent=which==='advance'?'PIN required · Next Team':'PIN required · Previous Team';
  $('kioskPinStatus').textContent='';
  $('kioskPinInput').value='';
  kioskPinOverlay.hidden=false;
  $('kioskPinInput').focus({preventScroll:true});
}
function closeKioskPin(){
  kioskPinOverlay.hidden=true;
  $('kioskPinInput').value='';
  $('kioskPinStatus').textContent='';
  kioskPendingAction=null;
}
$('kioskPinClose').addEventListener('click',closeKioskPin);
kioskPinOverlay.addEventListener('click',event=>{if(event.target===kioskPinOverlay)closeKioskPin();});
$('kioskPinForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const code=$('kioskPinInput').value;
  if(!/^\d{4}$/.test(code)){$('kioskPinStatus').textContent='Enter exactly four digits.';return;}
  const action=kioskPendingAction;
  const submit=$('kioskPinForm').querySelector('button[type=submit]');
  submit.disabled=true;
  try {await runKioskRotation(action,code);closeKioskPin();}
  catch(error){$('kioskPinStatus').textContent=error?.message||'PIN or queue operation failed';$('kioskPinInput').select();}
  finally {submit.disabled=false;}
});
async function rotate(which){
  if(!db||busy)return;
  if(which==='advance'&&!waiting.length)return;
  if(which==='undo'&&!hasHistory)return;
  if(!kioskAdmin){openKioskPin(which);return;}
  try {await runKioskRotation(which,null);} catch(_){}
}
async function runKioskRotation(which,code){
  if(!db||busy)return;
  busy=true;
  showActions();
  status(which==='advance'?'Moving to the next team…':'Restoring previous team…');
  try {
    const {data,error}=await db.rpc('rotate_queue_with_pin',{direction:which==='advance'?'next':'previous',pin:code});
    if(error)throw error;
    if(!data?.ok)throw new Error(data?.message||'The court-control PIN was rejected.');
    await load();
    status(which==='advance'?'Queue advanced.':'Previous team restored with its players.');
  }catch(error){
    status(`Could not ${which==='advance'?'advance':'undo'}: ${error?.message||'Unknown error'}`,true);
    throw error;
  }finally {busy=false;showActions();}
}
// The kiosk never grants admin access from the UI alone: Supabase checks
// admin_users, and the Next Team database function validates it again.
const kioskLoginOverlay = $('kioskLoginOverlay');
async function checkKioskAdmin() {
  kioskAdmin = false;
  if (db) {
    const sessionResult = await db.auth.getSession();
    const session = sessionResult.data?.session;
    if (session) {
      const result = await db.from('admin_users').select('user_id')
        .eq('user_id',session.user.id).maybeSingle();
      kioskAdmin = !result.error && Boolean(result.data);
    }
  }
  $('kioskAdminToggle').textContent = kioskAdmin ? '🔓 Admin · Sign out' : '🔒 Admin sign in';
  showActions();
}
function closeKioskLogin() {
  kioskLoginOverlay.hidden = true;
  $('kioskAdminToggle').focus({preventScroll:true});
}
$('kioskAdminToggle').addEventListener('click',async()=>{
  if (kioskAdmin) {
    if (!confirm('Sign out of admin access on this tablet?')) return;
    const result = await db.auth.signOut();
    if (result.error) {status(result.error.message,true);return;}
    await checkKioskAdmin();
    status('Signed out. Players can use the shared PIN to control the queue.');
    return;
  }
  kioskLoginOverlay.hidden = false;
  $('kioskAdminEmail').focus({preventScroll:true});
});
$('kioskLoginClose').addEventListener('click',closeKioskLogin);
kioskLoginOverlay.addEventListener('click',event=>{
  if (event.target===kioskLoginOverlay) closeKioskLogin();
});
$('kioskLoginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if (!db) return;
  const submit = $('kioskLoginForm').querySelector('button[type="submit"]');
  submit.disabled=true;
  $('kioskLoginStatus').textContent='Signing in…';
  try {
    const result = await db.auth.signInWithPassword({
      email:$('kioskAdminEmail').value.trim(), password:$('kioskAdminPassword').value
    });
    if (result.error) throw result.error;
    await checkKioskAdmin();
    if (!kioskAdmin) throw new Error('This account is not listed in admin_users.');
    $('kioskAdminPassword').value='';
    $('kioskLoginStatus').textContent='';
    closeKioskLogin();
    status('Admin connected. Next and Previous are available without a PIN.');
  } catch(error) {
    $('kioskLoginStatus').textContent=error.message||'Unable to sign in';
  } finally { submit.disabled=false; }
});
document.addEventListener('keydown',event=>{
  if (event.key==='Escape' && !kioskPinOverlay.hidden) {closeKioskPin();return;}
  if (event.key==='Escape' && !kioskLoginOverlay.hidden) closeKioskLogin();
});
if (db) {
  db.auth.onAuthStateChange(()=>setTimeout(()=>{void checkKioskAdmin();},0));
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
  await checkKioskAdmin();
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
