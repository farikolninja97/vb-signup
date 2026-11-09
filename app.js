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
let registrationClosed = false;
let sessionStartedAt = null;
let blockedPeople = [];
const expandedHistoryDays = new Set();
const DEVICE_ID_KEY = 'vb-device-id-v114';
function getDeviceId() {
  try {
    let value=localStorage.getItem(DEVICE_ID_KEY);
    if (!value) { value=privateToken();localStorage.setItem(DEVICE_ID_KEY,value); }
    return value;
  } catch (_) { throw new Error('Enable browser storage to register players.'); }
}
const DAY_FORMAT = new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'});
const DAY_LABEL = new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'long',month:'long',day:'numeric',year:'numeric'});
function historyDayKey(date) { const pieces=DAY_FORMAT.formatToParts(new Date(date));const obj=Object.fromEntries(pieces.map(p=>[p.type,p.value]));return `${obj.year}-${obj.month}-${obj.day}`; }
function currentSessionHistory() {return completed.filter(item=>sessionStartedAt && new Date(item.completed_at)>=new Date(sessionStartedAt));}
function openingTeamCount(){return currentSessionHistory().length;}

// Shared admin display preference; new signups do not collect preferred positions.
let showPlayerPositions = true;
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
let subDraft = {open:false,playerId:'',teamId:null};
let selfLeaving = false;
const THEME_NAMES = ['default','halloween','christmas','thanksgiving','valentines','stpatricks','fourthofjuly','cosvolleyball'];
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
    fourthofjuly: {ball:'⭐', decorations:['🇺🇸','🎆','⭐','🎇']},
    cosvolleyball: {ball:'🏐', decorations:[]}
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
  // The COS theme shares the official site's visual assets without changing any other theme.
  let brandIcon = document.querySelector('link[data-cos-brand-icon]');
  if (siteTheme === 'cosvolleyball') {
    if (!brandIcon) {
      brandIcon = document.createElement('link');
      brandIcon.rel = 'icon';
      brandIcon.setAttribute('data-cos-brand-icon', '');
      document.head.appendChild(brandIcon);
    }
    brandIcon.type = 'image/png';
    brandIcon.href = 'https://cosvolleyball.github.io/favicon-32.png';
  } else if (brandIcon) {
    brandIcon.remove();
  }
  let appleIcon = document.querySelector('link[data-cos-apple-icon]');
  if (siteTheme === 'cosvolleyball') {
    if (!appleIcon) {
      appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      appleIcon.setAttribute('data-cos-apple-icon', '');
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = 'https://cosvolleyball.github.io/apple-touch-icon.png';
  } else if (appleIcon) {
    appleIcon.remove();
  }
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
  if (error?.code === '42501' && /blocked|closed|organizer|session/i.test(detail)) return detail;
  if (error?.code === '42501' || /permission denied/i.test(detail)) {
    return 'Permission denied. Run fix_existing_database.sql in Supabase SQL Editor, then sign out and back in. Details: ' + detail;
  }
  if (error?.code === '23505' && /players_name_unique_normalized|team_subs_name_normalized_unique|duplicate player name/i.test(detail)) return 'That name is already registered. Please use a different name.';
  if (error?.code === '23505') return 'A record with that name already exists. ' + detail;
  if (error?.code === 'PGRST202' || /Could not find the function public\.(signup_players_batch_owned|join_first_team_as_sub)/i.test(detail)) return 'V1.13 database update is missing. Run the Supabase TXT migration, then refresh the page. Details: ' + detail;
  if (error?.code === 'PGRST116') return 'The operation did not match a record. Refresh the page and try again.';
  return detail;
}
function button(label,action,id,kind='secondary',disabled=false) {
  return `<button type="button" class="${kind} small" data-action="${action}" data-id="${safe(id)}" ${disabled?'disabled':''}>${safe(label)}</button>`;
}
function playerHtml(player) {
  return `${safe(player.name)}${showPlayerPositions && player.preferred_position && player.preferred_position !== 'Flexible / Any' ? ` <span class="hint">(${safe(player.preferred_position)})</span>` : ''}`;
}
function teamTitle(team) {
  const count = teamCount(team);
  return `${safe(team.name)} <span class="hint">(${count}/${maxTeamSize}${count>=maxTeamSize?' · FULL':''})</span>`;
}
function subFormHtml(team) {
  const count = teamCount(team);
  if (registrationClosed) return '<p class="sub-full">Substitute registration is closed for today.</p>';
  if (count >= maxTeamSize) return '<p class="sub-full">This team is full. No subs needed.</p>';
  if (subDraft.teamId !== team.id) subDraft = {open:false,playerId:'',teamId:team.id};
  const opening = openingTeamCount() < 4;
  const waiting = sortTeams(teams.filter(item => item.status === 'waiting'));
  const eligible = players.filter(player =>
    Boolean(ownedPlayers[player.id]) && (opening ? myTeamRank(player,waiting) > 1 : myTeamRank(player,waiting) > 3) &&
    !subs.some(sub=>sub.source_player_id===player.id)
  );
  const choices = eligible.map(player=>`<option value="${safe(player.id)}" ${player.id===subDraft.playerId?'selected':''}>${safe(player.name)} · ${safe(teamById(player.team_id)?.name || 'Team')}</option>`).join('');
  const anyNew = opening;
  const validChoices = eligible.map(p=>p.id);
  if (anyNew) validChoices.push('__new__');
  if (!validChoices.includes(subDraft.playerId)) subDraft.playerId = eligible[0]?.id || (anyNew ? '__new__' : '');
  const explanation = opening
    ? `Opening four teams: the usual registration and queue-distance sub restrictions are waived (${openingTeamCount()}/4 teams have gone on). Your team still needs an open spot.`
    : 'You must already be signed up on a team at least three positions behind first. Use the device where you signed up.';
  return `<div class="sub-volunteer">
    <label class="sub-toggle"><input id="subOptIn" type="checkbox" ${subDraft.open?'checked':''} ${!validChoices.length?'disabled':''} /> <span><strong>I'd like to sub for this team</strong><small>${maxTeamSize-count} open ${maxTeamSize-count===1?'spot':'spots'} available</small></span></label>
    <p class="hint">${explanation}</p>
    ${!validChoices.length ? '<p class="sub-ineligible">No eligible signups on this device. Your team must be farther back in line.</p>' : ''}
    ${subDraft.open && validChoices.length ? `<form id="subForm" class="sub-fields">
      <label>Who is substituting?<select id="subPlayerChoice" name="subPlayerChoice" required>${choices}${opening ? `<option value="__new__" ${subDraft.playerId==='__new__'?'selected':''}>Someone not signed up yet</option>` : ''}</select></label>
      ${opening && subDraft.playerId==='__new__' ? '<label>Substitute name<input id="subNewName" maxlength="60" autocomplete="name" placeholder="Enter name" required></label>' : ''}
      <button class="primary" type="submit">Add me as a sub</button>
      <p class="message" id="subStatus" role="status"></p>
    </form>` : ''}
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
      ${count<maxTeamSize && !registrationClosed ? `<button type="button" class="secondary small join-team-button" data-join-team="${safe(team.id)}" aria-label="Join ${safe(team.name)} with ${maxTeamSize-count} open spots">＋ Join Team · ${maxTeamSize-count} ${maxTeamSize-count===1?'spot':'spots'} open</button>` : `<span class="team-full-badge">${registrationClosed?'Registration closed':'Team full'}</span>`}
      <div class="queue-roster">${count ? [
        ...items.map(player=>`<span class="roster-chip">${playerHtml(player)}</span>`),
        ...standIns.map(sub=>`<span class="roster-chip">${playerHtml(sub)} <span class="sub-tag">SUB</span></span>`)
      ].join(''):'<span class="roster-empty">No players signed up yet</span>'}</div>
      ${isNext?subFormHtml(team):''}
    </div>
  </div>`;
}

function renderPublic() {
  const signupEntry = $('openSignup');
  if (signupEntry) {signupEntry.disabled=registrationClosed;signupEntry.title=registrationClosed?'Registration is closed for today':'';}

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
    ${registrationClosed ? '<div class="day-closed-banner" role="status">🔒 Registration is closed for today. See you next session!</div>' : ''}
    <div class="public-court-actions top-queue-actions" role="group" aria-label="Queue controls">
      ${button('↶ Previous Team','undo','queue','secondary',publicRotating)}
      ${button('▶ Next Team','advance','queue','primary',publicRotating || !waiting.length || !courts.length)}
    </div>
    ${!admin ? '<p class="hint queue-admin-hint">Next and Previous: enter the shared 4-digit court PIN. Admins can use both without a PIN.</p>' : ''}
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

function renderPreviousTeam() {
  const entry = currentSessionHistory()[0];
  const host = $('recentTeamPanel');
  if (!host) return;
  host.classList.toggle('has-recent-team', Boolean(entry));
  $('recentTeamName').textContent = entry?.team_name || 'No previous team yet';
  let members = Array.isArray(entry?.roster) ? entry.roster : [];
  $('recentTeamPlayers').innerHTML = members.length
    ? members.map(person=>`<span class="recent-player">${playerHtml(person)}${person.is_sub?' <span class="sub-tag">SUB</span>':''}</span>`).join('')
    : (entry ? 'No players were signed up for that team.' : 'Press Next Team to see who just went on.');
}

function renderHistory() {
  renderPreviousTeam();
  const host = $('historyList');
  if (!host) return;
  const limit=Date.now()-30*24*60*60*1000;
  const entries=completed.filter(h=>new Date(h.completed_at).getTime()>=limit);
  const byDate=new Map();
  for (const entry of entries) {
    const key=historyDayKey(entry.completed_at);
    if (!byDate.has(key)) byDate.set(key,[]);
    byDate.get(key).push(entry);
  }
  host.innerHTML = byDate.size ? [...byDate].map(([date,items])=>{
    const isOpen=expandedHistoryDays.has(date);
    const description=DAY_LABEL.format(new Date(items[0].completed_at));
    return `<section class="history-day">
      <button type="button" class="history-day-button" data-history-day="${safe(date)}" aria-expanded="${isOpen}">
        <span><strong>📅 ${safe(description)}</strong><small>${items.length} ${items.length===1?'team':'teams'} played</small></span>
        <span aria-hidden="true">${isOpen?'▴':'▾'}</span>
      </button>
      ${isOpen ? `<div class="history-day-content">${items.map(item=>{
        const roster=Array.isArray(item.roster)?item.roster:[];
        const time=new Date(item.completed_at).toLocaleTimeString('en-US',{timeZone:'America/Denver',hour:'numeric',minute:'2-digit'});
        return `<article class="directory-card"><strong>${safe(item.team_name)}</strong>
          <div class="hint">${safe(time)} · ${roster.length} ${roster.length===1?'player':'players'}</div>
          <div class="players">${roster.length ? roster.map(person=>`${playerHtml(person)}${person.is_sub?' <span class="sub-tag">SUB</span>':''}`).join(' · ') : 'No players registered'}</div>
        </article>`;
      }).join('')}</div>` : ''}
    </section>`;
  }).join('') : '<div class="empty">No saved games during the past 30 days.</div>';
  $('historyCount').textContent=`${entries.length} previous ${entries.length===1?'team':'teams'} · ${byDate.size} ${byDate.size===1?'day':'days'}`;
}
$('historyList').addEventListener('click',event=>{
  const b=event.target.closest('button[data-history-day]');
  if (!b) return;
  const day=b.dataset.historyDay;
  if (expandedHistoryDays.has(day)) expandedHistoryDays.delete(day);
  else expandedHistoryDays.add(day);
  renderHistory();
});

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
      <div class="hint">${safe(team?.name || 'Team removed')}${showPlayerPositions && person.preferred_position && person.preferred_position !== 'Flexible / Any' ? ` · ${safe(person.preferred_position)}` : ''}</div></div>
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
  $('showPlayerPositions').checked = showPlayerPositions;
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
      <span class="hint">${showPlayerPositions && player.preferred_position && player.preferred_position !== 'Flexible / Any' ? `· ${safe(player.preferred_position)} · ` : '· '}${safe(teamById(player.team_id)?.name || 'Unknown team')}</span>
      <div class="actions">${button('Rename','renamePlayer',player.id)}
        ${button('Change position','editPosition',player.id)}${button('Move to team','movePlayer',player.id)}
        ${button('Remove','deletePlayer',player.id,'danger')}${button('Block','blockPlayer',player.id,'danger')}</div></div>`
  ).join('') || '<div class="empty">No players signed up.</div>';
  if (subs.length) {
    $('adminPlayers').innerHTML += `<p class="hint">Temporary substitutes</p>` + [...subs].sort((a,b)=>a.name.localeCompare(b.name)).map(sub => `
      <div class="admin-team"><strong>${safe(sub.name)}</strong> <span class="sub-tag">SUB</span>
      <span class="hint">· ${safe(teamById(sub.team_id)?.name || 'Unknown team')}</span>
      <div class="actions">${button('Remove sub','adminRemoveSub',sub.id,'danger')}</div></div>`).join('');
  }
  $('blockedPeopleList').innerHTML=blockedPeople.length ? blockedPeople.map(person=>
    `<div class="admin-team"><strong>${safe(person.display_name)}</strong> <span class="hint">${person.device_blocked?'· Name + browser blocked':'· Name blocked'}</span>
      <div class="actions">${button('Unblock','unblockPerson',person.normalized_name,'secondary')}</div></div>`
  ).join('') : '<p class="hint">No blocked player names.</p>';
  $('endDayStatus').textContent=registrationClosed?'🔒 Closed':'🟢 Open';
  $('endDayBtn').disabled=registrationClosed || saving;
}

async function loadBlockedPeople(){
  if(!admin || !db){blockedPeople=[];return;}
  try {blockedPeople=await rpc('vb_admin_list_blocks',{})||[];}
  catch(error){blockedPeople=[];message('adminStatus','Could not load the block list: '+explain(error),true);}
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
      db.from('queue_settings').select('max_team_size,site_theme,show_player_positions,registration_closed,session_started_at').eq('id',true).single(),
      db.from('completed_teams').select('id,team_name,roster,completed_at').gte('completed_at',new Date(Date.now()-30*86400000).toISOString()).order('completed_at',{ascending:false}).limit(1000)
    ]);
    for (const result of results) if (result.error) throw result.error;
    if (readVersion !== latestRead) return;
    [courts,teams,players,subs] = results.slice(0,4).map(result => result.data);
    maxTeamSize = results[4].data.max_team_size;
    registrationClosed = results[4].data.registration_closed===true;
    sessionStartedAt = results[4].data.session_started_at;
    showPlayerPositions = results[4].data.show_player_positions !== false;
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
  $('adminToggle').textContent = admin ? '⚙ Admin' : '⚙ Admin';
  $('adminToggle').setAttribute('aria-label', admin ? 'Open Admin Controls' : 'Open Admin Login');
  if (admin) {await loadBlockedPeople();renderAdmin();}
  else blockedPeople=[];
  renderPublic(); // Admins bypass the PIN; everyone else must enter it at each rotation.
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

// V1.14: Center-screen animated registration result dialog. No auto-hide:
// players must see whether the entire group was accepted or rejected.
const signupResultOverlay = $('signupResultToast');
let signupResultReturnFocus = null;
function dismissSignupToast() {
  if (signupResultOverlay.classList.contains('hidden')) return;
  const wasError = signupResultOverlay.dataset.kind === 'error';
  signupResultOverlay.classList.add('hidden');
  if ($('signupModalBackdrop').classList.contains('hidden')) document.body.classList.remove('signup-modal-open');
  const target = wasError && !$('signupModalBackdrop').classList.contains('hidden')
    ? $('playerName')
    : (signupResultReturnFocus?.isConnected && !signupResultReturnFocus.closest('.hidden')
        ? signupResultReturnFocus : $('openSignup'));
  signupResultReturnFocus = null;
  target?.focus?.({preventScroll:true});
}
function showSignupToast(kind, title, text) {
  signupResultReturnFocus = document.activeElement;
  signupResultOverlay.dataset.kind = kind;
  const dialog = signupResultOverlay.querySelector('.signup-result-dialog');
  dialog.setAttribute('role',kind === 'error' ? 'alertdialog' : 'dialog');
  $('signupToastEyebrow').textContent = kind === 'error' ? 'PLEASE CHECK YOUR SIGNUP' : 'YOU ARE ON THE LIST';
  $('signupToastTitle').textContent = title;
  $('signupToastMessage').textContent = text;
  $('signupResultAction').textContent = kind === 'error' ? 'Back to signup' : 'Awesome, thanks!';
  signupResultOverlay.classList.remove('hidden');
  document.body.classList.add('signup-modal-open');
  $('signupResultAction').focus({preventScroll:true});
}
$('closeSignupToast').addEventListener('click',dismissSignupToast);
$('signupResultAction').addEventListener('click',dismissSignupToast);
signupResultOverlay.addEventListener('click',event=>{
  if (event.target === signupResultOverlay) dismissSignupToast();
});
document.addEventListener('keydown',event=>{
  if (signupResultOverlay.classList.contains('hidden')) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); dismissSignupToast(); return; }
  if (event.key !== 'Tab') return;
  const focusable = [$('closeSignupToast'), $('signupResultAction')];
  const first = focusable[0], last = focusable[1];
  if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
  else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
});

// Signup is in an accessible top-of-page modal, not a permanent page section.
const signupBackdrop = $('signupModalBackdrop');
let signupPreviousFocus = null;
function openSignupModal(selectedTeam = '') {
  if (!document.documentElement.classList.contains('rules-accepted')) return;
  signupPreviousFocus = document.activeElement;
  signupBackdrop.classList.remove('hidden');
  document.body.classList.add('signup-modal-open');
  if (selectedTeam && [...$('teamChoice').options].some(option=>option.value===selectedTeam && !option.disabled)) $('teamChoice').value=selectedTeam;
  $('signupStatus').textContent='';
  $('playerName').focus({preventScroll:true});
}
function closeSignupModal() {
  signupBackdrop.classList.add('hidden');
  document.body.classList.remove('signup-modal-open');
  (signupPreviousFocus?.isConnected ? signupPreviousFocus : $('openSignup')).focus({preventScroll:true});
}
$('openSignup').addEventListener('click',()=>openSignupModal());

// V1.12: My Signups and My Team Alerts are on-demand dialogs.
// Existing elements and handlers are preserved so live updates continue to populate them.
let activeQuickDialog = null;
let quickPreviousFocus = null;
function closeQuickDialog(){
  if (!activeQuickDialog) return;
  activeQuickDialog.classList.add('hidden');
  activeQuickDialog = null;
  document.body.classList.remove('signup-modal-open');
  for (const el of [document.querySelector('.topbar'),$('mainContent'),document.querySelector('.site-footer')]) if (el) el.inert=false;
  const target = quickPreviousFocus?.isConnected ? quickPreviousFocus : $('openSignup');
  quickPreviousFocus = null;
  target?.focus?.({preventScroll:true});
}
function openQuickDialog(id){
  if (!document.documentElement.classList.contains('rules-accepted')) return;
  const backdrop = $(id);
  if (!backdrop || activeQuickDialog===backdrop) return;
  if (activeQuickDialog) closeQuickDialog();
  quickPreviousFocus = document.activeElement;
  activeQuickDialog = backdrop;
  backdrop.classList.remove('hidden');
  document.body.classList.add('signup-modal-open');
  for (const el of [document.querySelector('.topbar'),$('mainContent'),document.querySelector('.site-footer')]) if (el) el.inert=true;
  backdrop.querySelector('.quick-close')?.focus({preventScroll:true});
}
$('openMySignups').addEventListener('click',()=>openQuickDialog('mySignupsBackdrop'));
$('openTeamAlerts').addEventListener('click',()=>openQuickDialog('teamAlertsBackdrop'));
$('closeMySignups').addEventListener('click',closeQuickDialog);
$('closeTeamAlerts').addEventListener('click',closeQuickDialog);
for (const id of ['mySignupsBackdrop','teamAlertsBackdrop']) {
  $(id).addEventListener('click',event=>{if(event.target===$(id))closeQuickDialog();});
}
document.addEventListener('keydown',event=>{
  if (!activeQuickDialog) return;
  if (event.key==='Escape'){event.preventDefault();closeQuickDialog();return;}
  if (event.key!=='Tab') return;
  const focusable=[...activeQuickDialog.querySelectorAll('a[href],button:not([disabled]):not(.hidden),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
    .filter(el=>!el.closest('.hidden') && el.getClientRects().length);
  const first=focusable[0],last=focusable.at(-1);
  if (!first) return;
  if (event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
  else if (!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
});

$('courtGrid').addEventListener('click',event=>{
  const join=event.target.closest('button[data-join-team]');
  if (join) openSignupModal(join.dataset.joinTeam);
});
$('addMorePlayers').addEventListener('click',()=>{
  const wrap=$('extraPlayersWrap');
  const expanding=wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden',!expanding);
  $('addMorePlayers').setAttribute('aria-expanded',String(expanding));
  $('addMorePlayers').textContent=expanding?'－ Register one player only':'＋ Register multiple players';
  $('signupSubmit').textContent=expanding?'Sign up players':'Sign up player';
  if (expanding) $('extraPlayerNames').focus({preventScroll:true});
  else $('extraPlayerNames').value='';
});
$('closeSignup').addEventListener('click',closeSignupModal);
signupBackdrop.addEventListener('click',event=>{
  if (event.target===signupBackdrop) closeSignupModal();
});
document.addEventListener('keydown',event=>{
  if (signupBackdrop.classList.contains('hidden') || !signupResultOverlay.classList.contains('hidden')) return;
  if (event.key==='Escape') { event.preventDefault(); closeSignupModal(); return; }
  if (event.key!=='Tab') return;
  const focusable=[...signupBackdrop.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')];
  const first=focusable[0],last=focusable.at(-1);
  if (!first) return;
  if (event.shiftKey && document.activeElement===first) {event.preventDefault();last.focus();}
  else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
});

$('signupForm').addEventListener('submit',async event => {
  event.preventDefault();
  if (!signupResultOverlay.classList.contains('hidden')) return;
  if (!db) {
    const text = 'Registration is unavailable because the database is not connected. Please contact an organizer.';
    message('signupStatus',text,true);
    showSignupToast('error','Registration failed',text);
    return;
  }
  const submit = $('signupSubmit');
  const selectedTeam = $('teamChoice').value;
  const extraText = $('extraPlayersWrap').classList.contains('hidden') ? '' : $('extraPlayerNames').value;
  const entries = [$('playerName').value, ...extraText.split(/\r?\n/)].map(s=>s.trim()).filter(Boolean);
  let names;
  try {
    if (registrationClosed) throw new Error('Registrations have ended for today. Please come back next session.');
    if (!selectedTeam) throw new Error('Select a team first.');
    if (entries.length === 0) throw new Error('Enter at least one player name.');
    if (entries.length > 50) throw new Error('You can register up to 50 people in one submission.');
    names = entries.map(name=>validName(name));
    const unique=new Set(names.map(normalizedPlayerName));
    if (unique.size !== names.length) throw new Error('The list contains duplicate player names.');
    names.forEach(name=>ensureUniquePlayerName(name));
    const selected=teamById(selectedTeam);
    if (!selected || selected.status !== 'waiting') throw new Error('That team is no longer waiting. Refresh and choose another team.');
    if (teamCount(selected)+names.length > maxTeamSize) { const remaining=Math.max(0,maxTeamSize-teamCount(selected)); throw new Error(`Only ${remaining} ${remaining===1?'spot':'spots'} available on that team. No one in your group was registered.`); }
  } catch(error) { message('signupStatus',error.message,true); showSignupToast('error','Registration failed',error.message); return; }
  submit.disabled = true;
  try {
    // One RPC transaction for every name: either the entire group succeeds,
    // or the database rolls back every member, including when two phones
    // race to fill the last open spots.
    if (!storeOwned(OWNED_PLAYERS_KEY,ownedPlayers)) {
      throw new Error('Private signup storage is unavailable on this device. Enable browser storage and retry.');
    }
    const device_token=getDeviceId();
    const registrations=names.map(name=>({name,token:privateToken(),device_token}));
    const ids=await rpc('signup_players_batch_owned',{
      selected_team:selectedTeam,registrations
    });
    if (!Array.isArray(ids) || ids.length !== registrations.length) {
      throw new Error('Signup response was incomplete. Please check the team roster before trying again.');
    }
    registrations.forEach((entry,i)=>{ownedPlayers[ids[i]]=entry.token;});
    const savedTokens=storeOwned(OWNED_PLAYERS_KEY,ownedPlayers);
    setFollow(selectedTeam);
    $('playerName').value='';
    $('extraPlayerNames').value='';
    try {await load();} catch(error){console.warn('Queue refresh after successful signup:',error);}
    const detail=`${names.length===1?'Player successfully registered':'All '+names.length+' players successfully registered'} for ${teamById(selectedTeam)?.name||'the selected team'}!`;
    message('signupStatus',detail);
    closeSignupModal();
    showSignupToast('success','Registration successful!',detail + (savedTokens ? '' : ' Leave Team tokens were not saved on this device; ask an admin if you need a name removed.'));
  } catch(error) {
    // With the transaction-based RPC no submitted member should be saved
    // if any signup fails. Keep every name for correction/retry.
    const detail=explain(error);
    message('signupStatus',detail,true);
    showSignupToast('error','Registration failed',detail + ' No players in your group were registered.');
    try {await load();} catch(_){}
  } finally { submit.disabled=false; }
});
// Subs must already have an active signup owned on this device on a team
// at least three positions behind first. Server enforces the same restriction.
// Opening exception: the first four teams sent to play may use a registered
// substitute from any OTHER team or an unregistered substitute. From the fifth
// team onward, a substitute must own a signup 3+ positions behind first.
$('courtGrid').addEventListener('change',event => {
  if (event.target.id === 'subOptIn') {
    subDraft.open = event.target.checked;
    renderPublic();
    if (subDraft.open) $('subPlayerChoice')?.focus();
  }
  if (event.target.id === 'subPlayerChoice') {
    subDraft.playerId=event.target.value;
    renderPublic();
    $('subPlayerChoice')?.focus({preventScroll:true});
  }
});
$('courtGrid').addEventListener('submit',async event => {
  if (event.target.id !== 'subForm') return;
  event.preventDefault();
  const submit=event.target.querySelector('button[type=submit]');
  const opening=openingTeamCount()<4;
  const joiningNew=opening && subDraft.playerId==='__new__';
  const original=joiningNew ? null : players.find(player=>player.id===subDraft.playerId);
  let subName, token, sourceId=null;
  try {
    if (joiningNew) {
      subName=validName($('subNewName')?.value||'');
      ensureUniquePlayerName(subName);
      token=privateToken();
    } else {
      if (!original || !ownedPlayers[original.id]) throw new Error('Choose a signup registered from this device.');
      const waiting=sortTeams(teams.filter(t=>t.status==='waiting'));
      const rank=myTeamRank(original,waiting);
      if (rank===1 || (!opening && rank<=3)) throw new Error('Your team is too close to the front to sub for this team.');
      if (subs.some(sub=>sub.source_player_id===original.id)) throw new Error('You already have an active substitute spot.');
      subName=original.name;
      token=ownedPlayers[original.id];
      sourceId=original.id;
    }
  } catch(error){message('subStatus',error.message,true);return;}
  submit.disabled=true;
  try {
    if (!storeOwned(OWNED_SUBS_KEY,ownedSubs)) throw new Error('Enable browser storage to register a removable sub spot.');
    if (registrationClosed) throw new Error('Substitute registration is closed for today.');
    const id=await rpc('join_first_team_as_sub_v114',{
      sub_name:subName, sub_position:original?.preferred_position||'Flexible / Any',
      source_player_id:sourceId,leave_token:token,device_token:getDeviceId()
    });
    if (!id) throw new Error('The server did not return a substitute signup ID.');
    ownedSubs[id]=token;
    const stored=storeOwned(OWNED_SUBS_KEY,ownedSubs);
    subDraft={open:false,playerId:'',teamId:null};
    await load();
    message('queueStatus',stored ? `${subName} joined the first team as a sub!` : `${subName} was added, but this device could not save the Leave Sub Spot token. Ask an admin for help if needed.`,!stored);
  } catch(error){message('subStatus',explain(error),true);}
  finally{submit.disabled=false;}
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

// Queue controls require a verified admin account OR the 4-digit PIN.
// The code is never saved in browser storage, HTML or config.js.
const queuePinBackdrop=$('queuePinBackdrop');
let pendingQueueAction=null;
let queuePinReturnFocus=null;
function closeQueuePin(){
  queuePinBackdrop.classList.add('hidden');
  $('queuePinInput').value='';
  $('queuePinStatus').textContent='';
  const target=queuePinReturnFocus;
  pendingQueueAction=null;
  if (target?.isConnected) target.focus({preventScroll:true});
}
function openQueuePin(action,buttonElement){
  pendingQueueAction=action;
  queuePinReturnFocus=buttonElement;
  $('queuePinTitle').textContent=action==='advance'?'PIN required · Next Team':'PIN required · Previous Team';
  $('queuePinExplanation').textContent='Enter the four-digit PIN set by your organizer. Your PIN is checked securely by Supabase.';
  $('queuePinStatus').textContent='';
  $('queuePinInput').value='';
  queuePinBackdrop.classList.remove('hidden');
  $('queuePinInput').focus({preventScroll:true});
}
$('queuePinClose').addEventListener('click',closeQueuePin);
queuePinBackdrop.addEventListener('click',e=>{if(e.target===queuePinBackdrop) closeQueuePin();});
document.addEventListener('keydown',e=>{
  if (queuePinBackdrop.classList.contains('hidden')) return;
  if(e.key==='Escape'){e.preventDefault();closeQueuePin();return;}
  if(e.key==='Tab'){
    const controls=[...queuePinBackdrop.querySelectorAll('button,input')];
    if(e.shiftKey && document.activeElement===controls[0]){e.preventDefault();controls.at(-1).focus();}
    else if(!e.shiftKey && document.activeElement===controls.at(-1)){e.preventDefault();controls[0].focus();}
  }
});
async function rotateQueue(action,pin=null){
  if (!db || publicRotating) return;
  publicRotating=true;
  $('courtGrid').querySelectorAll('button[data-action]').forEach(button=>{button.disabled=true;});
  message('queueStatus',action==='advance'?'Advancing team…':'Restoring previous team…');
  try {
    const result=await rpc('rotate_queue_with_pin',{direction:action==='advance'?'next':'previous',pin:pin});
    if (!result?.ok) throw new Error(result?.message||'Unable to rotate the queue.');
    message('queueStatus',action==='advance'?'Team saved in History. Next team is now first in line.':'Previous team and its original players restored.');
    await load();
    return true;
  } catch(error){message('queueStatus',explain(error),true);throw error;}
  finally {publicRotating=false;renderPublic();}
}
$('queuePinForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!pendingQueueAction)return;
  const pin=$('queuePinInput').value;
  if(!/^\d{4}$/.test(pin)){message('queuePinStatus','Enter exactly four digits.',true);return;}
  const submit=$('queuePinForm').querySelector('button[type=submit]');
  submit.disabled=true;
  try {await rotateQueue(pendingQueueAction,pin);closeQueuePin();}
  catch(error){message('queuePinStatus',explain(error),true);$('queuePinInput').select();}
  finally {submit.disabled=false;}
});
// Next atomically archives the outgoing team and its roster; Previous restores the latest archive and roster.
$('courtGrid').addEventListener('click', async event => {
  const target=event.target.closest('button[data-action]');
  if(!target || !db || publicRotating)return;
  const {action}=target.dataset;
  if(action!=='advance' && action!=='undo')return;
  if(!admin){openQueuePin(action,target);return;}
  try {await rotateQueue(action,null);}
  catch(_) { /* rotateQueue displays the error in the public queue status. */ }
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
$('showPlayerPositions').addEventListener('change', async (event) => {
  if (!admin || saving) return;
  const requested = event.target.checked;
  const previous = showPlayerPositions;
  // Instantly update current view; revert if the database refuses the change.
  showPlayerPositions = requested;
  renderPublic();
  renderAdmin();
  const saved = await runAdmin(async () => {
    const {data,error} = await db.from('queue_settings')
      .update({show_player_positions:requested}).eq('id',true)
      .select('show_player_positions').maybeSingle();
    if (error) throw error;
    if (!data || data.show_player_positions !== requested)
      throw new Error('Position visibility was not saved. Run V1.08 SQL in Supabase and retry.');
  }, requested ? 'Preferred positions are now shown to everyone.' : 'Preferred positions are hidden from public rosters, History, and Kiosk Mode.');
  if (!saved) {
    showPlayerPositions = previous;
    renderPublic();
    renderAdmin();
  } else if (realtimeChannel && realtimeConnected) {
    // Inform open kiosk screens immediately. The event carries no visibility value:
    // recipients always verify the authoritative setting directly from Supabase.
    void realtimeChannel.send({type:'broadcast',event:'queue_changed',payload:{refresh:true}})
      .catch(() => { /* The server-side trigger and 60-second fallback still apply. */ });
  }
});
$('saveQueuePin').addEventListener('click',async()=>{
  if(!admin||saving)return;
  const code=$('newQueuePin').value.trim();
  if(!/^\d{4}$/.test(code)){message('adminStatus','Enter exactly four digits for the new court-control PIN.',true);return;}
  const saved=await runAdmin(()=>rpc('set_queue_control_pin',{new_pin:code}),'New four-digit court-control PIN saved. Share it only with people allowed to control the queue.');
  if(saved)$('newQueuePin').value='';
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
$('endDayBtn').addEventListener('click',async()=>{
  if (!admin || registrationClosed || saving) return;
  if (!confirm('End today’s drop-in session? Everyone will be blocked from registering players or substitutes. History stays saved for 30 days. A full Reset starts a new session and reopens signups.')) return;
  await runAdmin(()=>rpc('vb_end_day',{}),'Day ended. Registration and substitutes are now closed; History was preserved.');
});
$('blockNameBtn').addEventListener('click',async()=>{
  if (!admin || saving) return;
  const name=$('blockNameInput').value.trim();
  if (!name) {message('adminStatus','Enter a name to block.',true);return;}
  if (!confirm(`Block the name “${name}” from registering? Already registered players are not automatically removed unless you use Block beside their signup.`)) return;
  const success=await runAdmin(()=>rpc('vb_admin_block_name',{block_name:name}),'Name blocked from registration.');
  if(success){$('blockNameInput').value='';await loadBlockedPeople();renderAdmin();}
});
$('resetDefaultsBtn').addEventListener('click',async() => {
  if (!admin || saving) return;
  const confirmText = prompt(
    'START A NEW DAY? This permanently deletes all CURRENT player signups, courts, teams and current-session Undo.\n' +
    'It then creates one Intermediate court and 12 empty teams (maximum 6 players each).\n' +
    'The last 30 days of History and your admin login are KEPT. Registrations reopen.\n\nType RESET to continue:'
  );
  if (confirmText !== 'RESET') {
    if (confirmText !== null) message('adminStatus','Reset cancelled. Type RESET in capital letters to confirm.');
    return;
  }
  const success = await runAdmin(() => rpc('reset_to_intermediate',{}),
    'New session started. Everyone removed from active teams. History preserved for 30 days. Registration reopened.');
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

  if (action==='blockPlayer' && player) {
    if (!confirm(`Block ${player.name} from signing up and remove their active registration?`)) return;
    const blockDevice=confirm('Also block the browser used for this signup? This may affect other players who registered using the same shared phone. Cancel = block the name only.');
    const success=await runAdmin(()=>rpc('vb_admin_block_player',{target_player:id,block_device:blockDevice}),'Player removed and blocked.');
    if (success){await loadBlockedPeople();renderAdmin();}
    return;
  }
  if (action==='unblockPerson') {
    if(!confirm(`Unblock “${id}” so this name can register again?`))return;
    const success=await runAdmin(()=>rpc('vb_admin_unblock_name',{target_name:id}),'Name unblocked.');
    if(success){await loadBlockedPeople();renderAdmin();}
    return;
  }
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
