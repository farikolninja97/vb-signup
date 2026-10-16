import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[c]));
const positions = [
  'Setter','Outside Hitter','Opposite / Right Side','Middle Blocker',
  'Libero','Defensive Specialist','Flexible / Any'
];
const configured = SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('YOUR_') && !SUPABASE_URL.endsWith('/rest/v1/') &&
  SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes('YOUR_');
const db = configured ? createClient(SUPABASE_URL,SUPABASE_ANON_KEY) : null;

let courts = [], teams = [], players = [], subs = [], completed = [], maxTeamSize = 6;
// Signup ownership tokens are random secrets local to this browser. They never
// appear in public team data or the URL. Server stores only token hashes.
const OWNED_PLAYERS_KEY = 'vb-my-signups-v102';
const OWNED_SUBS_KEY = 'vb-my-subs-v102';
function readOwned(key) {
  try { const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) { return {}; }
}
const ownedPlayers = readOwned(OWNED_PLAYERS_KEY);
const ownedSubs = readOwned(OWNED_SUBS_KEY);
function storeOwned(key,records) {
  try { localStorage.setItem(key,JSON.stringify(records)); return true; }
  catch (_) { return false; }
}
function privateToken() {
  if (!crypto?.randomUUID) throw new Error('This browser cannot create a secure private signup token. Use HTTPS and an up-to-date browser.');
  return crypto.randomUUID();
}
let subDraft = {open:false,name:'',position:'Flexible / Any',teamId:null};
let selfLeaving = false;
const THEME_NAMES = ['default','halloween','christmas','thanksgiving','valentines','stpatricks','fourthofjuly'];
let siteTheme = 'default';
let themePreviewPending = false;
let savedSiteTheme = 'default';
function applyTheme(name) {
  siteTheme = THEME_NAMES.includes(name) ? name : 'default';
  document.documentElement.dataset.theme = siteTheme;
  const seasonal = {
    default: {ball:'🏐', decorations:[]},
    halloween: {ball:'🎃', decorations:['🕸️','🦇','🕷️','👻']},
    christmas: {ball:'🎄', decorations:['❄️','🎁','🔔','✨']},
    thanksgiving: {ball:'🍁', decorations:['🍂','🦃','🌾','🍁']},
    valentines: {ball:'💗', decorations:['💕','💘','🌹','💞']},
    stpatricks: {ball:'☘️', decorations:['🍀','🌈','🪙','☘️']},
    fourthofjuly: {ball:'⭐', decorations:['🇺🇸','🎆','⭐','🎇']}
  };
  const ornament = seasonal[siteTheme] || seasonal.default;
  const ball = document.getElementById('themeBall');
  if (ball) ball.textContent = ornament.ball;
  const decor = document.getElementById('holidayDecor');
  if (decor) {
    decor.replaceChildren();
    ornament.decorations.forEach((emoji, index) => {
      const span = document.createElement('span');
      span.className = 'holiday-ornament ornament-' + (index + 1);
      span.textContent = emoji;
      decor.append(span);
    });
  }
  const option = $('siteTheme');
  if (option && document.activeElement !== option) option.value = siteTheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#101827';
}
applyTheme('default');
let admin = false, loading = false, saving = false, publicRotating = false;
// Queue display preference lasts through live refreshes on the current page.
let showAllFollowingTeams = false;
let latestRead = 0;
// Supabase Database Broadcast: the database emits a tiny public invalidation event.
// No names, rosters, or admin information are sent in these messages.
const REALTIME_TOPIC = 'vb:intermediate-queue:v1';
const BACKUP_REFRESH_MS = 60_000;
let realtimeChannel = null;
let realtimeConnected = false;
let realtimeRefreshTimer = null;
let lastRealtimeReloadAt = 0;
let realtimeRetryTimer = null;
let refreshQueuedDuringLoad = false;

function connectionStatus(kind) {
  const badge = $('connectionStatus');
  if (!badge) return;
  const labels = {
    live: '● Live updates',
    connecting: '◌ Connecting…',
    fallback: '◌ Backup refresh · 60s',
    paused: '◌ Paused in background',
    offline: '○ Offline'
  };
  badge.textContent = labels[kind] || labels.fallback;
  badge.dataset.state = kind;
}
function scheduleRefresh(delay = 350) {
  if (!db || document.hidden) return;
  // First event schedules one read; more events while pending are coalesced.
  // Throttle bursts to avoid an open public channel forcing excessive reads.
  if (realtimeRefreshTimer) return;
  const throttleMs = Math.max(0, 1000 - (Date.now() - lastRealtimeReloadAt));
  realtimeRefreshTimer = setTimeout(() => {
    realtimeRefreshTimer = null;
    lastRealtimeReloadAt = Date.now();
    void load();
  }, Math.max(delay, throttleMs));
}
function scheduleRealtimeRetry() {
  if (realtimeRetryTimer || document.hidden || !navigator.onLine) return;
  realtimeRetryTimer = setTimeout(() => {
    realtimeRetryTimer = null;
    if (!realtimeConnected && !document.hidden) void reconnectRealtime();
  }, 15_000);
}
function startRealtime() {
  if (!db || document.hidden || realtimeChannel) return;
  connectionStatus('connecting');
  const channel = db.channel(REALTIME_TOPIC, {config:{private:false}});
  realtimeChannel = channel;
  channel.on('broadcast', {event:'queue_changed'}, () => scheduleRefresh(400));
  channel.subscribe(status => {
    // Ignore callbacks belonging to a channel we deliberately closed.
    if (realtimeChannel !== channel) return;
    if (status === 'SUBSCRIBED') {
      realtimeConnected = true;
      clearTimeout(realtimeRetryTimer);
      realtimeRetryTimer = null;
      connectionStatus('live');
      // Catch a change that happened during the connection handshake.
      scheduleRefresh(0);
    } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
      realtimeConnected = false;
      connectionStatus(navigator.onLine ? 'fallback' : 'offline');
      scheduleRealtimeRetry();
    }
  });
}
async function stopRealtime() {
  const old = realtimeChannel;
  realtimeChannel = null;
  realtimeConnected = false;
  clearTimeout(realtimeRetryTimer);
  realtimeRetryTimer = null;
  if (old) {
    try { await db.removeChannel(old); }
    catch (err) { console.warn('Realtime channel cleanup:', err); }
  }
}
async function reconnectRealtime() {
  await stopRealtime();
  if (!document.hidden && navigator.onLine) startRealtime();
}

const FOLLOW_KEY = 'vb-follow-team-v1';
const notifiedTeams = new Set();
const NOTIFICATIONS_KEY = 'vb-notifications-enabled-v1';
// Previously popups were enabled automatically; retain that behavior for existing visitors.
let notificationsEnabled = true;
try { notificationsEnabled = localStorage.getItem(NOTIFICATIONS_KEY) !== '0'; } catch (_) {}
function updateNotificationButtons() {
  $('enableNotifications').classList.toggle('hidden', notificationsEnabled);
  $('disableNotifications').classList.toggle('hidden', !notificationsEnabled);
  $('enableNotifications').setAttribute('aria-pressed', String(notificationsEnabled));
  $('disableNotifications').setAttribute('aria-pressed', String(!notificationsEnabled));
}
let followedTeam = '';
try { followedTeam = localStorage.getItem(FOLLOW_KEY) || ''; } catch (_) {}
function setFollow(id) {
  followedTeam = id;
  notifiedTeams.clear();
  try { if (id) localStorage.setItem(FOLLOW_KEY,id); else localStorage.removeItem(FOLLOW_KEY); } catch (_) {}
  $('followStatus').textContent = id ? 'Watching this team. A popup will appear when it reaches the front.' : 'Choose a team to receive a first-in-line alert.';
}
function checkFollowAlert(waiting) {
  const team = waiting[0];
  if (!team || team.id !== followedTeam || notifiedTeams.has(team.id)) return;
  notifiedTeams.add(team.id);
  $('teamAlertTitle').textContent = `${team.name} is next!`;
  $('teamAlertDescription').textContent = `${team.name} is first in line for the next available court.`;
  if (notificationsEnabled) $('teamAlertBackdrop').classList.remove('hidden');
  ringForNextTeam();
  if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Your volleyball team is next!', {body:`${team.name} is first in line.`}); } catch (_) {}
  }
}

// Ringtone is an opt-in page sound. A user tap unlocks Web Audio (required on mobile).
const RINGTONE_KEY = 'vb-ringtone-enabled-v1';
let ringtoneEnabled = false;
let ringtoneContext = null;
let activeRingNotes = [];
let ringGeneration = 0;
function stopRingtone() {
  ringGeneration++;
  for (const note of activeRingNotes) { try { note.stop(); } catch (_) {} }
  activeRingNotes = [];
}
function updateRingtoneButton() {
  const el = $('enableRingtone');
  el.classList.toggle('hidden', ringtoneEnabled);
  $('disableRingtone').classList.toggle('hidden', !ringtoneEnabled);
  el.setAttribute('aria-pressed',String(ringtoneEnabled));
  $('disableRingtone').setAttribute('aria-pressed',String(!ringtoneEnabled));
}
async function startAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Ringtone audio is not supported by this browser.');
  ringtoneContext ||= new AudioContextClass();
  if (ringtoneContext.state === 'suspended') await ringtoneContext.resume();
}
function ringForNextTeam() {
  if (!ringtoneEnabled || !ringtoneContext || ringtoneContext.state !== 'running') return;
  stopRingtone();
  const baseTime = ringtoneContext.currentTime + 0.03;
  // Three short, pleasant two-tone alerts, <3 seconds total.
  for (let i = 0; i < 3; i++) {
    for (const [offset,freq] of [[0,660],[0.19,880]]) {
      const osc = ringtoneContext.createOscillator();
      const volume = ringtoneContext.createGain();
      const start = baseTime + i * 0.73 + offset;
      osc.type = 'sine'; osc.frequency.value = freq;
      volume.gain.setValueAtTime(0.0001,start);
      volume.gain.exponentialRampToValueAtTime(0.13,start+0.025);
      volume.gain.exponentialRampToValueAtTime(0.0001,start+0.17);
      osc.connect(volume); volume.connect(ringtoneContext.destination);
      osc.start(start); osc.stop(start+0.18);
      activeRingNotes.push(osc);
    }
  }
}
$('enableRingtone').addEventListener('click',async () => {
  try {
    await startAudio();
    ringtoneEnabled = true;
    try { localStorage.setItem(RINGTONE_KEY,'1'); } catch (_) {}
    $('followStatus').textContent = 'Ringtone enabled. Keep this page open for sound alerts.';
    ringForNextTeam(); // User-initiated audio preview.
  } catch (error) { $('followStatus').textContent = error.message; }
  updateRingtoneButton();
});
$('disableRingtone').addEventListener('click', () => {
  ringtoneEnabled = false;
  stopRingtone();
  try { localStorage.setItem(RINGTONE_KEY,'0'); } catch (_) {}
  $('followStatus').textContent = 'Ringtone disabled on this device.';
  updateRingtoneButton();
});
// Remember preference, but enable sound only after a fresh tap in each page session.
updateRingtoneButton();

const pendingDestinations = new Map();
const sortTeams = values => [...values].sort((a,b) =>
  Number(a.queue_order) - Number(b.queue_order) ||
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
const sortCourts = values => [...values].sort((a,b) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name));
const roster = team => players.filter(player => player.team_id === team.id);
const teamSubs = team => subs.filter(sub => sub.team_id === team.id);
const teamCount = team => roster(team).length + teamSubs(team).length;
const formattedTeamRoster = team => [
  ...roster(team).map(playerHtml),
  ...teamSubs(team).map(item=>`${playerHtml(item)} <span class="sub-tag">SUB</span>`)
].join(' · ');
function myTeamRank(player,waiting) {
  return waiting.findIndex(team=>team.id===player.team_id)+1;
}
const teamById = id => teams.find(team => team.id === id);
const courtById = id => courts.find(court => court.id === id);

function message(id, text, error = false) {
  const target = $(id);
  target.textContent = text;
  target.classList.toggle('error',error);
}
function explain(error) {
  const detail = error?.message || 'Unknown database error';
  if (error?.code === '42501' || /permission denied/i.test(detail)) {
    return 'Permission denied. Run fix_existing_database.sql in Supabase SQL Editor, then sign out and back in. Details: ' + detail;
  }
  if (error?.code === '23505' && /players_name_unique_normalized|team_subs_name_normalized_unique|duplicate player name/i.test(detail)) return 'That name is already registered. Please use a different name.';
  if (error?.code === '23505') return 'A record with that name already exists. ' + detail;
  if (error?.code === 'PGRST116') return 'The operation did not match a record. Refresh the page and try again.';
  return detail;
}
function button(label,action,id,kind='secondary',disabled=false) {
  return `<button type="button" class="${kind} small" data-action="${action}" data-id="${safe(id)}" ${disabled?'disabled':''}>${safe(label)}</button>`;
}
function playerHtml(player) {
  return `${safe(player.name)} <span class="hint">(${safe(player.preferred_position || 'Flexible / Any')})</span>`;
}
function teamTitle(team) {
  const count = teamCount(team);
  return `${safe(team.name)} <span class="hint">(${count}/${maxTeamSize}${count>=maxTeamSize?' · FULL':''})</span>`;
}
function subFormHtml(team) {
  const count = teamCount(team);
  if (count >= maxTeamSize) return '<p class="sub-full">This team is full. No subs needed.</p>';
  if (subDraft.teamId !== team.id) {
    subDraft = {open:false,name:'',position:'Flexible / Any',teamId:team.id};
  }
  const eligibleFrom = `You may sub if you are not on a team, or your regular team is at least three places behind the first team. Players on the first team or the next two teams cannot sub.`;
  const positionOptions = positions.map(p=>`<option value="${safe(p)}" ${p===subDraft.position?'selected':''}>${safe(p)}</option>`).join('');
  return `<div class="sub-volunteer">
    <label class="sub-toggle"><input id="subOptIn" type="checkbox" ${subDraft.open?'checked':''} /> <span><strong>I'd like to sub for this team</strong><small>${maxTeamSize-count} open ${maxTeamSize-count===1?'spot':'spots'} available</small></span></label>
    ${subDraft.open?`<form id="subForm" class="sub-fields">
      <label>Your name<input id="subName" name="subName" maxlength="60" autocomplete="off" placeholder="Your first name or nickname" value="${safe(subDraft.name)}" required /></label>
      <label>Preferred position<select id="subPosition" name="subPosition">${positionOptions}</select></label>
      <p class="hint">${eligibleFrom}</p>
      <button class="primary" type="submit">Add me as a sub</button>
      <p class="message" id="subStatus" role="status"></p>
    </form>`:''}
  </div>`;
}
function teamCard(team,isNext=false,place=1) {
  const items = roster(team);
  const standIns = teamSubs(team);
  const count = items.length+standIns.length;
  return `<div class="team-row ${isNext?'next':''}">
    <div class="queue-rank" aria-label="Queue position ${place}">${isNext?'★':place}</div>
    <div class="queue-team-details">
      <div class="team-name">${safe(team.name)} <span class="team-capacity">${count}/${maxTeamSize} players</span></div>
      ${isNext?'<div class="next-callout">FIRST IN LINE · NEXT AVAILABLE COURT</div>':''}
      <div class="queue-roster">${count ? [
        ...items.map(player=>`<span class="roster-chip">${playerHtml(player)}</span>`),
        ...standIns.map(sub=>`<span class="roster-chip">${playerHtml(sub)} <span class="sub-tag">SUB</span></span>`)
      ].join(''):'<span class="roster-empty">No players signed up yet</span>'}</div>
      ${isNext?subFormHtml(team):''}
    </div>
  </div>`;
}

function renderPublic() {
  // Keep a selected team if it is still eligible while auto-refreshing.
  const chosen = $('teamChoice').value;
  const available = sortTeams(teams.filter(team => team.status === 'waiting'));
  $('teamChoice').innerHTML = '<option value="">Choose a team</option>' + available.map(team => {
    const count = teamCount(team);
    const full = count >= maxTeamSize;
    return `<option value="${safe(team.id)}" ${full?'disabled':''}>${safe(team.name)} · ${count}/${maxTeamSize}${full?' · FULL':''}</option>`;
  }).join('');
  if (available.some(team => team.id === chosen && teamCount(team) < maxTeamSize)) {
    $('teamChoice').value = chosen;
  }

  // A player can follow their team from a different device using the dropdown.
  const selectedFollow = followedTeam;
  const followable = sortTeams(teams.filter(team => team.status !== 'done'));
  $('followTeam').innerHTML = '<option value="">Choose your team</option>' + followable.map(team =>
    `<option value="${safe(team.id)}">${safe(team.name)} · ${teamCount(team)} players</option>`).join('');
  if (followable.some(team => team.id === selectedFollow)) $('followTeam').value = selectedFollow;
  else if (selectedFollow) {
    setFollow('');
    $('followStatus').textContent = 'Your team has finished or was removed. Choose a new team to follow.';
  }
  // One shared FIFO line: every court takes the first waiting team, not a matchup.
  const waiting = sortTeams(teams.filter(team => team.status === 'waiting'));
  checkFollowAlert(waiting);
  const courtNames = sortCourts(courts).map(court => safe(court.name)).join(' · ');
  const followingTeams = waiting.slice(1);
  const shownFollowingTeams = showAllFollowingTeams ? followingTeams : followingTeams.slice(0,3);
  const hiddenFollowingCount = Math.max(0, followingTeams.length - 3);
  $('courtGrid').innerHTML = `<article class="court-card single-queue">
    <div class="court-top"><h3>🏐 Live team lineup</h3><span class="tag">${waiting.length} teams in line</span></div>
    <div class="hint">Next available court: ${courtNames || 'No courts configured'}</div>
    <div class="public-court-actions top-queue-actions" role="group" aria-label="Queue controls">
      ${button('↶ Previous Team','undo','queue','secondary',publicRotating)}
      ${button('▶ Next Team','advance','queue','primary',publicRotating || !waiting.length || !courts.length)}
    </div>
    <div class="subtitle">UP NEXT</div>
    ${waiting.length ? teamCard(waiting[0],true,1) : '<div class="empty">No teams waiting</div>'}
    ${followingTeams.length ? `<div class="following-heading"><div class="subtitle">Teams following in queue</div><span class="hint">${followingTeams.length} waiting behind first</span></div>
      <div id="followingTeamsList">${shownFollowingTeams.map((team,index)=>teamCard(team,false,index+2)).join('')}</div>
      ${hiddenFollowingCount ? `<button type="button" class="secondary queue-expand-button" data-queue-toggle="true" aria-controls="followingTeamsList" aria-expanded="${showAllFollowingTeams}">${showAllFollowingTeams ? 'Show Less ↑' : `Show More ↓ (${hiddenFollowingCount} more ${hiddenFollowingCount===1?'team':'teams'})`}</button>` : ''}` : ''}
  </article>`;

  renderHistory();
  $('playerCount').textContent = `${players.length} players · ${subs.length} subs`;
  renderMySignups();
  $('teamDirectory').innerHTML = sortTeams(teams.filter(team => team.status !== 'done')).map(team => {
    const members = roster(team);
    const volunteers = teamSubs(team);
    return `<div class="directory-card">
      <strong>${teamTitle(team)}</strong>
      <div class="hint">${safe(courtById(team.court_id)?.name || 'Unassigned')} · ${safe(team.status)}</div>
      <div class="players">${members.length+volunteers.length?formattedTeamRoster(team):'No signups yet'}</div>
    </div>`;
  }).join('') || '<div class="empty">No teams yet. Ask an admin to add them.</div>';
}

function renderHistory() {
  const host = $('historyList');
  if (!host) return;
  host.innerHTML = completed.length ? completed.map((item, index) => {
    const members = Array.isArray(item.roster) ? item.roster : [];
    const stamp = item.completed_at ? new Date(item.completed_at).toLocaleString() : '';
    return `<article class="directory-card"><strong>${safe(item.team_name)}</strong>
      <div class="hint">${safe(stamp)} · ${members.length} players</div>
      <div class="players">${members.length ? members.map(member=>playerHtml(member)+(member.is_sub?' <span class="sub-tag">SUB</span>':'')).join(' · ') : 'No players were signed up'}</div>
    </article>`;
  }).join('') : '<div class="empty">No teams have been sent to play yet.</div>';
  $('historyCount').textContent = `${completed.length} previous teams`;
}

function renderMySignups() {
  const host = $('mySignups');
  if (!host) return;
  const members = players.filter(p=>Object.hasOwn(ownedPlayers,p.id));
  const standIns = subs.filter(s=>Object.hasOwn(ownedSubs,s.id));
  const records = [
    ...members.map(p=>({...p,kind:'player'})),
    ...standIns.map(s=>({...s,kind:'sub'}))
  ];
  host.innerHTML = records.length ? records.map(person => {
    const team = teamById(person.team_id);
    const label = person.kind==='sub'?'SUB':'PLAYER';
    return `<div class="my-signup-row">
      <div><strong>${safe(person.name)}</strong> <span class="sub-tag">${label}</span>
      <div class="hint">${safe(team?.name || 'Team removed')} · ${safe(person.preferred_position||'Flexible / Any')}</div></div>
      <button class="danger small" type="button" data-leave-kind="${person.kind}" data-leave-id="${safe(person.id)}" ${selfLeaving?'disabled':''}>Leave ${person.kind==='sub'?'sub spot':'team'}</button>
    </div>`;
  }).join('') : '<p class="hint">No active signups from this device yet. After joining a team or volunteering as a sub, a Leave button will appear here.</p>';
}

function renderAdmin() {
  if (!admin) return;
  const editing = document.activeElement;
  // Don't overwrite an unfinished input/select while live updates arrive.
  if (editing && $('adminPanel').contains(editing) &&
     ['INPUT','SELECT','TEXTAREA'].includes(editing.tagName)) return;

  $('maxTeamSize').value = String(maxTeamSize);
  const choices = '<option value="">Unassigned</option>' + sortCourts(courts)
    .map(court => `<option value="${safe(court.id)}">${safe(court.name)}</option>`).join('');

  $('courtAdminList').innerHTML = sortCourts(courts).map(court =>
    `<div class="court-admin-row"><strong>${safe(court.name)}</strong>
      <div class="actions">${button('Rename','renameCourt',court.id)}
        ${button('Remove court','deleteCourt',court.id,'danger')}</div></div>`
  ).join('') || '<div class="empty">No courts.</div>';

  $('adminTeams').innerHTML = sortTeams(teams).map(team => `
    <div class="admin-team"><h4>${teamTitle(team)} <span class="hint">· ${safe(team.status)}</span></h4>
      <div class="actions"><select aria-label="Destination court for ${safe(team.name)}" data-team-court="${safe(team.id)}">${choices}</select>
        ${button('Move court','moveTeam',team.id)}${button('Rename','editTeam',team.id)}
        ${button('↑','up',team.id)}${button('↓','down',team.id)}
        ${button('Wait','wait',team.id)}${button('Remove team','deleteTeam',team.id,'danger')}
      </div></div>`).join('') || '<div class="empty">No teams configured.</div>';
  document.querySelectorAll('[data-team-court]').forEach(select => {
    const team = teamById(select.dataset.teamCourt);
    const target = pendingDestinations.has(team.id) ? pendingDestinations.get(team.id) : (team.court_id || '');
    select.value = target;
  });


  $('adminPlayers').innerHTML = [...players].sort((a,b) => a.name.localeCompare(b.name)).map(player => `
    <div class="admin-team"><strong>${safe(player.name)}</strong>
      <span class="hint">· ${safe(player.preferred_position || 'Flexible / Any')} · ${safe(teamById(player.team_id)?.name || 'Unknown team')}</span>
      <div class="actions">${button('Rename','renamePlayer',player.id)}
        ${button('Change position','editPosition',player.id)}${button('Move to team','movePlayer',player.id)}
        ${button('Remove','deletePlayer',player.id,'danger')}</div></div>`
  ).join('') || '<div class="empty">No players signed up.</div>';
  if (subs.length) {
    $('adminPlayers').innerHTML += `<p class="hint">Temporary substitutes</p>` + [...subs].sort((a,b)=>a.name.localeCompare(b.name)).map(sub => `
      <div class="admin-team"><strong>${safe(sub.name)}</strong> <span class="sub-tag">SUB</span>
      <span class="hint">· ${safe(teamById(sub.team_id)?.name || 'Unknown team')}</span>
      <div class="actions">${button('Remove sub','adminRemoveSub',sub.id,'danger')}</div></div>`).join('');
  }
}

async function load(forceAdminRender=false) {
  if (!db) return;
  if (loading) {
    // Events arriving while a read is underway must not be lost.
    refreshQueuedDuringLoad = true;
    return;
  }
  loading = true;
  const readVersion = ++latestRead;
  try {
    const results = await Promise.all([
      db.from('courts').select('*').order('sort_order'),
      db.from('teams').select('*').order('queue_order'),
      db.from('players').select('*').order('created_at'),
      db.from('team_subs').select('id,team_id,name,preferred_position,source_player_id,created_at').order('created_at'),
      db.from('queue_settings').select('max_team_size,site_theme').eq('id',true).single(),
      db.from('completed_teams').select('id,team_name,roster,completed_at').order('id',{ascending:false}).limit(200)
    ]);
    for (const result of results) if (result.error) throw result.error;
    if (readVersion !== latestRead) return;
    [courts,teams,players,subs] = results.slice(0,4).map(result => result.data);
    maxTeamSize = results[4].data.max_team_size;
    savedSiteTheme = results[4].data.site_theme || 'default';
    if (!themePreviewPending) applyTheme(savedSiteTheme);
    completed = results[5].data;
    renderPublic();
    if (forceAdminRender) document.activeElement?.blur?.();
    renderAdmin();
    $('refreshBadge').textContent = 'Updated ' + new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  } catch (error) {
    $('refreshBadge').textContent = 'Refresh failed: ' + explain(error);
  } finally {
    loading = false;
    if (refreshQueuedDuringLoad) {
      refreshQueuedDuringLoad = false;
      scheduleRefresh(0);
    }
  }
}

async function checkAdmin() {
  if (!db) return;
  admin = false;
  const sessionResult = await db.auth.getSession();
  if (sessionResult.error) message('loginStatus',explain(sessionResult.error),true);
  const session = sessionResult.data?.session;
  if (session) {
    const result = await db.from('admin_users').select('user_id')
      .eq('user_id',session.user.id).maybeSingle();
    if (result.error) message('loginStatus',explain(result.error),true);
    else admin = !!result.data;
  }
  $('loginPanel').classList.toggle('hidden',admin);
  $('adminPanel').classList.toggle('hidden',!admin);
  $('logoutBtn').classList.toggle('hidden',!session);
  $('adminToggle').textContent = admin ? 'Admin controls' : 'Admin login';
  if (admin) renderAdmin();
}

// Request a returned row for writes. This catches silent zero-row updates/deletes
// that otherwise look like success under Supabase/PostgREST RLS.
async function checkedMutation(query) {
  const result = await query.select('id');
  if (result.error) throw result.error;
  if (!result.data?.length) throw new Error('No record changed. Refresh and check admin permissions.');
}
async function runAdmin(action,success='Saved') {
  if (!admin || saving) return false;
  saving = true;
  $('adminPanel').classList.add('is-saving');
  try {
    await action();
    message('adminStatus',success);
    await load(true);
    return true;
  } catch (error) {
    message('adminStatus',explain(error),true);
    return false;
  } finally {
    saving = false;
    $('adminPanel').classList.remove('is-saving');
  }
}
async function rpc(name,args) {
  const result = await db.rpc(name,args);
  if (result.error) throw result.error;
  return result.data;
}
// Friendly immediate feedback; the matching Supabase trigger is authoritative.
const blockedWords = [
  'fuck','fucker','fucking','motherfucker','shit','shitty','bullshit',
  'bitch','bitches','asshole','bastard','cunt','dick','dickhead',
  'pussy','cock','twat','whore','slut','retard','retarded',
  'nigger','nigga','faggot','fag','kike','spic'
];
const blockedSet = new Set(blockedWords);
function normalizeName(text) {
  return text.toLowerCase().replace(/[@4]/g,'a').replace(/3/g,'e')
    .replace(/[!1|]/g,'i').replace(/0/g,'o').replace(/[$5]/g,'s')
    .replace(/7/g,'t');
}
function containsProfanity(value) {
  const normalized = normalizeName(value);
  const tokens = normalized.match(/[a-z]+/g) || [];
  if (tokens.some(token => blockedSet.has(token))) return true;
  // Catch deliberate separators such as f.u.c.k; avoid scanning inside ordinary names.
  return blockedSet.has(tokens.join('')) && tokens.length > 1;
}
function normalizedPlayerName(name) {
  return name.trim().replace(/\s+/g,' ').toLowerCase();
}
function ensureUniquePlayerName(name, excludingId=null) {
  const normalized = normalizedPlayerName(name);
  if (players.some(player => player.id !== excludingId && normalizedPlayerName(player.name) === normalized) || subs.some(sub => normalizedPlayerName(sub.name) === normalized)) {
    throw new Error('That player name is already signed up. Please use a different name.');
  }
}
function validName(value,max=60) {
  const name = (value || '').trim();
  if (!name || name.length>max) throw new Error(`Enter a name between 1 and ${max} characters.`);
  if (containsProfanity(name)) throw new Error('Please choose a name without profanity or offensive slurs.');
  return name;
}

$('followTeam').addEventListener('change', event => setFollow(event.target.value));
$('dismissTeamAlert').addEventListener('click', () => { stopRingtone(); $('teamAlertBackdrop').classList.add('hidden'); });
$('enableNotifications').addEventListener('click', async () => {
  notificationsEnabled = true;
  try { localStorage.setItem(NOTIFICATIONS_KEY,'1'); } catch (_) {}
  // Enabling while already first in queue should be able to show the alert again.
  notifiedTeams.clear();
  updateNotificationButtons();
  if (!('Notification' in window) || !('requestPermission' in Notification)) {
    $('followStatus').textContent = 'In-page notifications enabled. Browser notifications are not supported on this device.';
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    $('followStatus').textContent = permission === 'granted'
      ? 'Team popups and browser notifications enabled.'
      : 'Team popups enabled; browser notifications are not permitted.';
  } catch (_) { $('followStatus').textContent = 'Team popups enabled. Browser notifications unavailable.'; }
});
$('disableNotifications').addEventListener('click', () => {
  notificationsEnabled = false;
  try { localStorage.setItem(NOTIFICATIONS_KEY,'0'); } catch (_) {}
  $('teamAlertBackdrop').classList.add('hidden');
  $('followStatus').textContent = 'Popups and browser notifications disabled for this site on this device. Ringtone is controlled separately.';
  updateNotificationButtons();
});
updateNotificationButtons();

$('signupForm').addEventListener('submit',async event => {
  event.preventDefault();
  if (!db) return;
  const submit = $('signupForm').querySelector('button[type="submit"]');
  let playerName;
  try { playerName = validName($('playerName').value); ensureUniquePlayerName(playerName); }
  catch (error) { message('signupStatus',error.message,true); return; }
  const selectedTeam = $('teamChoice').value;
  const playerPosition = $('playerPosition').value;
  if (!playerName || !selectedTeam || !playerPosition) {
    message('signupStatus','Enter your name, preferred position and team.',true);
    return;
  }
  submit.disabled = true;
  try {
    const token = privateToken();
    const id = await rpc('signup_player_owned',{
      player_name:playerName, selected_team:selectedTeam, player_position:playerPosition,
      leave_token:token
    });
    if (!id) throw new Error('Signup completed, but did not return a signup ID. Contact an admin for help leaving.');
    ownedPlayers[id] = token;
    if (!storeOwned(OWNED_PLAYERS_KEY,ownedPlayers)) {
      message('signupStatus','Signup saved, but this browser could not store your private leave token. Ask an admin to remove you if you need to leave.',true);
    }
    $('playerName').value = '';
    $('playerPosition').value = '';
    setFollow(selectedTeam);
      try { if (localStorage.getItem(OWNED_PLAYERS_KEY)) message('signupStatus','You are signed up! Use Leave Team below if you need to go. Alerts are following your team.'); } catch (_) {}
    await load();
  } catch (error) {
    message('signupStatus',explain(error),true);
  } finally {
    submit.disabled = false;
  }
});
// Temporary subs only appear for the first-in-line team while it has space.
$('courtGrid').addEventListener('change',event => {
  if (event.target.id === 'subOptIn') {
    subDraft.open = event.target.checked;
    renderPublic();
    if (subDraft.open) $('subName')?.focus();
  }
  if (event.target.id === 'subPosition') subDraft.position = event.target.value;
});
$('courtGrid').addEventListener('input',event => {
  if (event.target.id === 'subName') subDraft.name = event.target.value;
});
$('courtGrid').addEventListener('submit',async event => {
  if (event.target.id !== 'subForm') return;
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button[type=submit]');
  let name;
  try { name = validName(subDraft.name); }
  catch(error) { message('subStatus',error.message,true); return; }
  const original = players.find(p=>normalizedPlayerName(p.name)===normalizedPlayerName(name));
  const waiting = sortTeams(teams.filter(team=>team.status==='waiting'));
  let token;
  if (original) {
    token = ownedPlayers[original.id];
    if (!token) {
      message('subStatus','That name is registered on a team, but this phone does not own the signup. Use the phone that originally signed up, or ask an admin to help.',true); return;
    }
    const rank = myTeamRank(original,waiting);
    if (rank < 1 || rank <= 3) {
      message('subStatus',`Your team is #${rank} in line. Teams 1, 2 and 3 cannot supply subs for the first team.`,true); return;
    }
  } else {
    try { token = privateToken(); } catch (error) { message('subStatus',error.message,true); return; }
  }
  submit.disabled = true;
  try {
    const id = await rpc('join_first_team_as_sub',{
      sub_name:name, sub_position:subDraft.position,
      source_player_id:original?.id || null, leave_token:token
    });
    if (!id) throw new Error('The server did not return a substitute signup ID');
    ownedSubs[id] = token;
    const stored = storeOwned(OWNED_SUBS_KEY,ownedSubs);
    subDraft = {open:false,name:'',position:'Flexible / Any',teamId:null};
    await load();
    message('queueStatus',stored?'You are signed up as a sub! Use Leave Sub Spot below to withdraw.':'Sub signup saved, but this browser could not save your leave token. Ask an admin to remove the sub if needed.',!stored);
  } catch(error) {
    message('subStatus',explain(error),true);
  } finally {
    submit.disabled = false;
  }
});
$('mySignups').addEventListener('click',async event => {
  const btn = event.target.closest('button[data-leave-kind]');
  if (!btn || selfLeaving) return;
  const id = btn.dataset.leaveId;
  const isSub = btn.dataset.leaveKind === 'sub';
  const entry = isSub ? subs.find(x=>x.id===id) : players.find(x=>x.id===id);
  const token = (isSub?ownedSubs:ownedPlayers)[id];
  if (!token || !entry) return;
  const action = isSub ? 'withdraw your substitute spot' : 'leave your team';
  if (!confirm(`Remove ${entry.name} and ${action}? This cannot be undone except by signing up again if space is available.`)) return;
  selfLeaving = true;
  renderMySignups();
  try {
    await rpc(isSub?'leave_my_sub':'leave_my_team',
      isSub?{sub_id:id,leave_token:token}:{player_id:id,leave_token:token});
    delete (isSub?ownedSubs:ownedPlayers)[id];
    storeOwned(isSub?OWNED_SUBS_KEY:OWNED_PLAYERS_KEY,isSub?ownedSubs:ownedPlayers);
    if (!isSub) {
      // Leaving the original team also withdraws any active sub signup.
      subs.filter(sub=>sub.source_player_id===id).forEach(sub=>delete ownedSubs[sub.id]);
      storeOwned(OWNED_SUBS_KEY,ownedSubs);
      if (followedTeam === entry.team_id) setFollow('');
    }
    await load();
    message('leaveStatus',`${entry.name} was removed successfully.`);
  } catch(error) {
    message('leaveStatus',explain(error),true);
  } finally {
    selfLeaving = false;
    renderMySignups();
  }
});

// Expand/collapse is display-only; it never contacts Supabase or advances the queue.
$('courtGrid').addEventListener('click', event => {
  const toggle = event.target.closest('button[data-queue-toggle]');
  if (!toggle) return;
  showAllFollowingTeams = !showAllFollowingTeams;
  renderPublic();
  const replacement = $('courtGrid').querySelector('button[data-queue-toggle]');
  replacement?.focus({preventScroll:true});
});

// Next atomically archives the outgoing team and its roster; Previous restores the latest archive and roster.
$('courtGrid').addEventListener('click', async event => {
  const target = event.target.closest('button[data-action]');
  if (!target || !db || publicRotating) return;
  const {action,id} = target.dataset;
  if (action !== 'advance' && action !== 'undo') return;
  publicRotating = true;
  $('courtGrid').querySelectorAll('button[data-action]').forEach(item => {item.disabled=true;});
  message('queueStatus',action === 'advance' ? 'Advancing teams…' : 'Restoring previous teams…');
  try {
    await rpc(action === 'advance' ? 'advance_global_queue' : 'undo_global_queue',{});
    message('queueStatus',action === 'advance' ? 'Team archived with its player list. Next team is first in line.' : 'Previous team and all its players restored to the front.');
    await load();
  } catch (error) {
    message('queueStatus',explain(error),true);
  } finally {
    publicRotating = false;
    renderPublic();
  }
});

function showRosterTab(tab) {
  const showHistory = tab === 'history';
  $('historyPanel').classList.toggle('hidden', !showHistory);
  $('activeTeamsPanel').classList.toggle('hidden', showHistory);
  $('queueTab').className = showHistory ? 'secondary' : 'primary';
  $('historyTab').className = showHistory ? 'primary' : 'secondary';
  $('queueTab').setAttribute('aria-selected', String(!showHistory));
  $('historyTab').setAttribute('aria-selected', String(showHistory));
}
$('queueTab').addEventListener('click', () => showRosterTab('queue'));
$('historyTab').addEventListener('click', () => showRosterTab('history'));

$('adminToggle').addEventListener('click',() => {
  $('adminSection').classList.toggle('hidden');
  if (!$('adminSection').classList.contains('hidden'))
    $('adminSection').scrollIntoView({behavior:'smooth'});
});
$('loginForm').addEventListener('submit',async event => {
  event.preventDefault();
  if (!db) return;
  const result = await db.auth.signInWithPassword({
    email:$('adminEmail').value.trim(),password:$('adminPassword').value
  });
  if (result.error) {message('loginStatus',explain(result.error),true);return;}
  await checkAdmin();
  if (!admin) message('loginStatus','Signed in, but this account is not authorized in admin_users.',true);
  else {
    $('adminPassword').value='';
    message('loginStatus','');
    await load(true);
  }
});
$('logoutBtn').addEventListener('click',async() => {
  if (!db) return;
  await db.auth.signOut();
  await checkAdmin();
});

$('siteTheme').addEventListener('change', () => {
  if (!admin) return;
  themePreviewPending = true;
  applyTheme($('siteTheme').value);
  $('siteTheme').value = siteTheme;
  message('adminStatus','Previewing '+siteTheme+'. Press Apply theme to save for everyone.');
});

$('saveSiteTheme').addEventListener('click',async() => {
  const selected = $('siteTheme').value;
  if (!THEME_NAMES.includes(selected) || !admin || saving) return;
  // Verify the returned setting rather than assuming an UPDATE matched a row.
  const applied = await runAdmin(async () => {
    const result = await db.from('queue_settings')
      .update({site_theme:selected}).eq('id',true).select('site_theme').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Theme was not saved: no settings row was updated. Run fix_theme_permissions.sql in Supabase.');
    if (result.data.site_theme !== selected) throw new Error('Supabase returned a different theme than requested.');
    themePreviewPending = false;
    savedSiteTheme = result.data.site_theme;
    applyTheme(savedSiteTheme);
  }, 'Theme saved for everyone: ' + selected);
  if (!applied) {
    themePreviewPending = false;
    applyTheme(savedSiteTheme);
    $('siteTheme').value = selected;
  }
});
$('saveMaxTeamSize').addEventListener('click',async() => {
  const number = Number($('maxTeamSize').value);
  if (!Number.isInteger(number) || number<1 || number>50) {
    message('adminStatus','Choose a team limit from 1 to 50.',true);return;
  }
  await runAdmin(() => checkedMutation(db.from('queue_settings')
    .update({max_team_size:number}).eq('id',true)),'Team limit updated');
});
$('addTeamBtn').addEventListener('click',async() => {
  let name;
  try {name=validName($('newTeamName').value);} catch(e){message('adminStatus',e.message,true);return;}
  if (await runAdmin(() => checkedMutation(db.from('teams').insert({name})),'Team added'))
    $('newTeamName').value='';
});
$('addCourtBtn').addEventListener('click',async() => {
  let name;
  try {name=validName($('newCourtName').value,40);} catch(e){message('adminStatus',e.message,true);return;}
  const nextSort = Math.max(0,...courts.map(court => Number(court.sort_order)||0))+1;
  if (await runAdmin(() => checkedMutation(db.from('courts')
    .insert({name,sort_order:nextSort})),'Court added')) $('newCourtName').value='';
});
$('resetDefaultsBtn').addEventListener('click',async() => {
  if (!admin || saving) return;
  const confirmText = prompt(
    'REMOVE EVERYONE? This permanently deletes ALL player signups on EVERY team, as well as teams, courts and Undo history.\n' +
    'It then creates one Intermediate court and 12 empty teams (maximum 6 players each).\n' +
    'Your admin login is kept.\n\nType RESET to continue:'
  );
  if (confirmText !== 'RESET') {
    if (confirmText !== null) message('adminStatus','Reset cancelled. Type RESET in capital letters to confirm.');
    return;
  }
  const success = await runAdmin(() => rpc('reset_to_intermediate',{}),
    'Everyone removed. Ready for a new session: Intermediate court, 12 empty teams, 6-player limit.');
  if (success) { pendingDestinations.clear(); setFollow(''); }
});

$('adminSection').addEventListener('change', event => {
  const select = event.target.closest('[data-team-court]');
  if (select) pendingDestinations.set(select.dataset.teamCourt,select.value);
});
$('adminSection').addEventListener('click',async event => {
  const target = event.target.closest('button[data-action]');
  if (!target || !admin || saving) return;
  const {action,id} = target.dataset;
  const team = teamById(id), player = players.find(item => item.id===id), court = courtById(id);

  if (action==='renameCourt' && court) {
    const name = prompt('New court name',court.name);
    if (name===null) return;
    try {await runAdmin(() => checkedMutation(db.from('courts').update({name:validName(name,40)}).eq('id',id)),'Court renamed');}
    catch(e){message('adminStatus',e.message,true);}
    return;
  }
  if (action==='deleteCourt' && court) {
    const affected = teams.filter(team => team.court_id===id).length;
    if (!confirm(`Remove ${court.name}? ${affected} assigned team(s) will become unassigned and return to waiting. No player signups will be deleted.`)) return;
    await runAdmin(() => rpc('remove_court',{target_court:id}),'Court removed; its teams are now unassigned');
    return;
  }
  if (action==='editTeam' && team) {
    const name = prompt('Team name',team.name);
    if (name===null) return;
    try {await runAdmin(() => checkedMutation(db.from('teams').update({name:validName(name)}).eq('id',id)),'Team renamed');}
    catch(e){message('adminStatus',e.message,true);}
    return;
  }
  if (action==='deleteTeam' && team) {
    if (!confirm(`Permanently delete ${team.name} and ALL ${roster(team).length} of its player signups?`)) return;
    await runAdmin(() => checkedMutation(db.from('teams').delete().eq('id',id)),'Team and signups removed');
    return;
  }
  if (action==='moveTeam' && team) {
    const destination = pendingDestinations.has(id) ? pendingDestinations.get(id)
      : document.querySelector(`[data-team-court="${id}"]`)?.value;
    const court_id = destination || null;
    const success = await runAdmin(() => checkedMutation(db.from('teams')
      .update({court_id,status:'waiting'}).eq('id',id)),'Team moved to waiting');
    if (success) pendingDestinations.delete(id);
    return;
  }
  if (action==='wait' && team) {
    await runAdmin(() => checkedMutation(db.from('teams')
      .update({status:'waiting'}).eq('id',id)),'Team returned to waiting');
    return;
  }
  if ((action==='up' || action==='down') && team) {
    const list = sortTeams(teams.filter(item => item.status==='waiting'));
    const index = list.findIndex(item => item.id === id);
    const other = list[index + (action==='up'?-1:1)];
    if (!other) {message('adminStatus','This team cannot move further in the queue.',true);return;}
    await runAdmin(() => rpc('swap_team_order',{first_id:id,second_id:other.id}),'Waiting order changed');
    return;
  }
  if (action==='renamePlayer' && player) {
    const name = prompt('Player name',player.name);
    if (name===null) return;
    try {await runAdmin(() => checkedMutation(db.from('players').update({name:(()=>{const n=validName(name);ensureUniquePlayerName(n,id);return n;})()}).eq('id',id)),'Player renamed');}
    catch(e){message('adminStatus',e.message,true);}
    return;
  }
  if (action==='editPosition' && player) {
    const input = prompt('Select a preferred position:\n'+positions.map((value,index)=>`${index+1}. ${value}`).join('\n'));
    if (input===null) return;
    const position = positions[Number(input)-1];
    if (!position) {message('adminStatus','Select a valid position number.',true);return;}
    await runAdmin(() => checkedMutation(db.from('players')
      .update({preferred_position:position}).eq('id',id)),'Preferred position changed');
    return;
  }
  if (action==='movePlayer' && player) {
    const eligible = sortTeams(teams.filter(team => team.status!=='done'));
    if (!eligible.length) {message('adminStatus','No available teams.',true);return;}
    const input = prompt(`Move ${player.name} to which team?\n`+eligible.map((item,i)=>`${i+1}. ${item.name} (${roster(item).length}/${maxTeamSize})`).join('\n'));
    if (input===null) return;
    const destination = eligible[Number(input)-1];
    if (!destination) {message('adminStatus','Select a valid team number.',true);return;}
    if (destination.id===player.team_id) {message('adminStatus','Player is already on that team.');return;}
    await runAdmin(() => checkedMutation(db.from('players')
      .update({team_id:destination.id}).eq('id',id)),'Player moved');
    return;
  }
  if (action==='adminRemoveSub') {
    const item = subs.find(sub=>sub.id===id);
    if (!item || !confirm(`Remove ${item.name} from the substitute list?`)) return;
    await runAdmin(() => rpc('admin_remove_sub',{target_sub:id}),'Substitute removed');
  }
  if (action==='deletePlayer' && player) {
    if (!confirm(`Remove ${player.name} from the signup list?`)) return;
    await runAdmin(() => checkedMutation(db.from('players').delete().eq('id',id)),'Player removed');
  }
});

if (!configured) {
  $('setupAlert').classList.remove('hidden');
  $('setupAlert').textContent = 'Database not connected. Check config.js (use the base https://project.supabase.co URL and publishable key).';
  $('signupForm').querySelector('button[type="submit"]').disabled = true;
} else {
  await checkAdmin();
  await load();
  startRealtime();
  // Reliable backup if a socket cannot connect, a message is missed or Realtime is disabled.
  setInterval(() => {
    if (document.hidden) return;
    scheduleRefresh(0);
    if (!realtimeConnected && navigator.onLine && !realtimeRetryTimer) {
      void reconnectRealtime();
    }
  }, BACKUP_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = null;
      connectionStatus('paused');
      void stopRealtime();
    } else {
      startRealtime();
      scheduleRefresh(0);
    }
  });
  window.addEventListener('online', () => {
    void reconnectRealtime();
    scheduleRefresh(0);
  });
  window.addEventListener('offline', () => connectionStatus('offline'));
  // iOS Safari can restore a page from its back-forward cache without reloading it.
  window.addEventListener('pageshow', event => {
    if (event.persisted && !document.hidden) {
      startRealtime();
      scheduleRefresh(0);
    }
  });
}
