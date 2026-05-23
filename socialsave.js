const express = require("express");
const { spawn, exec } = require("child_process");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60000, max: 100, message: { error: "Too many requests. Please wait." } }));

// ═══════════════════════════════════════════════════════════════
// PLATFORM DEFINITIONS
// ═══════════════════════════════════════════════════════════════
const PLATFORMS = {
  instagram: { name: "Instagram", patterns: [/instagram\.com\/(p|reel|reels|tv|stories)\//i, /instagr\.am\//i] },
  tiktok:    { name: "TikTok",    patterns: [/tiktok\.com\/@[\w.]+\/video\//i, /tiktok\.com\/t\//i, /vm\.tiktok\.com\//i, /vt\.tiktok\.com\//i] },
  facebook:  { name: "Facebook",  patterns: [/facebook\.com\/watch/i, /facebook\.com\/.*\/videos\//i, /facebook\.com\/reel\//i, /facebook\.com\/share\/(v|r)\//i, /fb\.watch\//i] },
  pinterest: { name: "Pinterest", patterns: [/pinterest\.(com|co\.\w+)\/pin\//i, /pin\.it\//i] },
  youtube:   { name: "YouTube",   patterns: [/youtube\.com\/watch\?/i, /youtu\.be\//i, /youtube\.com\/shorts\//i, /m\.youtube\.com\/watch/i] },
  twitter:   { name: "X (Twitter)", patterns: [/twitter\.com\/\w+\/status\//i, /x\.com\/\w+\/status\//i] },
};

function detectPlatform(url) {
  if (!url) return null;
  for (const [key, p] of Object.entries(PLATFORMS))
    if (p.patterns.some(r => r.test(url.trim()))) return key;
  return null;
}

function cleanUrl(url) {
  try {
    const u = new URL(url.trim());
    const platform = detectPlatform(url);
    if (platform === "youtube") {
      const v = u.searchParams.get("v");
      return v ? `${u.origin}${u.pathname}?v=${v}` : `${u.origin}${u.pathname}`;
    }
    if (platform === "facebook") {
      const v = u.searchParams.get("v");
      return v ? `${u.origin}${u.pathname}?v=${v}` : `${u.origin}${u.pathname}`;
    }
    return `${u.origin}${u.pathname}`;
  } catch { return null; }
}

function checkYtDlp() {
  return new Promise(resolve => exec("yt-dlp --version", (err, out) => resolve(err ? null : out.trim())));
}

function friendlyError(stderr, platform) {
  const s = stderr.toLowerCase();
  if (s.includes("private")) return `This ${platform} post is private. Only public content can be downloaded.`;
  if (s.includes("login") || s.includes("log in")) return `This ${platform} content requires login. Only public posts work.`;
  if (s.includes("404") || s.includes("not found") || s.includes("no video")) return "Video not found. It may have been deleted.";
  if (s.includes("unsupported url")) return `This ${platform} link type is not supported.`;
  return "Could not fetch the video. Make sure the link is correct and the post is public.";
}

// ═══════════════════════════════════════════════════════════════
// SHARED CSS
// ═══════════════════════════════════════════════════════════════
const SHARED_CSS = `
<link href="https://fonts.googleapis.com/css2?family=Clash+Display:wght@500;600;700&family=Satoshi:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
:root{--bg:#07080c;--card:#0e1018;--border:rgba(255,255,255,0.06);--text:#eceef5;--muted:#52586b;}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Satoshi',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}
.bg{position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 60% 40% at 10% 20%,var(--c1,rgba(99,102,241,0.07)) 0%,transparent 60%),radial-gradient(ellipse 50% 40% at 90% 80%,var(--c2,rgba(236,72,153,0.06)) 0%,transparent 60%);}
.wrap{position:relative;z-index:1;max-width:700px;margin:0 auto;padding:50px 24px 80px;}
.back{display:inline-flex;align-items:center;gap:8px;font-family:'DM Mono',monospace;font-size:12px;color:var(--muted);text-decoration:none;margin-bottom:40px;transition:color 0.2s;}
.back:hover{color:var(--text);}
h1{font-family:'Clash Display',sans-serif;font-size:clamp(28px,6vw,46px);font-weight:700;letter-spacing:-0.03em;line-height:1.08;margin-bottom:10px;}
.sub{font-size:15px;color:var(--muted);line-height:1.6;max-width:520px;margin-bottom:16px;}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:32px;}
.chip{padding:5px 13px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:999px;font-size:12px;font-weight:500;color:var(--muted);}
.card{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:28px;margin-bottom:20px;position:relative;overflow:hidden;animation:up 0.5s ease both;}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:var(--grad);}
.field-label{font-size:13px;font-weight:600;margin-bottom:6px;display:block;}
.field-sub{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);margin-bottom:14px;display:block;}
.url-row{display:flex;gap:10px;}
.url-input{flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:12px;padding:15px 16px;font-family:'DM Mono',monospace;font-size:13px;color:var(--text);outline:none;transition:all 0.3s;}
.url-input::placeholder{color:var(--muted);}
.url-input:focus{border-color:var(--focus-c);box-shadow:0 0 0 4px var(--focus-s);}
.btn{background:var(--grad);border:none;border-radius:12px;padding:15px 22px;font-family:'Satoshi',sans-serif;font-size:14px;font-weight:700;color:#fff;cursor:pointer;transition:all 0.3s;white-space:nowrap;}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 28px var(--focus-s);}
.btn:disabled{opacity:0.5;cursor:not-allowed;transform:none;}
.loader{display:none;align-items:center;gap:10px;padding:12px 0;font-size:13px;color:var(--muted);}
.loader.on{display:flex;}
.spin{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--acc);border-radius:50%;animation:spin 0.7s linear infinite;}
.err{display:none;background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);border-radius:10px;padding:12px 16px;font-size:13px;color:#f87171;margin-top:12px;line-height:1.5;}
.err.on{display:block;animation:up 0.3s ease;}
.result{display:none;background:var(--card);border:1px solid var(--border);border-radius:22px;overflow:hidden;margin-bottom:24px;animation:up 0.4s ease;}
.result.on{display:block;}
.thumb-wrap{position:relative;max-height:280px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;}
.thumb-wrap img{width:100%;object-fit:cover;max-height:280px;}
.thumb-wrap::after{content:'';position:absolute;inset:0;background:linear-gradient(to bottom,transparent 50%,rgba(7,8,12,0.9) 100%);}
.vmeta{padding:20px 24px;border-bottom:1px solid var(--border);}
.vtitle{font-family:'Clash Display',sans-serif;font-size:17px;font-weight:600;margin-bottom:6px;line-height:1.3;}
.vstats{display:flex;gap:14px;flex-wrap:wrap;font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);}
.fmts{padding:20px 24px;}
.fmts-title{font-size:13px;font-weight:600;margin-bottom:12px;}
.fmts-list{display:flex;flex-direction:column;gap:8px;}
.frow{display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;padding:12px 16px;transition:all 0.2s;}
.frow:hover{border-color:var(--focus-c);background:var(--focus-s);}
.finfo{display:flex;align-items:center;gap:12px;}
.fbadge{background:var(--badge-bg);color:var(--acc);border:1px solid var(--focus-c);border-radius:7px;padding:3px 9px;font-family:'DM Mono',monospace;font-size:11px;font-weight:500;min-width:44px;text-align:center;}
.fq{font-weight:600;font-size:13px;}
.fs{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);}
.dl-btn{background:var(--grad);border:none;border-radius:9px;padding:9px 16px;font-family:'Satoshi',sans-serif;font-size:13px;font-weight:600;color:#fff;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:all 0.2s;}
.dl-btn:hover{transform:translateY(-1px);box-shadow:0 5px 16px var(--focus-s);}
.howto h2,.faq h2,.feat-wrap h2{font-family:'Clash Display',sans-serif;font-size:19px;font-weight:700;margin-bottom:18px;}
.steps{display:flex;flex-direction:column;gap:12px;}
.step{display:flex;gap:14px;align-items:flex-start;}
.snum{min-width:28px;height:28px;background:var(--badge-bg);border:1px solid var(--focus-c);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:var(--acc);flex-shrink:0;}
.stxt{font-size:14px;color:var(--muted);line-height:1.6;padding-top:3px;}
.stxt strong{color:var(--text);}
.feat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
.feat{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px;}
.feat-icon{font-size:20px;margin-bottom:8px;}
.feat-t{font-size:13px;font-weight:700;margin-bottom:3px;}
.feat-d{font-size:12px;color:var(--muted);line-height:1.5;}
.faq-item{border-bottom:1px solid var(--border);padding:14px 0;}
.faq-item:last-child{border-bottom:none;padding-bottom:0;}
.faq-q{font-size:14px;font-weight:600;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;}
.faq-a{font-size:13px;color:var(--muted);line-height:1.6;margin-top:8px;display:none;}
.faq-item.open .faq-a{display:block;}
.faq-item.open .chev{transform:rotate(180deg);}
.chev{transition:transform 0.3s;font-size:11px;color:var(--muted);flex-shrink:0;}
.footer{text-align:center;margin-top:32px;font-size:12px;color:var(--muted);line-height:1.8;}
.footer a{color:var(--muted);text-decoration:none;}
.footer a:hover{color:var(--text);}
@keyframes up{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
@keyframes spin{to{transform:rotate(360deg);}}
@media(max-width:480px){.url-row{flex-direction:column;}.frow{flex-direction:column;align-items:flex-start;gap:8px;}.dl-btn{width:100%;justify-content:center;}.feat-grid{grid-template-columns:1fr;}}
</style>`;

// ═══════════════════════════════════════════════════════════════
// SHARED JS — with per-page platform validation
// ═══════════════════════════════════════════════════════════════
const SHARED_JS = `
<script>
let CUR_URL='';

// Per-page URL validation
const PLATFORM_CHECKS = {
  instagram: { regex: /instagram\\.com|instagr\\.am/i, name: 'Instagram' },
  tiktok:    { regex: /tiktok\\.com/i, name: 'TikTok' },
  facebook:  { regex: /facebook\\.com|fb\\.watch/i, name: 'Facebook' },
  pinterest: { regex: /pinterest\\.|pin\\.it/i, name: 'Pinterest' },
  youtube:   { regex: /youtube\\.com|youtu\\.be/i, name: 'YouTube' },
  twitter:   { regex: /twitter\\.com|x\\.com/i, name: 'X (Twitter)' },
};

function setLoad(on){document.querySelector('.loader').classList.toggle('on',on);document.querySelector('.btn').disabled=on;}
function showErr(m){const e=document.querySelector('.err');e.textContent='⚠ '+m;e.classList.add('on');}
function clearErr(){document.querySelector('.err').classList.remove('on');}
function fmtB(b){if(!b)return'';return b>1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB';}
function fmtD(s){if(!s)return'';return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

async function doFetch(){
  const url=document.getElementById('url').value.trim();
  if(!url)return showErr('Please paste a video link first.');

  // Platform validation — only on dedicated pages not homepage
  const platform = document.body.dataset.platform;
  if(platform && platform !== 'home'){
    const check = PLATFORM_CHECKS[platform];
    if(check && !check.regex.test(url)){
      return showErr('This page only accepts ' + check.name + ' links. Please paste a ' + check.name + ' link or use the Universal Downloader on the homepage.');
    }
  }

  clearErr();
  document.querySelector('.result').classList.remove('on');
  CUR_URL=url;
  setLoad(true);
  try{
    const r=await fetch('/api/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const d=await r.json();
    setLoad(false);
    if(!r.ok)return showErr(d.error||'Could not get video. Make sure the post is public.');
    renderResult(d);
  }catch{
    setLoad(false);
    showErr('Connection error. Please try again.');
  }
}

function renderResult(d){
  const tw=document.getElementById('tw');
  if(d.thumbnail){document.getElementById('timg').src=d.thumbnail;tw.style.display='';}
  else tw.style.display='none';
  document.getElementById('vtitle').textContent=d.title||'Video';
  const st=[];
  if(d.uploader)st.push('👤 '+d.uploader);
  if(d.duration)st.push('⏱ '+fmtD(d.duration));
  if(d.like_count)st.push('❤️ '+d.like_count.toLocaleString());
  document.getElementById('vstats').innerHTML=st.map(s=>'<span>'+s+'</span>').join('');
  const list=document.getElementById('fmts');
  list.innerHTML='';
  const fmts=d.formats&&d.formats.length?d.formats:[{format_id:'best',quality:'Best Quality',ext:'mp4',filesize:null,height:0}];
  fmts.forEach((f,i)=>{
    const lbl=f.height?f.height+'p HD':(f.quality||'Best Quality');
    const sz=fmtB(f.filesize);
    const p=new URLSearchParams({url:CUR_URL,format_id:f.format_id,filename:(d.platform||'video')+'_'+lbl});
    const row=document.createElement('div');
    row.className='frow';
    row.innerHTML='<div class="finfo"><span class="fbadge">'+((f.ext||'mp4').toUpperCase())+'</span><div><div class="fq">'+lbl+(i===0?' ⭐':'')+'</div>'+(sz?'<div class="fs">'+sz+'</div>':'')+'</div></div><a class="dl-btn" href="/api/download?'+p+'" download>↓ Save Video</a>';
    list.appendChild(row);
  });
  document.querySelector('.result').classList.add('on');
  document.querySelector('.result').scrollIntoView({behavior:'smooth',block:'nearest'});
}

function faq(el){el.parentElement.classList.toggle('open');}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('url').addEventListener('keydown',e=>{if(e.key==='Enter')doFetch();});
  document.getElementById('url').addEventListener('focus',async()=>{
    try{
      const t=await navigator.clipboard.readText();
      const inp=document.getElementById('url');
      if(!inp.value&&t.startsWith('http'))inp.value=t;
    }catch{}
  });
});
</script>`;

// ═══════════════════════════════════════════════════════════════
// PAGE BUILDER
// ═══════════════════════════════════════════════════════════════
function buildPage(cfg) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${cfg.title}</title>
<meta name="description" content="${cfg.desc}"/>
<meta name="keywords" content="${cfg.keywords}"/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="https://yourdomain.com${cfg.path}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${cfg.title}"/>
<meta property="og:description" content="${cfg.desc}"/>
<meta property="og:url" content="https://yourdomain.com${cfg.path}"/>
<meta property="og:site_name" content="SocialSave"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${cfg.title}"/>
<meta name="twitter:description" content="${cfg.desc}"/>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebApplication","name":"${cfg.title}","url":"https://yourdomain.com${cfg.path}","description":"${cfg.desc}","applicationCategory":"UtilitiesApplication","operatingSystem":"Any","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}
</script>
${SHARED_CSS}
<style>
:root{
  --grad:${cfg.grad};
  --acc:${cfg.acc};
  --focus-c:${cfg.focusC};
  --focus-s:${cfg.focusS};
  --badge-bg:${cfg.badgeBg};
  --c1:${cfg.c1};
  --c2:${cfg.c2};
}
.p-icon{width:60px;height:60px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:18px;background:var(--grad);box-shadow:0 0 36px var(--focus-s);}
</style>
</head>
<body data-platform="${cfg.key}">
<div class="bg"></div>
<div class="wrap">
  <a class="back" href="/">← All Platforms</a>

  <div class="p-icon">${cfg.icon}</div>
  <h1>Download <span style="color:var(--acc)">${cfg.platform}</span> Videos</h1>
  <p class="sub">${cfg.subtitle}</p>
  <div class="chips">${cfg.chips.map(c=>`<div class="chip">${c}</div>`).join('')}</div>

  <div class="card">
    <label class="field-label">Paste ${cfg.platform} Video Link</label>
    <span class="field-sub">${cfg.fieldSub}</span>
    <div class="url-row">
      <input type="text" id="url" class="url-input" placeholder="${cfg.placeholder}" autocomplete="off" spellcheck="false"/>
      <button class="btn" onclick="doFetch()">Download</button>
    </div>
    <div class="loader"><div class="spin"></div><span>Getting your video...</span></div>
    <div class="err"></div>
  </div>

  <div class="result">
    <div class="thumb-wrap" id="tw"><img id="timg" src="" alt="${cfg.platform} video thumbnail"/></div>
    <div class="vmeta"><div class="vtitle" id="vtitle"></div><div class="vstats" id="vstats"></div></div>
    <div class="fmts"><div class="fmts-title">Choose Quality & Download</div><div class="fmts-list" id="fmts"></div></div>
  </div>

  <div class="card howto">
    <h2>How to Download ${cfg.platform} Videos</h2>
    <div class="steps">
      ${cfg.steps.map((s,i)=>`<div class="step"><div class="snum">${i+1}</div><div class="stxt"><strong>${s[0]}</strong> ${s[1]}</div></div>`).join('')}
    </div>
  </div>

  <div class="feat-grid">
    ${cfg.feats.map(f=>`<div class="feat"><div class="feat-icon">${f[0]}</div><div class="feat-t">${f[1]}</div><div class="feat-d">${f[2]}</div></div>`).join('')}
  </div>

  <div class="card faq">
    <h2>Frequently Asked Questions</h2>
    ${cfg.faqs.map(f=>`<div class="faq-item"><div class="faq-q" onclick="faq(this)">${f[0]}<span class="chev">▼</span></div><div class="faq-a">${f[1]}</div></div>`).join('')}
  </div>

  <div class="footer">
    <a href="/">SocialSave</a> · <a href="/instagram">Instagram</a> · <a href="/tiktok">TikTok</a> · <a href="/facebook">Facebook</a> · <a href="/pinterest">Pinterest</a> · <a href="/youtube">YouTube</a> · <a href="/twitter">X (Twitter)</a><br/>
    For personal use only. Respect content creators' rights.
  </div>
</div>
${SHARED_JS}
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
// PLATFORM PAGE CONFIGS
// ═══════════════════════════════════════════════════════════════
const PAGE_CONFIGS = {
  instagram: {
    key:"instagram", path:"/instagram", platform:"Instagram",
    title:"Instagram Video Downloader — Download Reels & Posts Free | SocialSave",
    desc:"Download Instagram Reels, Posts and IGTV videos for free in HD quality. No login required. Just paste the link.",
    keywords:"instagram video downloader, download instagram reels, instagram reel downloader, save instagram video, IGTV downloader",
    icon:"📸", grad:"linear-gradient(135deg,#833ab4,#e1306c,#fcaf45)",
    acc:"#f06292", focusC:"rgba(225,48,108,0.4)", focusS:"rgba(225,48,108,0.08)",
    badgeBg:"rgba(225,48,108,0.1)", c1:"rgba(225,48,108,0.1)", c2:"rgba(131,58,180,0.08)",
    subtitle:"Download Instagram Reels, Posts and IGTV videos in HD quality for free. No account needed — just paste the Instagram link.",
    placeholder:"https://www.instagram.com/reel/...",
    fieldSub:"Only accepts Instagram links — Reels, Posts and IGTV",
    chips:["✅ Free","🎬 Reels","🖼 Posts","📺 IGTV","⚡ HD","🔒 No Login"],
    steps:[["Open Instagram","and find the Reel or Post you want to save."],["Tap the three dots (···)","on the post and select Copy Link."],["Paste the link","in the box above and tap Download."],["Choose quality","and the video saves to your device."]],
    feats:[["⚡","Fast Downloads","Videos download instantly at full speed."],["🎯","HD Quality","Download up to 1080p HD quality."],["🔒","No Login","No Instagram account required."],["📱","All Devices","Works on Android,
    faqs:[["Can I download Instagram Reels?","Yes! Paste any Reel link and download instantly for free."],["Is it free?","100% free, no limits, no subscription."],["Why can't I download?","Only public Instagram posts can be downloaded. Private accounts are not supported."],["What format?","Videos download as MP4, compatible with all devices."]],
  },
  tiktok: {
    key:"tiktok", path:"/tiktok", platform:"TikTok",
    title:"TikTok Video Downloader — No Watermark Free HD | SocialSave",
    desc:"Download TikTok videos without watermark for free in HD quality. No login required. Paste the TikTok link and save instantly.",
    keywords:"tiktok video downloader, download tiktok without watermark, tiktok downloader free, save tiktok video, tiktok no watermark",
    icon:"🎵", grad:"linear-gradient(135deg,#010101,#69c9d0)",
    acc:"#69c9d0", focusC:"rgba(105,201,208,0.4)", focusS:"rgba(105,201,208,0.08)",
    badgeBg:"rgba(105,201,208,0.1)", c1:"rgba(105,201,208,0.08)", c2:"rgba(105,201,208,0.04)",
    subtitle:"Download TikTok videos without watermark in HD quality for free. No account needed — paste the TikTok link and save.",
    placeholder:"https://www.tiktok.com/@user/video/...",
    fieldSub:"Only accepts TikTok links from the app or browser",
    chips:["✅ Free","🚫 No Watermark","⚡ HD Quality","🔒 No Login","📱 All Devices"],
    steps:[["Open TikTok","and find the video you want to download."],["Tap Share","and select Copy Link."],["Paste the link","in the box above and tap Download."],["Save the video","clean, no watermark, straight to your device."]],
    feats:[["🚫","No Watermark","Clean downloads with no TikTok branding."],["⚡","Instant","Videos ready in seconds."],["🎯","HD Quality","Best available quality every time."],["📱","Any Device","Works on any browser, any device."]],
    faqs:[["Can I download without watermark?","Yes! All downloads are completely watermark-free."],["Is it free?","100% free with no limits or sign-up."],["Can I download private videos?","Only public TikTok videos can be downloaded."],["What format?","Videos save as MP4, compatible with all devices."]],
  },
  facebook: {
    key:"facebook", path:"/facebook", platform:"Facebook",
    title:"Facebook Video Downloader — Download Facebook Videos Free HD | SocialSave",
    desc:"Download Facebook videos in HD and SD quality for free. No login required. Save any public Facebook video by pasting the link.",
    keywords:"facebook video downloader, download facebook video, facebook video saver, save facebook video, fb video downloader",
    icon:"📘", grad:"linear-gradient(135deg,#1877f2,#0a4fa3)",
    acc:"#60a5fa", focusC:"rgba(24,119,242,0.4)", focusS:"rgba(24,119,242,0.08)",
    badgeBg:"rgba(24,119,242,0.1)", c1:"rgba(24,119,242,0.08)", c2:"rgba(24,119,242,0.04)",
    subtitle:"Download public Facebook videos in HD and SD quality for free. No account needed — paste the Facebook video link.",
    placeholder:"https://www.facebook.com/watch?v=...",
    fieldSub:"Only accepts Facebook links — Watch, video posts and fb.watch",
    chips:["✅ Free","📹 HD & SD","⚡ Fast","🔒 No Login","📱 All Devices"],
    steps:[["Open Facebook","and find the video you want to download."],["Click the three dots (···)","on the video and select Copy Link."],["Paste the link","in the box above and tap Download."],["Choose HD or SD","and the video saves to your device."]],
    feats:[["📹","HD & SD","Choose between high and standard definition."],["⚡","Fast & Free","No waiting, no limits."],["🔒","No Account","No Facebook login needed."],["📱","Everywhere","Works on all browsers and devices."]],
    faqs:[["Can I download any Facebook video?","Any public Facebook video can be downloaded. Private videos are not supported."],["Is it free?","Yes, 100% free with no limits."],["What quality options?","HD and SD depending on the original video."],["Do I need Facebook account?","No login or account required."]],
  },
  pinterest: {
    key:"pinterest", path:"/pinterest", platform:"Pinterest",
    title:"Pinterest Video Downloader — Download Pinterest Videos & GIFs Free | SocialSave",
    desc:"Download Pinterest videos and GIFs for free in HD quality. No login required. Save any Pinterest video pin by pasting the link.",
    keywords:"pinterest video downloader, download pinterest video, pinterest video saver, save pinterest video, pinterest gif downloader",
    icon:"📌", grad:"linear-gradient(135deg,#e60023,#ad081b)",
    acc:"#f87171", focusC:"rgba(230,0,35,0.4)", focusS:"rgba(230,0,35,0.08)",
    badgeBg:"rgba(230,0,35,0.1)", c1:"rgba(230,0,35,0.08)", c2:"rgba(173,8,27,0.05)",
    subtitle:"Download Pinterest video pins and GIFs in HD quality for free. No account needed — paste any Pinterest video link.",
    placeholder:"https://www.pinterest.com/pin/...",
    fieldSub:"Only accepts Pinterest links — video pins and pin.it short links",
    chips:["✅ Free","🎞 Video Pins","🎨 GIFs","⚡ HD","🔒 No Login"],
    steps:[["Open Pinterest","and find the video pin you want."],["Tap Share","and select Copy Link."],["Paste the link","in the box above and tap Download."],["Save the video","in HD quality to your device."]],
    feats:[["📌","Video Pins & GIFs","Download video pins and animated GIFs."],["⚡","Instant","Ready to save in seconds."],["🎯","HD Quality","Best quality from the original pin."],["📱","All Devices","Phone, tablet or desktop."]],
    faqs:[["Can I download GIFs?","Yes! GIFs are supported and save as MP4 files."],["Is it free?","Completely free, no account needed."],["Why can't I download a pin?","Only video pins work. Image-only pins have nothing to download."],["Do I need a Pinterest account?","No account or login required."]],
  },
  youtube: {
    key:"youtube", path:"/youtube", platform:"YouTube",
    title:"YouTube Video Downloader — Download YouTube Videos & Shorts Free | SocialSave",
    desc:"Download YouTube videos and Shorts for free in HD, Full HD and 4K. No login required. Fast YouTube to MP4 downloader.",
    keywords:"youtube video downloader, download youtube video, youtube to mp4, youtube downloader free, youtube shorts downloader, 4k youtube",
    icon:"▶️", grad:"linear-gradient(135deg,#ff0000,#c4302b)",
    acc:"#fca5a5", focusC:"rgba(255,0,0,0.4)", focusS:"rgba(255,0,0,0.08)",
    badgeBg:"rgba(255,0,0,0.1)", c1:"rgba(255,0,0,0.08)", c2:"rgba(196,48,43,0.05)",
    subtitle:"Download YouTube videos and Shorts in HD, Full HD and 4K for free. No account needed — paste the YouTube link and save.",
    placeholder:"https://www.youtube.com/watch?v=...",
    fieldSub:"Only accepts YouTube links — videos, Shorts and youtu.be links",
    chips:["✅ Free","🎬 Videos","📱 Shorts","4K Quality","⚡ HD","🔒 No Login"],
    steps:[["Open YouTube","and find the video or Short you want."],["Tap Share","and select Copy Link."],["Paste the link","in the box above and tap Download."],["Choose quality","up to 4K and save to your device."]],
    feats:[["🎯","Up to 4K","HD, Full HD or 4K quality."],["📱","Shorts Supported","YouTube Shorts fully supported."],["⚡","Fast","High speed, no queue."],["🔒","No Account","No Google login required."]],
    faqs:[["Can I download Shorts?","Yes! YouTube Shorts are fully supported."],["Max quality?","Up to 4K depending on the original video."],["Is it free?","100% free, no limits."],["Do I need Google account?","No account needed at any point."]],
  },
  twitter: {
    key:"twitter", path:"/twitter", platform:"X (Twitter)",
    title:"X (Twitter) Video Downloader — Download X Videos & GIFs Free | SocialSave",
    desc:"Download X (Twitter) videos and GIFs for free in HD quality. No login required. Save any X or Twitter video by pasting the post link.",
    keywords:"twitter video downloader, x video downloader, download twitter video, download x video, twitter gif downloader, x video free",
    icon:`<svg viewBox="0 0 24 24" width="28" height="28" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
    grad:"linear-gradient(135deg,#000000,#1a1a1a)",
    acc:"#e2e8f0", focusC:"rgba(255,255,255,0.2)", focusS:"rgba(255,255,255,0.04)",
    badgeBg:"rgba(255,255,255,0.08)", c1:"rgba(255,255,255,0.04)", c2:"rgba(255,255,255,0.02)",
    subtitle:"Download X and Twitter videos and GIFs in HD for free. No account needed — paste any X or Twitter post link and save.",
    placeholder:"https://x.com/user/status/...",
    fieldSub:"Only accepts X (Twitter) links — x.com and twitter.com",
    chips:["✅ Free","📹 X Videos","🎞 GIFs","⚡ HD","🔒 No Login"],
    steps:[["Open X (Twitter)","and find the post with the video or GIF."],["Tap Share","and select Copy Link."],["Paste the link","in the box above and tap Download."],["Save the video","GIFs save as clean MP4 files."]],
    feats:[["📹","Videos & GIFs","Both X videos and GIFs supported."],["⚡","Instant","Ready to download in seconds."],["🎯","HD Quality","Highest available quality."],["📱","All Devices","Works on any browser."]],
    faqs:[["Can I download X GIFs?","Yes! GIFs download as MP4 video files."],["x.com and twitter.com both work?","Yes, both URL formats are fully supported."],["Is it free?","Completely free, no sign-up needed."],["Private accounts?","Only public X accounts can be downloaded."]],
  },
};

// ═══════════════════════════════════════════════════════════════
// HOME PAGE
// ═══════════════════════════════════════════════════════════════
const HOME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>SocialSave — Free Social Media Video Downloader</title>
<meta name="description" content="Download videos from Instagram, TikTok, Facebook, Pinterest, YouTube and X for free. No login required. Fast and easy."/>
<meta name="keywords" content="social media video downloader, instagram downloader, tiktok downloader, facebook video downloader, youtube downloader, free video downloader"/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="https://yourdomain.com/"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="SocialSave — Free Social Media Video Downloader"/>
<meta property="og:description" content="Download videos from Instagram, TikTok, Facebook, Pinterest, YouTube and X for free."/>
<meta property="og:site_name" content="SocialSave"/>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","name":"SocialSave","url":"https://yourdomain.com","description":"Free social media video downloader for Instagram, TikTok, Facebook, Pinterest, YouTube and X."}
</script>
${SHARED_CSS}
<style>
:root{--grad:linear-gradient(135deg,#6366f1,#ec4899);--acc:#818cf8;--focus-c:rgba(99,102,241,0.4);--focus-s:rgba(99,102,241,0.08);--badge-bg:rgba(99,102,241,0.1);--c1:rgba(99,102,241,0.07);--c2:rgba(236,72,153,0.06);}
.wrap{max-width:900px;}
.logo-wrap{display:flex;align-items:center;gap:10px;justify-content:center;margin-bottom:20px;}
.logo-icon{width:46px;height:46px;background:var(--grad);border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 0 28px rgba(99,102,241,0.3);}
.logo-text{font-family:'Clash Display',sans-serif;font-size:21px;font-weight:700;letter-spacing:-0.02em;}
.hero{text-align:center;margin-bottom:48px;animation:up 0.6s ease both;}
.hero h1{font-family:'Clash Display',sans-serif;font-size:clamp(32px,8vw,58px);font-weight:700;line-height:1.05;letter-spacing:-0.03em;margin-bottom:14px;}
.hl{background:linear-gradient(90deg,#6366f1,#ec4899,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.hero-sub{font-size:16px;color:var(--muted);max-width:480px;margin:0 auto 18px;}
.trust{display:flex;justify-content:center;gap:20px;flex-wrap:wrap;font-size:13px;color:var(--muted);}
.trust span{display:flex;align-items:center;gap:5px;}
.univ{animation:up 0.6s 0.1s ease both;}
.univ-label{font-size:13px;font-weight:600;margin-bottom:4px;}
.univ-sub{font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);margin-bottom:16px;display:block;}
.detect-row{min-height:22px;display:flex;align-items:center;gap:8px;margin-top:12px;font-family:'DM Mono',monospace;font-size:12px;}
.dpill{display:inline-flex;align-items:center;gap:5px;padding:3px 11px;border-radius:999px;font-size:11px;font-weight:500;animation:up 0.3s ease;}
.grid-section{margin-bottom:40px;animation:up 0.6s 0.2s ease both;}
.gs-head{margin-bottom:16px;}
.gs-title{font-family:'Clash Display',sans-serif;font-size:20px;font-weight:700;margin-bottom:3px;}
.gs-sub{font-size:13px;color:var(--muted);}
.pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
@media(max-width:600px){.pgrid{grid-template-columns:1fr 1fr;}}
@media(max-width:380px){.pgrid{grid-template-columns:1fr;}}
.pcard{display:block;background:var(--card);border:1px solid var(--border);border-radius:18px;padding:20px 18px;text-decoration:none;color:var(--text);transition:all 0.3s;position:relative;overflow:hidden;}
.pcard::before{content:'';position:absolute;inset:0;background:var(--pglow);opacity:0;transition:opacity 0.3s;}
.pcard:hover::before{opacity:1;}
.pcard:hover{border-color:var(--pborder);transform:translateY(-3px);box-shadow:0 14px 36px var(--pshadow);}
.pcard-ig{--pglow:radial-gradient(circle at top left,rgba(225,48,108,0.1),transparent 70%);--pborder:rgba(225,48,108,0.3);--pshadow:rgba(225,48,108,0.1);}
.pcard-tt{--pglow:radial-gradient(circle at top left,rgba(105,201,208,0.1),transparent 70%);--pborder:rgba(105,201,208,0.3);--pshadow:rgba(105,201,208,0.1);}
.pcard-fb{--pglow:radial-gradient(circle at top left,rgba(24,119,242,0.1),transparent 70%);--pborder:rgba(24,119,242,0.3);--pshadow:rgba(24,119,242,0.1);}
.pcard-pt{--pglow:radial-gradient(circle at top left,rgba(230,0,35,0.1),transparent 70%);--pborder:rgba(230,0,35,0.3);--pshadow:rgba(230,0,35,0.1);}
.pcard-yt{--pglow:radial-gradient(circle at top left,rgba(255,0,0,0.1),transparent 70%);--pborder:rgba(255,0,0,0.3);--pshadow:rgba(255,0,0,0.1);}
.pcard-tw{--pglow:radial-gradient(circle at top left,rgba(255,255,255,0.04),transparent 70%);--pborder:rgba(255,255,255,0.15);--pshadow:rgba(255,255,255,0.04);}
.pi{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:12px;}
.pi-ig{background:linear-gradient(135deg,#833ab4,#e1306c,#fcaf45);}
.pi-tt{background:linear-gradient(135deg,#010101,#69c9d0);}
.pi-fb{background:linear-gradient(135deg,#1877f2,#0a4fa3);}
.pi-pt{background:linear-gradient(135deg,#e60023,#ad081b);}
.pi-yt{background:linear-gradient(135deg,#ff0000,#c4302b);}
.pi-tw{background:linear-gradient(135deg,#000,#1a1a1a);border:1px solid rgba(255,255,255,0.12);}
.parr{position:absolute;top:16px;right:16px;font-size:14px;color:var(--muted);transition:all 0.3s;}
.pcard:hover .parr{color:var(--text);transform:translate(2px,-2px);}
.pn{font-family:'Clash Display',sans-serif;font-size:15px;font-weight:600;margin-bottom:3px;}
.pd{font-size:12px;color:var(--muted);}
.why-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;animation:up 0.6s 0.3s ease both;}
@media(max-width:560px){.why-grid{grid-template-columns:1fr;}}
.wcard{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;}
.wi{font-size:22px;margin-bottom:10px;}
.wt{font-size:13px;font-weight:700;margin-bottom:4px;}
.wd{font-size:12px;color:var(--muted);line-height:1.5;}
</style>
</head>
<body data-platform="home">
<div class="bg"></div>
<div class="wrap" style="max-width:900px">
  <div class="hero">
    <div class="logo-wrap">
      <div class="logo-icon">⬇</div>
      <div class="logo-text">SocialSave</div>
    </div>
    <h1>Download videos from<br/><span class="hl">any social platform</span></h1>
    <p class="hero-sub">Free video downloader for Instagram, TikTok, Facebook, Pinterest, YouTube and X. No login, no limits.</p>
    <div class="trust">
      <span>✅ 100% Free</span>
      <span>🔒 No Login</span>
      <span>⚡ Fast Downloads</span>
      <span>📱 All Devices</span>
    </div>
  </div>

  <div class="card univ">
    <div class="univ-label">Universal Downloader</div>
    <span class="univ-sub">Paste any video link from Instagram, TikTok, Facebook, Pinterest, YouTube or X</span>
    <div class="url-row">
      <input type="text" id="url" class="url-input" placeholder="Paste your video link here..." autocomplete="off" spellcheck="false"/>
      <button class="btn" onclick="doFetch()">Download</button>
    </div>
    <div class="detect-row" id="drow"></div>
    <div class="loader"><div class="spin"></div><span>Getting your video...</span></div>
    <div class="err"></div>
  </div>

  <div class="result">
    <div class="thumb-wrap" id="tw"><img id="timg" src="" alt="thumbnail"/></div>
    <div class="vmeta"><div class="vtitle" id="vtitle"></div><div class="vstats" id="vstats"></div></div>
    <div class="fmts"><div class="fmts-title">Choose Quality & Download</div><div class="fmts-list" id="fmts"></div></div>
  </div>

  <div class="grid-section">
    <div class="gs-head">
      <div class="gs-title">Choose a Platform</div>
      <div class="gs-sub">Go to a dedicated downloader page for each platform</div>
    </div>
    <div class="pgrid">
      <a class="pcard pcard-ig" href="/instagram"><span class="parr">↗</span><div class="pi pi-ig">📸</div><div class="pn">Instagram</div><div class="pd">Reels, Posts & IGTV</div></a>
      <a class="pcard pcard-tt" href="/tiktok"><span class="parr">↗</span><div class="pi pi-tt">🎵</div><div class="pn">TikTok</div><div class="pd">No watermark videos</div></a>
      <a class="pcard pcard-fb" href="/facebook"><span class="parr">↗</span><div class="pi pi-fb">📘</div><div class="pn">Facebook</div><div class="pd">Public videos in HD</div></a>
      <a class="pcard pcard-pt" href="/pinterest"><span class="parr">↗</span><div class="pi pi-pt">📌</div><div class="pn">Pinterest</div><div class="pd">Video pins & GIFs</div></a>
      <a class="pcard pcard-yt" href="/youtube"><span class="parr">↗</span><div class="pi pi-yt">▶️</div><div class="pn">YouTube</div><div class="pd">Videos, Shorts & 4K</div></a>
      <a class="pcard pcard-tw" href="/twitter"><span class="parr">↗</span>
        <div class="pi pi-tw"><svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></div>
        <div class="pn">X (Twitter)</div><div class="pd">X videos & GIFs</div>
      </a>
    </div>
  </div>

  <div class="why-grid">
    <div class="wcard"><div class="wi">🆓</div><div class="wt">Always Free</div><div class="wd">No subscriptions, no hidden fees. Download unlimited videos.</div></div>
    <div class="wcard"><div class="wi">🔒</div><div class="wt">No Login Needed</div><div class="wd">No account required on any platform. Just paste and download.</div></div>
    <div class="wcard"><div class="wi">⚡</div><div class="wt">Fast & Easy</div><div class="wd">Downloads complete in seconds on any device.</div></div>
  </div>

  <div class="footer" style="margin-top:40px">
    © 2025 <a href="/">SocialSave</a> ·
    <a href="/instagram">Instagram</a> · <a href="/tiktok">TikTok</a> · <a href="/facebook">Facebook</a> ·
    <a href="/pinterest">Pinterest</a> · <a href="/youtube">YouTube</a> · <a href="/twitter">X (Twitter)</a><br/>
    For personal use only. Respect content creators' rights.
  </div>
</div>

<script>
const PC={
  instagram:{s:'background:rgba(225,48,108,0.12);color:#e1306c;border:1px solid rgba(225,48,108,0.25)',i:'📸',n:'Instagram'},
  tiktok:{s:'background:rgba(105,201,208,0.12);color:#69c9d0;border:1px solid rgba(105,201,208,0.25)',i:'🎵',n:'TikTok'},
  facebook:{s:'background:rgba(24,119,242,0.12);color:#1877f2;border:1px solid rgba(24,119,242,0.25)',i:'📘',n:'Facebook'},
  pinterest:{s:'background:rgba(230,0,35,0.12);color:#e60023;border:1px solid rgba(230,0,35,0.25)',i:'📌',n:'Pinterest'},
  youtube:{s:'background:rgba(255,0,0,0.12);color:#ff0000;border:1px solid rgba(255,0,0,0.25)',i:'▶️',n:'YouTube'},
  twitter:{s:'background:rgba(255,255,255,0.08);color:#aaa;border:1px solid rgba(255,255,255,0.15)',i:'✖',n:'X (Twitter)'},
};
let CUR_URL='';

function setLoad(on){document.querySelector('.loader').classList.toggle('on',on);document.querySelector('.btn').disabled=on;}
function showErr(m){const e=document.querySelector('.err');e.textContent='⚠ '+m;e.classList.add('on');}
function clearErr(){document.querySelector('.err').classList.remove('on');}
function fmtB(b){if(!b)return'';return b>1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB';}
function fmtD(s){if(!s)return'';return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

async function doFetch(){
  const url=document.getElementById('url').value.trim();
  if(!url)return showErr('Please paste a video link first.');
  clearErr();
  document.querySelector('.result').classList.remove('on');
  CUR_URL=url;setLoad(true);
  try{
    const r=await fetch('/api/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const d=await r.json();setLoad(false);
    if(!r.ok)return showErr(d.error||'Could not get video. Make sure the post is public.');
    renderResult(d);
  }catch{setLoad(false);showErr('Connection error. Please try again.');}
}

function renderResult(d){
  const tw=document.getElementById('tw');
  if(d.thumbnail){document.getElementById('timg').src=d.thumbnail;tw.style.display='';}else tw.style.display='none';
  document.getElementById('vtitle').textContent=d.title||'Video';
  const st=[];if(d.uploader)st.push('👤 '+d.uploader);if(d.duration)st.push('⏱ '+fmtD(d.duration));if(d.view_count)st.push('👁 '+d.view_count.toLocaleString());
  document.getElementById('vstats').innerHTML=st.map(s=>'<span>'+s+'</span>').join('');
  const list=document.getElementById('fmts');list.innerHTML='';
  const fmts=d.formats&&d.formats.length?d.formats:[{format_id:'best',quality:'Best Quality',ext:'mp4',filesize:null,height:0}];
  fmts.forEach((f,i)=>{
    const lbl=f.height?f.height+'p':(f.quality||'Best');
    const sz=fmtB(f.filesize);
    const p=new URLSearchParams({url:CUR_URL,format_id:f.format_id,filename:(d.platform||'video')+'_'+lbl});
    const row=document.createElement('div');row.className='frow';
    row.innerHTML='<div class="finfo"><span class="fbadge">'+((f.ext||'mp4').toUpperCase())+'</span><div><div class="fq">'+lbl+(i===0?' ⭐':'')+'</div>'+(sz?'<div class="fs">'+sz+'</div>':'')+'</div></div><a class="dl-btn" href="/api/download?'+p+'" download>↓ Save</a>';
    list.appendChild(row);
  });
  document.querySelector('.result').classList.add('on');
}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('url').addEventListener('keydown',e=>{if(e.key==='Enter')doFetch();});
  document.getElementById('url').addEventListener('input',async()=>{
    const v=document.getElementById('url').value.trim();
    document.getElementById('drow').innerHTML='';
    if(v.length<10)return;
    try{
      const r=await fetch('/api/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:v})});
      const d=await r.json();
      if(d.platform){const c=PC[d.platform];document.getElementById('drow').innerHTML='<span class="dpill" style="'+c.s+'">'+c.i+' '+c.n+' detected</span>';}
    }catch{}
  });
  document.getElementById('url').addEventListener('focus',async()=>{
    try{const t=await navigator.clipboard.readText();const inp=document.getElementById('url');if(!inp.value&&t.startsWith('http'))inp.value=t;}catch{}
  });
});
</script>
</body>
</html>`;

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════
app.get("/", (req, res) => res.send(HOME_HTML));

Object.entries(PAGE_CONFIGS).forEach(([key, cfg]) => {
  app.get(cfg.path, (req, res) => res.send(buildPage(cfg)));
});

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════
app.post("/api/detect", (req, res) => {
  const { url } = req.body;
  const platform = detectPlatform(url);
  res.json(platform ? { platform, name: PLATFORMS[platform].name } : { platform: null });
});

app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Please paste a video URL." });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: "Link not recognized. Supported: Instagram, TikTok, Facebook, Pinterest, YouTube, X (Twitter)." });

  const finalUrl = cleanUrl(url);
  if (!finalUrl) return res.status(400).json({ error: "Invalid URL format." });

  const version = await checkYtDlp();
  if (!version) return res.status(500).json({ error: "Downloader engine not available. Please try again later." });

  console.log(`[${platform}] ${finalUrl}`);

  const args = ["--dump-json","--no-playlist","--no-warnings","--no-check-certificates", finalUrl];
  let stdout = "", stderr = "";
  const proc = spawn("yt-dlp", args);
  proc.stdout.on("data", d => stdout += d.toString());
  proc.stderr.on("data", d => stderr += d.toString());

  proc.on("close", code => {
    if (code !== 0 || !stdout.trim()) {
      console.error(`[${platform}] Error:`, stderr.slice(0, 200));
      return res.status(500).json({ error: friendlyError(stderr, PLATFORMS[platform].name) });
    }
    try {
      const lines = stdout.trim().split("\n").filter(l => l.startsWith("{"));
      if (!lines.length) return res.status(500).json({ error: "No video data received." });
      const info = JSON.parse(lines[0]);

      const allFmts = (info.formats || [])
        .filter(f => f.vcodec && f.vcodec !== "none" && f.ext !== "mhtml")
        .map(f => ({ format_id: f.format_id, ext: f.ext||"mp4", quality: f.height?`${f.height}p`:(f.format_note||f.format_id), height: f.height||0, filesize: f.filesize||f.filesize_approx||null }))
        .sort((a, b) => b.height - a.height);

      const seen = new Set();
      const unique = allFmts.filter(f => { const k=`${f.height}-${f.ext}`; if(seen.has(k))return false; seen.add(k); return true; });
      const formats = unique.length ? unique.slice(0,8) : [{format_id:"best",ext:"mp4",quality:"Best Quality",height:0,filesize:null}];

      res.json({
        platform, platform_name: PLATFORMS[platform].name,
        title: info.title || `${PLATFORMS[platform].name} Video`,
        thumbnail: info.thumbnail || null,
        uploader: info.uploader || info.channel || null,
        duration: info.duration || null,
        like_count: info.like_count || null,
        view_count: info.view_count || null,
        formats,
      });
    } catch(e) {
      res.status(500).json({ error: "Failed to read video information." });
    }
  });
});

app.get("/api/download", (req, res) => {
  const { url, format_id, filename } = req.query;
  if (!url) return res.status(400).json({ error: "URL required." });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: "Unsupported platform." });

  const finalUrl = cleanUrl(url);
  if (!finalUrl) return res.status(400).json({ error: "Invalid URL." });

  const safeName = (filename||`${platform}_video`).replace(/[^a-z0-9_\-]/gi,"_")+".mp4";
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.setHeader("Content-Type", "video/mp4");

  const fmt = format_id && format_id !== "best"
    ? format_id
    : "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best";

  const proc = spawn("yt-dlp", ["--no-playlist","--no-warnings","--no-check-certificates","-f",fmt,"--merge-output-format","mp4","-o","-",finalUrl]);
  proc.stdout.pipe(res);
  proc.stderr.on("data", d => console.error("[dl]", d.toString().trim()));
  req.on("close", () => proc.kill());
});

app.get("/api/health", async (req, res) => {
  const v = await checkYtDlp();
  res.json({ status:"ok", ytdlp: v||"not installed", platforms: Object.keys(PLATFORMS) });
});

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🚀 SocialSave running → http://localhost:${PORT}`);
  console.log(`✅ Per-page platform validation enabled\n`);
});
