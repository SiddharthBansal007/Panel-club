import {readFile,writeFile} from 'node:fs/promises';
import process from 'node:process';

const root=new URL('../',import.meta.url);
const showsUrl=new URL('app/shows.json',root);
const overridesUrl=new URL('app/guest-overrides.json',root);
const configUrl=new URL('scripts/sync-config.json',root);

const dryRun=process.argv.includes('--dry-run');
const strict=process.argv.includes('--strict');
const verbose=process.argv.includes('--verbose');

const shows=JSON.parse(await readFile(showsUrl,'utf8'));
const overrides=JSON.parse(await readFile(overridesUrl,'utf8'));
const config=JSON.parse(await readFile(configUrl,'utf8'));

const userAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const minDuration=config.minDurationSeconds??180;
const excludePattern=config.exclude?new RegExp(config.exclude,'i'):null;
const splitHosts=host=>host.split(/\s*(?:&|\band\b)\s*/i).filter(Boolean);
const personKey=name=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase().replace(/^ashishsolanki$/,'aashishsolanki');
const junkWords=/\b(comedy|stand ?up|episode|ep|season|premiere|premier|finale|full|video|watch|subscribe|official|show|channel|youtube|part|new)\b/i;

async function fetchText(url){
 let lastError;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const response=await fetch(url,{headers:{'User-Agent':userAgent,'Accept-Language':'en-US,en;q=0.9',Cookie:'CONSENT=YES+cb'},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   return await response.text();
  }catch(error){
   lastError=error;
   if(attempt<3)await new Promise(resolve=>setTimeout(resolve,attempt*1500));
  }
 }
 throw lastError;
}

function decodeXml(value){
 return value
  .replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(parseInt(code,16)))
  .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}

function parseFeed(xml){
 return xml.split('<entry>').slice(1).map(entry=>{
  const videoId=entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
  const title=entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  const published=entry.match(/<published>([^<]+)<\/published>/)?.[1]??'';
  const description=entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1]??'';
  if(!videoId||!title)return null;
  return {videoId,title:decodeXml(title),published,description:decodeXml(description)};
 }).filter(Boolean);
}

function extractPlayerResponse(html){
 const marker=html.indexOf('ytInitialPlayerResponse');
 if(marker<0)return null;
 const start=html.indexOf('{',marker);
 if(start<0)return null;
 let depth=0;
 for(let index=start;index<html.length;index++){
  const char=html[index];
  if(char==='{')depth++;
  else if(char==='}'){depth--;if(depth===0){try{return JSON.parse(html.slice(start,index+1))}catch{return null}}}
  else if(char==='"'){index++;while(index<html.length&&html[index]!=='"'){if(html[index]==='\\')index++;index++;}}
 }
 return null;
}

const apiKey=process.env.YOUTUBE_API_KEY;
const isoSeconds=value=>{
 const match=value?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
 return match?((+match[1]||0)*86400+(+match[2]||0)*3600+(+match[3]||0)*60+(+match[4]||0)):0;
};

async function fetchVideoMetaApi(videoId){
 const url=`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`;
 let data;
 try{data=JSON.parse(await fetchText(url));}
 catch(error){throw new Error(`YouTube API: ${error.message}`);}
 const item=data.items?.[0];
 if(!item)throw new Error('NOT_FOUND');
 if(item.status?.privacyStatus!=='public')throw new Error(item.status?.privacyStatus?.toUpperCase()||'UNKNOWN');
 if(item.snippet?.liveBroadcastContent==='upcoming')throw new Error('UPCOMING');
 return {title:item.snippet?.title??'',duration:isoSeconds(item.contentDetails?.duration),description:item.snippet?.description??''};
}

async function fetchVideoMeta(videoId){
 if(apiKey)return fetchVideoMetaApi(videoId);
 const html=await fetchText(`https://www.youtube.com/watch?v=${videoId}`);
 const player=extractPlayerResponse(html);
 if(!player)throw new Error('player response missing');
 const status=player.playabilityStatus?.status;
 if(status!=='OK')throw new Error(status||'UNKNOWN');
 const details=player.videoDetails??{};
 return {title:details.title??'',duration:Number(details.lengthSeconds??0),description:details.shortDescription??''};
}

async function resolveChannelId(sourceUrl){
 const html=await fetchText(sourceUrl);
 const match=html.match(/"externalId":"(UC[\w-]+)"/)||html.match(/"channelId":"(UC[\w-]+)"/)||html.match(/channel_id=(UC[\w-]+)/);
 return match?.[1]??null;
}

const knownNames=new Map();
function rememberName(name){
 const display=name.replace(/\s+/g,' ').trim();
 const key=personKey(display);
 if(key.length>=4&&!knownNames.has(key))knownNames.set(key,display);
}
for(const show of shows){
 for(const host of splitHosts(show.host))rememberName(host);
 for(const episode of show.episodes)for(const name of episode.guest.split(','))rememberName(name);
}
for(const value of Object.values(overrides))for(const name of value.split(','))rememberName(name);

function extractGuests({title,description,host}){
 const matches=[];
 const seen=new Set();
 const hostKeys=new Set(splitHosts(host).map(personKey));
 const add=(name,index)=>{
  const display=name.replace(/@/g,'').replace(/\s+/g,' ').replace(/^[\s|,&\-–—:]+|[\s|,&\-–—:]+$/g,'').trim();
  if(!display||display.includes('@'))return;
  const key=personKey(display);
  if(!key||key.length<4||seen.has(key)||hostKeys.has(key))return;
  seen.add(key);
  matches.push({display,index});
 };
 const titleFlat=personKey(title);
 const descriptionFlat=personKey(description);
 const positionOf=key=>{
  const inTitle=titleFlat.indexOf(key);
  if(inTitle>=0)return inTitle;
  const inDescription=descriptionFlat.indexOf(key);
  return inDescription>=0?titleFlat.length+inDescription:Infinity;
 };
 for(const [key,display] of knownNames){
  if(key.length<5)continue;
  const index=positionOf(key);
  if(Number.isFinite(index))add(display,index);
 }
 const marker=title.match(/(?:ft\.?|feat\.?|featuring)\s*([\s\S]+)$/i);
 if(marker){
  for(const token of marker[1].replace(/@/g,' , ').split(/\s*(?:,|&|\band\b|\||\/)\s*/i)){
   const candidate=token.replace(/@/g,'').trim();
   if(!candidate||junkWords.test(candidate))continue;
   if(!candidate.includes(' ')||!/^[A-Z]/.test(candidate)||candidate.length>40)continue;
   const index=positionOf(personKey(candidate));
   add(candidate,Number.isFinite(index)?index:titleFlat.length);
  }
 }
 matches.sort((a,b)=>a.index-b.index);
 return matches.map(match=>match.display);
}

const knownVideos=new Set(shows.flatMap(show=>show.episodes.map(episode=>episode.videoId)));
const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now=new Date();
const today=`${String(now.getUTCDate()).padStart(2,'0')} ${monthNames[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
const added=[];
const warnings=[];
let feedsResolved=0;
let candidatesSeen=0;
let botBlocked=0;

for(const show of shows){
 const setting=config.shows[show.name];
 if(!setting){warnings.push(`No sync config for "${show.name}"; skipped`);continue;}
 const playlistMatch=show.sourceUrl?.match(/[?&]list=([\w-]+)/);
 let feed=null;
 if(playlistMatch)feed={url:`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistMatch[1]}`,kind:'playlist'};
 else if(show.sourceUrl){
  try{
   const channelId=setting.channelId??await resolveChannelId(show.sourceUrl);
   if(channelId)feed={url:`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,kind:'channel'};
  }catch(error){warnings.push(`Channel lookup failed for "${show.name}": ${error.message}`);}
 }
 if(!feed){warnings.push(`No feed source for "${show.name}"`);continue;}
 let entries;
 try{entries=parseFeed(await fetchText(feed.url));}
 catch(error){warnings.push(`Feed fetch failed for "${show.name}": ${error.message}`);continue;}
 feedsResolved++;
 if(feed.kind==='channel'&&!setting.include){warnings.push(`Channel source needs an "include" pattern for "${show.name}"; skipped`);continue;}
 const include=setting.include?new RegExp(setting.include,'i'):null;
 const seenFeed=new Set();
 const candidates=[];
 for(const entry of entries){
  if(feed.kind==='channel'&&!include.test(entry.title))continue;
  if(excludePattern?.test(entry.title))continue;
  if(knownVideos.has(entry.videoId)||seenFeed.has(entry.videoId))continue;
  seenFeed.add(entry.videoId);
  candidates.push(entry);
 }
 candidates.sort((a,b)=>a.published.localeCompare(b.published));
 const newEpisodes=[];
 for(const candidate of candidates){
  let meta;
  candidatesSeen++;
  try{meta=await fetchVideoMeta(candidate.videoId);}
  catch(error){if(error.message==='LOGIN_REQUIRED')botBlocked++;warnings.push(`Unavailable (${show.name}): ${candidate.title} [${candidate.videoId}] — ${error.message}`);continue;}
  const title=(meta.title||candidate.title).trim();
  if(excludePattern?.test(title)){warnings.push(`Excluded by title (${show.name}): ${title}`);continue;}
  if(meta.duration&&meta.duration<minDuration){warnings.push(`Short video skipped (${meta.duration}s, ${show.name}): ${title}`);continue;}
  const guests=extractGuests({title,description:meta.description,host:show.host});
  let guest;
  if(guests.length)guest=guests.join(', ');
  else if(strict){warnings.push(`No guest credits, skipped (${show.name}): ${title}`);continue;}
  else{guest=show.host;warnings.push(`No guest credits, using host (${show.name}): ${title}`);}
  knownVideos.add(candidate.videoId);
  const episode={title,videoId:candidate.videoId,guest};
  if(meta.duration)episode.duration=meta.duration;
  newEpisodes.push(episode);
  added.push({show:show.name,title,videoId:candidate.videoId,guest});
 }
 if(newEpisodes.length)show.episodes.push(...newEpisodes);
}

if(!feedsResolved){
 console.error('Episode sync failed: no YouTube feeds could be read.');
 process.exit(1);
}

if(candidatesSeen&&botBlocked===candidatesSeen){
 console.error(`Episode sync failed: YouTube blocked all ${botBlocked} video lookup(s) (LOGIN_REQUIRED). Set YOUTUBE_API_KEY.`);
 process.exit(1);
}

if(added.length)for(const show of shows)show.checkedAt=today;

if(dryRun){
 console.log(`[dry-run] ${added.length} new episode(s) across ${shows.length} shows.`);
}else if(added.length){
 await writeFile(showsUrl,JSON.stringify(shows,null,2)+'\n');
 console.log(`Episode sync added ${added.length} new episode(s).`);
}else{
 console.log('Episode sync found no new episodes.');
}

for(const item of added)console.log(`+ ${item.show}: ${item.title} [${item.videoId}] -> ${item.guest}`);

if(process.env.SYNC_COMMIT_MESSAGE&&added.length&&!dryRun){
 const subject=added.length===1
  ?`chore: add ${added[0].show} episode: ${added[0].title}`
  :`chore: add ${added.length} new episodes`;
 const body=added.map(item=>`- ${item.show}: ${item.title} (${item.guest}) https://youtu.be/${item.videoId}`);
 await writeFile(process.env.SYNC_COMMIT_MESSAGE,[subject,'',...body].join('\n')+'\n');
}
if(verbose||warnings.length)for(const warning of warnings)console.log(`! ${warning}`);

if(process.env.GITHUB_STEP_SUMMARY){
 const lines=['## Episode sync',`- Added: ${added.length}`,`- Feeds read: ${feedsResolved}`,`- Warnings: ${warnings.length}`,''];
 if(added.length){
  lines.push('| Show | Episode | Guest/Panelist |','| --- | --- | --- |');
  for(const item of added)lines.push(`| ${item.show} | ${item.title.replace(/\|/g,'\\|')} | ${item.guest.replace(/\|/g,'\\|')} |`);
  lines.push('');
 }
 if(warnings.length){
  lines.push('<details><summary>Warnings</summary>','');
  for(const warning of warnings)lines.push(`- ${warning}`);
  lines.push('','</details>');
 }
 await writeFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n',{flag:'a'});
}
