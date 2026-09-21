import {readFile} from 'node:fs/promises';
import process from 'node:process';

const root=new URL('../',import.meta.url);
const shows=JSON.parse(await readFile(new URL('app/shows.json',root),'utf8'));
const guestOverrides=JSON.parse(await readFile(new URL('app/guest-overrides.json',root),'utf8'));
const online=process.argv.includes('--online');
const errors=[];
const seenShows=new Set();
const seenVideos=new Map();
const episodes=[];
const personKey=name=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase().replace(/^ashishsolanki$/,'aashishsolanki');
const splitHosts=host=>host.split(/\s*(?:&|\band\b)\s*/i).filter(Boolean);
function guestPanelists(host,guest){
 const names=[...splitHosts(host),...guest.split(/\s*,\s*/)];
 const seen=new Set();
 return names.filter(name=>{const key=personKey(name);if(!key||seen.has(key))return false;seen.add(key);return true});
}

for(const show of shows){
 if(seenShows.has(show.name))errors.push(`Duplicate show name: ${show.name}`);
 seenShows.add(show.name);
 if(!show.episodes?.length)errors.push(`Show has no episodes: ${show.name}`);
 if(show.episodes?.[0]?.videoId!==show.coverVideoId)errors.push(`Cover is not episode 1 for ${show.name}`);

 for(const episode of show.episodes??[]){
  const creditedGuest=(guestOverrides[episode.videoId]??episode.guest??'').trim();
  const names=guestPanelists(show.host,creditedGuest);
  const guest=names.join(', ');
  const previous=seenVideos.get(episode.videoId);
  if(previous)errors.push(`Duplicate YouTube video ${episode.videoId}: ${previous} and ${show.name}`);
  seenVideos.set(episode.videoId,show.name);
  if(!creditedGuest)errors.push(`Missing episode Guest/Panelist credits: ${show.name} — ${episode.title}`);
  if(guest.includes('@'))errors.push(`Channel handle used as a name: ${show.name} — ${episode.title}`);
  for(const host of splitHosts(show.host))if(!names.some(name=>personKey(name)===personKey(host)))errors.push(`Host missing from Guest/Panelist: ${show.name} — ${episode.title}`);
  if(new Set(names.map(personKey)).size!==names.length)errors.push(`Repeated Guest/Panelist name: ${show.name} — ${episode.title}`);
  if(/\b(bonus|bonus clip|behind the scenes)\b/i.test(episode.title))errors.push(`Bonus/clip entry remains: ${show.name} — ${episode.title}`);
  episodes.push({...episode,show:show.name,guest});
 }
}

for(const [videoId] of Object.entries(guestOverrides)){
 if(!seenVideos.has(videoId))errors.push(`Guest override points to a missing video: ${videoId}`);
}

if(shows.some(show=>show.name==='That Filmy Game Show'))errors.push('Removed show is present: That Filmy Game Show');
for(const videoId of ['pxIgEICezKE','TTUeCfiiVf8']){
 if(seenVideos.has(videoId))errors.push(`Removed video is present: ${videoId}`);
}

if(errors.length){
 console.error(`Catalogue validation failed with ${errors.length} error(s):`);
 for(const error of errors)console.error(`- ${error}`);
 process.exit(1);
}

console.log(`Catalogue OK: ${shows.length} shows, ${episodes.length} episodes, ${seenVideos.size} unique YouTube videos, ${Object.keys(guestOverrides).length} curated name overrides.`);

if(online){
 const failures=[];
 let cursor=0;
 const workers=Array.from({length:8},async()=>{
  while(cursor<episodes.length){
   const episode=episodes[cursor++];
   try{
    const response=await fetch(`https://www.youtube.com/watch?v=${episode.videoId}`,{
     headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'},
     signal:AbortSignal.timeout(20000)
    });
    const html=await response.text();
    const playerMatch=html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/s);
    if(!playerMatch)throw new Error(`HTTP ${response.status}; player response missing`);
    const player=JSON.parse(playerMatch[1]);
    const status=player.playabilityStatus?.status;
    if(status!=='OK'){
     const reason=player.playabilityStatus?.reason||player.playabilityStatus?.messages?.join(' ')||'no reason returned';
     throw new Error(`${status||'UNKNOWN'}: ${reason}`);
    }
    if(player.videoDetails?.videoId&&player.videoDetails.videoId!==episode.videoId)throw new Error(`resolved to ${player.videoDetails.videoId}`);
   }catch(error){
    failures.push(`${episode.show} — ${episode.videoId}: ${error instanceof Error?error.message:String(error)}`);
   }
  }
 });
 await Promise.all(workers);
 if(failures.length){
  console.error(`YouTube availability failed for ${failures.length} video(s):`);
  for(const failure of failures)console.error(`- ${failure}`);
  process.exit(1);
 }
 console.log(`YouTube OK: all ${episodes.length} videos are playable for a signed-out visitor.`);
}
