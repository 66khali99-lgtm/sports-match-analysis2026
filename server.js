const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const API_KEY = process.env.FOOTBALL_DATA_API_KEY || "a9d6540ab8214aedbacdc27adea3fda8";
const PORT = process.env.PORT || 3000;
const API_BASE = "https://api.football-data.org/v4";

// Flashscore-style display names for the most common clubs. Data itself comes
// from football-data.org; these aliases only control what the user sees/searches.
const DISPLAY_NAMES = {
  "manchester united": "Manchester Utd", "man united": "Manchester Utd", "man utd": "Manchester Utd",
  "atletico madrid": "Atl. Madrid", "atlético madrid": "Atl. Madrid", atletico: "Atl. Madrid",
  "as roma": "AS Roma", roma: "AS Roma", "inter milan": "Inter", inter: "Inter",
  "ac milan": "AC Milan", milan: "AC Milan", "paris saint-germain": "PSG", psg: "PSG",
  "bayern munich": "Bayern Munich", bayern: "Bayern Munich", "borussia dortmund": "Dortmund", dortmund: "Dortmund",
  "fc porto": "FC Porto", porto: "FC Porto", "sporting cp": "Sporting CP", sporting: "Sporting CP",
  "benfica": "Benfica", "ajax": "Ajax", "real madrid": "Real Madrid", barcelona: "Barcelona",
  "real sociedad": "Real Sociedad", sevilla: "Sevilla", villarreal: "Villarreal", "real betis": "Real Betis",
  "manchester city": "Manchester City", "man city": "Manchester City", liverpool: "Liverpool", arsenal: "Arsenal",
  chelsea: "Chelsea", tottenham: "Tottenham", spurs: "Tottenham", newcastle: "Newcastle Utd",
  "aston villa": "Aston Villa", brighton: "Brighton", "west ham": "West Ham", everton: "Everton",
  "nottingham forest": "Nottingham", "crystal palace": "Crystal Palace", fulham: "Fulham", bournemouth: "Bournemouth",
  "bayer leverkusen": "Leverkusen", leverkusen: "Leverkusen", "rb leipzig": "RB Leipzig", leipzig: "RB Leipzig",
  juventus: "Juventus", napoli: "Napoli", lazio: "Lazio", atalanta: "Atalanta",
  marseille: "Marseille", lyon: "Lyon", monaco: "Monaco", lille: "Lille", nice: "Nice",
  psv: "PSV", "psv eindhoven": "PSV", feyenoord: "Feyenoord", galatasaray: "Galatasaray",
  fenerbahce: "Fenerbahçe", "fenerbahçe": "Fenerbahçe", besiktas: "Besiktas", "beşiktaş": "Besiktas",
  "al hilal": "Al Hilal", "al nassr": "Al Nassr", "al ahly": "Al Ahly", "wydad casablanca": "Wydad AC",
  "wydad ac": "Wydad AC", "raja casablanca": "Raja CA", "raja club athletic": "Raja CA"
};

const SEARCH_ALIASES = {
  "manchester utd": ["Manchester United", "Man United", "Man Utd"],
  "atl. madrid": ["Atletico Madrid", "Atlético Madrid", "Atletico"],
  "as roma": ["Roma", "AS Roma"],
  "inter": ["Inter Milan", "Internazionale"],
  "ac milan": ["Milan"],
  "psg": ["Paris Saint-Germain", "Paris SG"],
  "dortmund": ["Borussia Dortmund", "BVB"],
  "leverkusen": ["Bayer Leverkusen"],
  "fc porto": ["Porto", "FC Porto"],
  "sporting cp": ["Sporting", "Sporting Lisbon"]
};

const PRIORITY_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "PPL", "DED", "ELC", "CL", "EL", "EC", "WC", "CLI", "MLS"];
const teamCache = new Map();
let cacheReady = false;
let cachePromise = null;

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s.&'-]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function displayName(team) {
  const n = normalize(team?.name || team?.shortName || "");
  return DISPLAY_NAMES[n] || team?.shortName || team?.name || "Unknown";
}

function addTeam(team) {
  if (!team?.id || !team?.name) return;
  const item = { id: team.id, name: displayName(team), officialName: team.name, shortName: team.shortName, tla: team.tla, crest: team.crest, area: team.area?.name || "" };
  const existing = teamCache.get(team.id);
  if (!existing || item.name.length < existing.name.length) teamCache.set(team.id, item);
}

async function fetchFootball(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API ${res.status}: ${t.slice(0, 220)}`);
  }
  return res.json();
}

async function loadTeams() {
  if (cacheReady) return;
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      // The API exposes a general team list and competition-specific lists.
      // We keep a local cache so typing a team never needs a request per keystroke.
      for (let offset = 0; offset < 500; offset += 100) {
        const data = await fetchFootball(`/teams?limit=100&offset=${offset}`);
        (data.teams || []).forEach(addTeam);
        if (!(data.teams || []).length || (data.teams || []).length < 100) break;
      }
    } catch (_) {}

    for (const code of PRIORITY_COMPETITIONS) {
      try {
        const data = await fetchFootball(`/competitions/${code}/teams`);
        (data.teams || []).forEach(addTeam);
      } catch (_) {}
    }

    cacheReady = true;
  })();
  return cachePromise;
}

function scoreCandidate(item, q) {
  const nq = normalize(q);
  const name = normalize(item.name);
  const official = normalize(item.officialName);
  const short = normalize(item.shortName);
  const tla = normalize(item.tla);
  if (name === nq) return 1000;
  if (short === nq || official === nq) return 950;
  if (name.startsWith(nq)) return 800;
  if (short.startsWith(nq) || official.startsWith(nq)) return 760;
  if (name.includes(nq) || short.includes(nq) || official.includes(nq)) return 600;
  if (tla === nq) return 550;
  const aliasHit = Object.entries(SEARCH_ALIASES).some(([canonical, aliases]) => normalize(canonical) === nq && aliases.some(a => normalize(a) === name || normalize(a) === short || normalize(a) === official));
  return aliasHit ? 700 : 0;
}

async function searchTeams(q) {
  await loadTeams();
  const query = normalize(q);
  if (!query) return Array.from(teamCache.values()).sort((a,b) => a.name.localeCompare(b.name)).slice(0, 30);
  return Array.from(teamCache.values())
    .map(t => ({ ...t, _score: scoreCandidate(t, query) }))
    .filter(t => t._score > 0)
    .sort((a,b) => b._score - a._score || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map(({_score, ...t}) => t);
}

function findTeam(q) {
  const nq = normalize(q);
  for (const t of teamCache.values()) {
    if ([t.name, t.officialName, t.shortName, t.tla].some(v => normalize(v) === nq)) return t;
  }
  const candidates = Array.from(teamCache.values()).map(t => ({t, s: scoreCandidate(t, q)})).filter(x => x.s > 0).sort((a,b)=>b.s-a.s);
  return candidates[0]?.t || null;
}

function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poissonP(lambda, k) { if (lambda <= 0) return k === 0 ? 1 : 0; return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k); }

function finishedGoals(m, teamId) {
  const home = m.homeTeam.id === teamId;
  const gf = home ? m.score?.fullTime?.home : m.score?.fullTime?.away;
  const ga = home ? m.score?.fullTime?.away : m.score?.fullTime?.home;
  return gf == null || ga == null ? null : { gf, ga, home };
}

function calcMetrics(matches, teamId) {
  const played = matches.map(m => ({ m, g: finishedGoals(m, teamId) })).filter(x => x.g);
  if (!played.length) return { attack: 1.35, defense: 1.35, form: 50, homeAttack: 1.35, awayAttack: 1.35 };
  let points = 0, weight = 0, scored = 0, conceded = 0, homeScored = 0, homeCount = 0, awayScored = 0, awayCount = 0;
  played.slice(0, 12).forEach(({g}, i) => {
    const w = 12 - i;
    const p = g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0;
    points += (p + Math.max(-1.5, Math.min(1.5, g.gf - g.ga)) * 0.2) * w;
    weight += w; scored += g.gf; conceded += g.ga;
    if (g.home) { homeScored += g.gf; homeCount++; } else { awayScored += g.gf; awayCount++; }
  });
  return {
    attack: scored / played.length,
    defense: conceded / played.length,
    form: weight ? Math.max(0, Math.min(100, (points / weight / 3) * 100)) : 50,
    homeAttack: homeCount ? homeScored / homeCount : scored / played.length,
    awayAttack: awayCount ? awayScored / awayCount : scored / played.length
  };
}

function predict(homeMatches, awayMatches, homeId, awayId, homeName, awayName) {
  const h = calcMetrics(homeMatches, homeId), a = calcMetrics(awayMatches, awayId);
  const leagueAvg = 1.35;
  const formDiff = (h.form - a.form) / 100;
  let xgH = ((h.homeAttack / leagueAvg) * (a.defense / leagueAvg) * leagueAvg) * 1.14;
  let xgA = ((a.awayAttack / leagueAvg) * (h.defense / leagueAvg) * leagueAvg);
  xgH *= 1 + formDiff * 0.12; xgA *= 1 - formDiff * 0.10;
  xgH = Math.max(0.25, Math.min(4.0, xgH)); xgA = Math.max(0.2, Math.min(3.7, xgA));

  let hw=0,d=0,aw=0,o25=0,btts=0,maxP=0,most="1-1";
  for(let i=0;i<=8;i++) for(let j=0;j<=8;j++) {
    const p=poissonP(xgH,i)*poissonP(xgA,j);
    if(i>j) hw+=p; else if(i===j) d+=p; else aw+=p;
    if(i+j>=3) o25+=p; if(i>0&&j>0) btts+=p;
    if(p>maxP){maxP=p;most=`${i}-${j}`;}
  }
  const total=hw+d+aw; hw/=total; d/=total; aw/=total;
  const overallH=Math.round(Math.max(25,Math.min(98,h.form*0.45+h.attack*19+(2.2-h.defense)*22+14)));
  const overallA=Math.round(Math.max(25,Math.min(98,a.form*0.45+a.attack*19+(2.2-a.defense)*22+8)));
  const confidence=Math.round(Math.max(42,Math.min(91,55+Math.min(homeMatches.length,awayMatches.length)*2.2+Math.abs(h.form-a.form)*0.18)));
  const favorite=hw>aw+0.08?homeName:aw>hw+0.08?awayName:null;
  const totalXg=xgH+xgA;
  const keyBattle=Math.abs(h.form-a.form)>18?"Recent form gap is the biggest factor in this matchup":totalXg>3.0?"Open transitions and finishing quality should decide the match":"Midfield control and defensive discipline should decide the match";
  const insights=[];
  if(h.attack>1.7) insights.push(`${homeName} average ${h.attack.toFixed(2)} goals across the recent sample.`);
  if(a.attack>1.7) insights.push(`${awayName} average ${a.attack.toFixed(2)} goals across the recent sample.`);
  if(h.defense<1.0) insights.push(`${homeName} have conceded under 1.00 goal per match in the sample.`);
  if(a.defense<1.0) insights.push(`${awayName} have conceded under 1.00 goal per match in the sample.`);
  if(h.defense>1.6) insights.push(`${homeName} have shown defensive vulnerability.`);
  if(a.defense>1.6) insights.push(`${awayName} have shown defensive vulnerability.`);
  if(o25>0.62) insights.push("The model sees a strong probability of at least three goals.");
  if(btts>0.62) insights.push("Both teams have a strong scoring probability.");
  if(!insights.length) insights.push("The available data points to a competitive matchup with no single overwhelming edge.");
  const narrative=`${homeName} vs ${awayName} projects as ${totalXg>3.2?"an open, high-tempo match":totalXg<2.1?"a tight tactical contest":"a balanced match with chances at both ends"}. ${favorite?`The model gives ${favorite} the edge.`:"The model sees the game as relatively even."} Most likely score: ${most} with expected goals of ${xgH.toFixed(2)}–${xgA.toFixed(2)}.`;
  return {homeWinProb:+(hw*100).toFixed(1),drawProb:+(d*100).toFixed(1),awayWinProb:+(aw*100).toFixed(1),expectedHomeGoals:+xgH.toFixed(2),expectedAwayGoals:+xgA.toFixed(2),mostLikelyScore:most,over25Prob:+(o25*100).toFixed(1),bttsProb:+(btts*100).toFixed(1),confidence,homeStrength:{overall:overallH,attack:Math.min(100,h.attack*35),defense:Math.min(100,Math.max(5,(2.6-h.defense)*40)),formScore:Math.round(h.form)},awayStrength:{overall:overallA,attack:Math.min(100,a.attack*35),defense:Math.min(100,Math.max(5,(2.6-a.defense)*40)),formScore:Math.round(a.form)},keyBattle,narrative,homeFormScore:Math.round(h.form),awayFormScore:Math.round(a.form),deepInsights:insights};
}

async function analyze(homeQuery, awayQuery) {
  await loadTeams();
  const home = findTeam(homeQuery), away = findTeam(awayQuery);
  if(!home || !away) throw new Error("Team not found. Start typing the club name and choose a suggestion from the list.");
  if(home.id===away.id) throw new Error("Please choose two different teams.");
  const [hm,am,hi,ai]=await Promise.all([
    fetchFootball(`/teams/${home.id}/matches?status=FINISHED&limit=15`),
    fetchFootball(`/teams/${away.id}/matches?status=FINISHED&limit=15`),
    fetchFootball(`/teams/${home.id}`),fetchFootball(`/teams/${away.id}`)
  ]);
  const homeMatches=hm.matches||[], awayMatches=am.matches||[];
  const h={...home,name:displayName(hi),officialName:hi.name,shortName:hi.shortName,crest:hi.crest};
  const a={...away,name:displayName(ai),officialName:ai.name,shortName:ai.shortName,crest:ai.crest};
  return {homeTeam:h,awayTeam:a,recentHome:homeMatches.slice(0,6),recentAway:awayMatches.slice(0,6),prediction:predict(homeMatches,awayMatches,home.id,away.id,h.name,a.name),updatedAt:new Date().toISOString()};
}

const MIME={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".svg":"image/svg+xml"};
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://localhost:${PORT}`);
    if(u.pathname==="/api/teams"){
      const teams=await searchTeams(u.searchParams.get("q")||"");
      res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=60"});res.end(JSON.stringify({teams,count:teamCache.size}));return;
    }
    if(u.pathname==="/api/analyze"){
      const home=u.searchParams.get("home")||"",away=u.searchParams.get("away")||"";
      if(!home||!away){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"Missing team names"}));return;}
      try{const data=await analyze(home,away);res.writeHead(200,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});res.end(JSON.stringify(data));}
      catch(e){res.writeHead(500,{"Content-Type":"application/json"});res.end(JSON.stringify({error:e.message||"Analysis failed"}));}return;
    }
    let filePath=path.join(__dirname,"public",u.pathname==="/"?"index.html":u.pathname);
    if(!filePath.startsWith(path.join(__dirname,"public"))){res.writeHead(403);res.end("Forbidden");return;}
    if(!fs.existsSync(filePath)||fs.statSync(filePath).isDirectory()) filePath=path.join(__dirname,"public","index.html");
    const ext=path.extname(filePath),data=fs.readFileSync(filePath);res.writeHead(200,{"Content-Type":MIME[ext]||"application/octet-stream"});res.end(data);
  }catch(e){res.writeHead(500);res.end("Server error");}
});

server.listen(PORT,()=>console.log(`\n  Neon Match Intelligence\n  http://localhost:${PORT}\n  Team directory: ${teamCache.size ? teamCache.size+" teams cached" : "loading on first request"}\n`));
