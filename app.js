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

let courts = [], teams = [], players = [], maxTeamSize = 6;
let admin = false, loading = false, saving = false;
let latestRead = 0;
const pendingDestinations = new Map();
const sortTeams = values => [...values].sort((a,b) =>
  Number(a.queue_order) - Number(b.queue_order) ||
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
const sortCourts = values => [...values].sort((a,b) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name));
const roster = team => players.filter(player => player.team_id === team.id);
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
  if (error?.code === '23505') return 'That name is already used. Choose a different name. ' + detail;
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
  const count = roster(team).length;
  return `${safe(team.name)} <span class="hint">(${count}/${maxTeamSize}${count>=maxTeamSize?' · FULL':''})</span>`;
}
function teamCard(team,isNext=false) {
  const items = roster(team);
  return `<div class="team-row ${isNext?'next':''}">
    <div><div class="team-name">${isNext?'<span class="next-label">NEXT UP</span> ':''}${teamTitle(team)}</div>
    <div class="players">${items.length?items.map(playerHtml).join(' · '):'No players yet'}</div></div></div>`;
}

function renderPublic() {
  // Keep a selected team if it is still eligible while auto-refreshing.
  const chosen = $('teamChoice').value;
  const available = sortTeams(teams.filter(team => team.status !== 'done'));
  $('teamChoice').innerHTML = '<option value="">Choose a team</option>' + available.map(team => {
    const count = roster(team).length;
    const full = count >= maxTeamSize;
    return `<option value="${safe(team.id)}" ${full?'disabled':''}>${safe(team.name)} · ${count}/${maxTeamSize}${full?' · FULL':''}</option>`;
  }).join('');
  if (available.some(team => team.id === chosen && roster(team).length < maxTeamSize)) {
    $('teamChoice').value = chosen;
  }

  $('courtGrid').innerHTML = sortCourts(courts).map(court => {
    const playing = sortTeams(teams.filter(team => team.court_id === court.id && team.status === 'playing'));
    const waiting = sortTeams(teams.filter(team => team.court_id === court.id && team.status === 'waiting'));
    const fullMatchup = waiting.length >= 2;
    return `<article class="court-card">
      <div class="court-top"><h3>🏐 ${safe(court.name)}</h3><span class="tag">${waiting.length} waiting</span></div>
      <div class="subtitle">Playing now</div>
      ${playing.length?playing.map(team => teamCard(team)).join(''):'<div class="empty">Open court</div>'}
      <div class="subtitle">${fullMatchup?'Next matchup':'Waiting for teams'}</div>
      ${waiting.length?waiting.slice(0,2).map(team => teamCard(team,fullMatchup)).join(''):'<div class="empty">No teams in queue</div>'}
      ${waiting.length === 1?'<p class="hint">One more waiting team needed for a matchup.</p>':''}
      ${waiting.length > 2?`<div class="subtitle">Later</div>${waiting.slice(2).map(team => teamCard(team)).join('')}`:''}
    </article>`;
  }).join('') || '<div class="empty">No courts configured yet. An admin can add one.</div>';

  $('playerCount').textContent = `${players.length} players`;
  $('teamDirectory').innerHTML = sortTeams(teams.filter(team => team.status !== 'done')).map(team => {
    const members = roster(team);
    return `<div class="directory-card">
      <strong>${teamTitle(team)}</strong>
      <div class="hint">${safe(courtById(team.court_id)?.name || 'Unassigned')} · ${safe(team.status)}</div>
      <div class="players">${members.length?members.map(playerHtml).join(' · '):'No signups yet'}</div>
    </div>`;
  }).join('') || '<div class="empty">No teams yet. Ask an admin to add them.</div>';
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

  $('courtControls').innerHTML = sortCourts(courts).map(court => {
    const waiting = teams.filter(team => team.court_id === court.id && team.status === 'waiting').length;
    return `<div class="admin-team">
      <div class="admin-heading"><strong>${safe(court.name)}</strong><span class="hint">${waiting} waiting teams</span></div>
      <div class="actions">${button('▶ Next matchup','advance',court.id,'primary',waiting<2)}
        ${button('↶ Undo last advance','undo',court.id)}</div>
    </div>`;
  }).join('') || '<div class="empty">Add your first court below.</div>';

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
}

async function load(forceAdminRender=false) {
  if (!db || loading) return;
  loading = true;
  const readVersion = ++latestRead;
  try {
    const results = await Promise.all([
      db.from('courts').select('*').order('sort_order'),
      db.from('teams').select('*').order('queue_order'),
      db.from('players').select('*').order('created_at'),
      db.from('queue_settings').select('max_team_size').eq('id',true).single()
    ]);
    for (const result of results) if (result.error) throw result.error;
    if (readVersion !== latestRead) return;
    [courts,teams,players] = results.slice(0,3).map(result => result.data);
    maxTeamSize = results[3].data.max_team_size;
    renderPublic();
    if (forceAdminRender) document.activeElement?.blur?.();
    renderAdmin();
    $('refreshBadge').textContent = 'Updated ' + new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  } catch (error) {
    $('refreshBadge').textContent = 'Refresh failed: ' + explain(error);
  } finally {
    loading = false;
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
}
function validName(value,max=60) {
  const name = (value || '').trim();
  if (!name || name.length>max) throw new Error(`Enter a name between 1 and ${max} characters.`);
  return name;
}

$('signupForm').addEventListener('submit',async event => {
  event.preventDefault();
  if (!db) return;
  const submit = $('signupForm').querySelector('button[type="submit"]');
  const playerName = $('playerName').value.trim();
  const selectedTeam = $('teamChoice').value;
  const playerPosition = $('playerPosition').value;
  if (!playerName || !selectedTeam || !playerPosition) {
    message('signupStatus','Enter your name, preferred position and team.',true);
    return;
  }
  submit.disabled = true;
  try {
    await rpc('signup_player',{
      player_name:playerName, selected_team:selectedTeam, player_position:playerPosition
    });
    $('playerName').value = '';
    $('playerPosition').value = '';
    message('signupStatus','You are signed up!');
    await load();
  } catch (error) {
    message('signupStatus',explain(error),true);
  } finally {
    submit.disabled = false;
  }
});
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
$('resetQueueBtn').addEventListener('click',async() => {
  if (!confirm('Return all teams to waiting and clear Undo history? Player signups will stay.')) return;
  await runAdmin(() => rpc('reset_dropin_session',{clear_players:false}),'Queues reset; player signups kept');
});
$('clearSignupsBtn').addEventListener('click',async() => {
  if (!confirm('Start a new drop-in session? This permanently clears ALL player signups and resets team statuses.')) return;
  if (!confirm('Confirm: delete every player signup? This cannot be undone.')) return;
  await runAdmin(() => rpc('reset_dropin_session',{clear_players:true}),'All player signups cleared for the next session');
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

  if (action==='advance' || action==='undo') {
    await runAdmin(() => rpc(action==='advance'?'advance_court':'undo_court',{target_court:id}),
      action==='advance'?'Court advanced':'Last advance undone');
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
    const list = sortTeams(teams.filter(item => item.court_id===team.court_id && item.status==='waiting'));
    const index = list.findIndex(item => item.id === id);
    const other = list[index + (action==='up'?-1:1)];
    if (!other) {message('adminStatus','This team cannot move further in the waiting queue.',true);return;}
    await runAdmin(() => rpc('swap_team_order',{first_id:id,second_id:other.id}),'Waiting order changed');
    return;
  }
  if (action==='renamePlayer' && player) {
    const name = prompt('Player name',player.name);
    if (name===null) return;
    try {await runAdmin(() => checkedMutation(db.from('players').update({name:validName(name)}).eq('id',id)),'Player renamed');}
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
  setInterval(() => {if (!document.hidden && !saving) load();},5000);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) load();});
}
