import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pencil, Plus, RefreshCw, Trophy, X } from 'lucide-react';
import { apiRequest } from './api.js';
import SpringButton from './SpringButton.jsx';

const STORAGE_KEY = 'pulsedeck-sports-score';
const FOOTBALL_LEAGUES = [
  ['eng.1', 'Premier League'], ['esp.1', 'La Liga'], ['ger.1', 'Bundesliga'],
  ['ita.1', 'Serie A'], ['fra.1', 'Ligue 1'], ['uefa.champions', 'Champions League'],
  ['uefa.europa', 'Europa League'], ['usa.1', 'MLS'], ['ind.1', 'Indian Super League'],
  ['fifa.world', 'International'],
];
const CRICKET_TEAMS = [
  'Afghanistan', 'Australia', 'Bangladesh', 'England', 'India', 'Ireland',
  'New Zealand', 'Pakistan', 'South Africa', 'Sri Lanka', 'West Indies', 'Zimbabwe',
  'Chennai Super Kings', 'Delhi Capitals', 'Gujarat Titans', 'Kolkata Knight Riders',
  'Lucknow Super Giants', 'Mumbai Indians', 'Punjab Kings', 'Rajasthan Royals',
  'Royal Challengers Bengaluru', 'Sunrisers Hyderabad',
];

function loadSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || !['football', 'cricket'].includes(saved.sport) || typeof saved.teamName !== 'string') return null;
    if (saved.sport === 'football' && (!FOOTBALL_LEAGUES.some(([id]) => id === saved.league) || !/^\d+$/.test(String(saved.teamId)))) return null;
    return saved;
  } catch { return null; }
}

function utcDateKey(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function normalizeFootballEvent(event, teamId) {
  const competition = event.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  if (!competitors.some((item) => String(item.id) === String(teamId))) return null;
  const status = competition.status?.type || {};
  return {
    id: String(event.id || ''),
    name: event.shortName || event.name || '',
    date: event.date,
    status: status.shortDetail || status.detail || 'Scheduled',
    state: status.state || 'pre',
    teams: competitors.map((item) => ({
      id: String(item.id || ''),
      name: item.team?.shortDisplayName || item.team?.displayName || '',
      score: status.state === 'pre' ? '' : typeof item.score === 'object'
        ? item.score?.displayValue ?? item.score?.value ?? '—'
        : item.score ?? '—',
      logo: item.team?.logo || `https://a.espncdn.com/i/teamlogos/soccer/500/${item.id}.png`,
    })),
    url: `https://www.espn.com/soccer/match/_/gameId/${event.id || ''}`,
  };
}

async function loadPublicFootballSchedule(settings) {
  const baseUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(settings.league)}`;
  const response = await fetch(`${baseUrl}/teams/${encodeURIComponent(settings.teamId)}/schedule`);
  if (!response.ok) throw new Error('Football scores are unavailable');
  const schedule = await response.json();
  const matches = (schedule.events || []).map((event) => normalizeFootballEvent(event, settings.teamId)).filter(Boolean);
  let live = matches.filter((item) => item.state === 'in');
  const today = new Date().toISOString().slice(0, 10);
  let upcoming = matches.filter((item) => item.state === 'pre' && (item.date || '') >= today)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!live.length && !upcoming.length) {
    for (let dayOffset = 0; dayOffset <= 30; dayOffset += 1) {
      const date = utcDateKey(new Date(Date.now() + dayOffset * 86400000));
      const boardResponse = await fetch(`${baseUrl}/scoreboard?dates=${date}`);
      if (!boardResponse.ok) continue;
      const board = await boardResponse.json();
      const futureMatches = (board.events || []).map((event) => normalizeFootballEvent(event, settings.teamId))
        .filter((item) => item && ['in', 'pre'].includes(item.state));
      if (futureMatches.length) {
        live = futureMatches.filter((item) => item.state === 'in');
        upcoming = futureMatches.filter((item) => item.state === 'pre')
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        break;
      }
    }
  }
  return { matches: [...live, ...upcoming] };
}

async function loadScore(current) {
  const query = current.sport === 'football'
    ? `league=${encodeURIComponent(current.league)}&team=${encodeURIComponent(current.teamId)}`
    : `team=${encodeURIComponent(current.teamName)}`;
  try {
    return await apiRequest(`/api/sports/${current.sport}/score?${query}`);
  } catch (proxyError) {
    if (current.sport !== 'football') throw proxyError;
    // A phone can have internet access even when the PC host cannot reach the
    // score provider, so retry the public football feed from the browser.
    try {
      return await loadPublicFootballSchedule(current);
    } catch {
      throw proxyError;
    }
  }
}

function SportsScores() {
  const [settings, setSettings] = useState(loadSettings);
  const [editing, setEditing] = useState(false);
  const [sport, setSport] = useState(settings?.sport || 'football');
  const [league, setLeague] = useState(settings?.league || 'eng.1');
  const [teamId, setTeamId] = useState(settings?.teamId || '');
  const [teamName, setTeamName] = useState(settings?.teamName || '');
  const [teams, setTeams] = useState([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [score, setScore] = useState(null);
  const [scoreError, setScoreError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [portalTarget, setPortalTarget] = useState(null);

  useEffect(() => {
    setPortalTarget(document.getElementById('sports-score-slot'));
  }, []);

  useEffect(() => {
    if (!editing || sport !== 'football') {
      setTeams([]);
      return undefined;
    }
    let active = true;
    setLoadingTeams(true);
    apiRequest(`/api/sports/football/teams?league=${encodeURIComponent(league)}`)
      .then((data) => { if (active) setTeams(data.teams || []); })
      .catch(() => { if (active) setTeams([]); })
      .finally(() => { if (active) setLoadingTeams(false); });
    return () => { active = false; };
  }, [editing, sport, league]);

  const refreshScore = async (current = settings) => {
    if (!current) return;
    setRefreshing(true);
    setScoreError('');
    try {
      const result = await loadScore(current);
      setScore(result.matches?.[0] || null);
    } catch (error) {
      setScoreError(error.message || 'Scores are temporarily unavailable');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!settings) { setScore(null); return undefined; }
    let active = true;
    setRefreshing(true);
    const load = async () => {
      try {
        const result = await loadScore(settings);
        if (active) { setScore(result.matches?.[0] || null); setScoreError(''); }
      } catch (error) {
        if (active) setScoreError(error.message || 'Scores are temporarily unavailable');
      } finally {
        if (active) setRefreshing(false);
      }
    };
    load();
    const timer = window.setInterval(load, 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [settings]);

  const saveSettings = () => {
    const selectedTeam = sport === 'cricket'
      ? { id: teamName, name: teamName }
      : teams.find((team) => team.id === teamId);
    if (!selectedTeam) return;
    const next = { sport, league, teamId: selectedTeam.id, teamName: selectedTeam.name };
    setSettings(next);
    setScore(null);
    setEditing(false);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the selection for this session. */ }
  };

  const removeSettings = () => {
    setSettings(null);
    setScore(null);
    setScoreError('');
    setEditing(false);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Keep the feature removed for this session. */ }
  };

  const openEditor = () => {
    setSport(settings?.sport || 'football');
    setLeague(settings?.league || 'eng.1');
    setTeamId(settings?.teamId || '');
    setTeamName(settings?.teamName || '');
    setEditing(true);
  };

  const editorPanel = <div className="sports-config" aria-label="Configure sports scores">
      <div className="sports-config-heading"><Trophy className="h-3.5 w-3.5" /><span>TEAM SCORE</span></div>
      <label>Sport
        <select value={sport} onChange={(event) => { setSport(event.target.value); setTeamId(''); setTeamName(''); }}>
          <option value="football">Football</option><option value="cricket">Cricket</option>
        </select>
      </label>
      {sport === 'football' ? <>
        <label>League
          <select value={league} onChange={(event) => { setLeague(event.target.value); setTeamId(''); }}>
            {FOOTBALL_LEAGUES.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select>
        </label>
        <label>Team
          <select value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={loadingTeams || teams.length === 0}>
            <option value="">{loadingTeams ? 'Loading teams…' : 'Choose a team'}</option>
            {teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
          </select>
        </label>
      </> : <label>Team
        <select value={teamName} onChange={(event) => setTeamName(event.target.value)}>
          <option value="">Choose a team</option>
          {CRICKET_TEAMS.map((name) => <option value={name} key={name}>{name}</option>)}
        </select>
      </label>}
      <div className="sports-config-actions">
        <SpringButton type="button" className="sports-save" onClick={saveSettings} disabled={sport === 'football' ? !teamId : !teamName}><Check className="h-3 w-3" /> Save</SpringButton>
        <SpringButton type="button" className="sports-cancel" onClick={() => setEditing(false)}><X className="h-3 w-3" /> Cancel</SpringButton>
      </div>
    </div>;

  const matchTeams = score?.teams || [];
  const scoreStatus = score?.status || '';
  const scorePanel = <div className="sports-score" aria-live="polite">
    <div className="sports-score-heading">
      <span><Trophy className="h-3.5 w-3.5" /> {settings?.teamName || 'Team score'}</span>
      <div>
        <SpringButton type="button" onClick={() => refreshScore()} disabled={refreshing} aria-label="Refresh sports score" title="Refresh score"><RefreshCw className={`h-3 w-3 ${refreshing ? 'sports-refreshing' : ''}`} /></SpringButton>
        <SpringButton type="button" onClick={openEditor} aria-label="Change sport or team" title="Change sport or team"><Pencil className="h-3 w-3" /></SpringButton>
        <SpringButton type="button" onClick={removeSettings} aria-label="Remove sports score" title="Remove score"><X className="h-3 w-3" /></SpringButton>
      </div>
    </div>
    {scoreError ? <p className="sports-score-note">{scoreError}</p> : score ? <>
      <div className="sports-score-match">{matchTeams.map((team, index) => <React.Fragment key={`${team.name}-${index}`}>
        {index > 0 && <b className="sports-team-separator">·</b>}
        <span className="sports-team">
          {team.logo && <img src={team.logo} alt="" loading="lazy" />}
          <span>{team.name}</span><strong>{team.score || '—'}</strong>
        </span>
      </React.Fragment>)}</div>
      <div className="sports-score-status">{scoreStatus || score.name}</div>
      {score.url && <a className="sports-score-link" href={score.url} target="_blank" rel="noreferrer">Match details</a>}
    </> : <p className="sports-score-note">{refreshing ? 'Checking for a match…' : 'No live or upcoming match found.'}</p>}
  </div>;

  return <>
    <SpringButton type="button" className="profile-tab profile-add-button sports-profile-button" onClick={openEditor} title={settings ? 'Change the sports score team' : 'Add a team score'}>
      {settings ? <Trophy className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      <span>{settings ? 'Team score' : 'Add score'}</span>
    </SpringButton>
    {portalTarget && editing && createPortal(editorPanel, portalTarget)}
    {portalTarget && settings && !editing && createPortal(scorePanel, portalTarget)}
  </>;
}

export default SportsScores;
