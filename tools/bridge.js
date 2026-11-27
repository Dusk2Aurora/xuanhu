/* 手机 ↔ Agent 桥接服务
 * 监听 0.0.0.0:8791，提供一个极简聊天页；消息落盘到 bridge/inbox.jsonl（你说）
 * 和 bridge/outbox.jsonl（我回）。
 * 独立于 DSH 主进程，重启不影响会话。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'bridge');
fs.mkdirSync(DIR, { recursive: true });
const INBOX = path.join(DIR, 'inbox.jsonl');
const OUTBOX = path.join(DIR, 'outbox.jsonl');
for (const f of [INBOX, OUTBOX]) if (!fs.existsSync(f)) fs.writeFileSync(f, '');

const PORT = 8791;

function readAll(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) { return []; }
}

const PAGE = `<!doctype html><html lang="zh"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>和 Agent 说话</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font:15px/1.55 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
     background:#f4f2f1;color:#2a2522;display:flex;flex-direction:column;height:100dvh}
header{padding:12px 16px;background:#fff;border-bottom:1px solid #ece7e4;font-weight:600;font-size:14px}
header small{font-weight:400;color:#9a8f89;margin-left:8px;font-size:12px}
#log{flex:1;overflow-y:auto;padding:14px 14px 6px}
.b{margin:0 0 10px;display:flex}
.b.me{justify-content:flex-end}
.b .t{max-width:82%;padding:9px 13px;border-radius:14px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.05);white-space:pre-wrap;word-break:break-word}
.b.me .t{background:#f7e6e6;color:#7a2b2b}
.b .tm{font-size:10px;color:#b8ada7;align-self:flex-end;margin:0 6px 3px}
footer{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #ece7e4}
textarea{flex:1;resize:none;height:42px;padding:10px 12px;border:1px solid #e4ddda;border-radius:12px;font:inherit;outline:none;background:#faf9f8}
button{width:64px;border:0;border-radius:12px;background:#a33;color:#fff;font:inherit;font-weight:600}
button:disabled{opacity:.45}
</style></head><body>
<header>和 Agent 说话<small>它正在干活，会尽快回</small></header>
<div id="log"></div>
<footer><textarea id="i" placeholder="说点什么…"></textarea><button id="s">发送</button></footer>
<script>
let last=0, n=0;
const log=document.getElementById('log'), i=document.getElementById('i'), s=document.getElementById('s');
function esc(x){return String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function add(m){
  const d=document.createElement('div'); d.className='b '+(m.from==='me'?'me':'');
  const t=document.createElement('div'); t.className='t'; t.textContent=m.text;
  const tm=document.createElement('div'); tm.className='tm'; tm.textContent=m.at||'';
  if(m.from==='me'){d.appendChild(tm);d.appendChild(t);} else {d.appendChild(t);d.appendChild(tm);}
  log.appendChild(d); log.scrollTop=log.scrollHeight;
}
async function poll(){
  try{
    const r=await fetch('/poll?since='+last); const j=await r.json();
    for(const m of j.messages){ add(m); last=Math.max(last,m.n); }
  }catch(e){}
}
async function send(){
  const v=i.value.trim(); if(!v) return;
  s.disabled=true;
  try{ await fetch('/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:v})}); i.value=''; await poll(); }
  catch(e){ alert('发送失败，检查是否还连着同一个 Wi-Fi'); }
  s.disabled=false;
}
s.onclick=send;
i.addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)) send(); });
poll(); setInterval(poll,3000);
</script></body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.method === 'GET' && u.pathname === '/poll') {
    const since = +(u.searchParams.get('since') || 0);
    const all = readAll(INBOX).map((m, k) => ({ ...m, n: k + 1, from: 'me' }));
    const out = readAll(OUTBOX).map((m, k) => ({ ...m, n: 1000000 + k + 1, from: 'agent' }));
    const msgs = all.concat(out).filter(m => m.n > since).sort((a, b) => a.n - b.n);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ messages: msgs }));
  }
  if (req.method === 'POST' && u.pathname === '/send') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8000) req.destroy(); });
    req.on('end', () => {
      let text = '';
      try { text = (JSON.parse(body).text || '').slice(0, 4000); } catch (e) {}
      if (!text.trim()) { res.writeHead(400); return res.end('{}'); }
      const at = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      fs.appendFileSync(INBOX, JSON.stringify({ text, at, ts: Date.now() }) + '\n');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }

  /* 静态文件：单文件版与 APK（与静态托管路径一致） */
  if (req.method === 'GET' && (u.pathname === '/xuanhu.apk' || u.pathname === '/xuanhu-single.html')) {
    const name = u.pathname.slice(1);
    const fp = path.join(ROOT, 'dist', name);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('not found'); }
    const type = name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*' });
    return fs.createReadStream(fp).pipe(res);
  }
  /* 下载页 / 单文件版（ASCII 路由，避免中文路径转义问题） */
  if (req.method === 'GET' && (u.pathname === '/download' || u.pathname === '/download.html')) {
    const fp = path.join(ROOT, 'dist', 'download.html');
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('no page'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(fp).pipe(res);
  }
  if (req.method === 'GET' && (u.pathname === '/single' || u.pathname === '/single.html')) {
    const fp = path.join(ROOT, 'dist', 'xuanhu-single.html');
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end('no page'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return fs.createReadStream(fp).pipe(res);
  }

  /* 版本清单：应用内"检查更新"读这个 */
  if (req.method === 'GET' && (u.pathname === '/version.json' || u.pathname === '/version')) {
    let version = '0.0.0';
    try {
      const bg = fs.readFileSync(path.join(ROOT, 'app', 'android', 'app', 'build.gradle'), 'utf8');
      const m = bg.match(/versionName\s+"([^"]+)"/);
      if (m) version = m[1];
    } catch (e) {}
    let apkName = null, apkSize = 0, apkT = 0;
    try {
      const d = path.join(ROOT, 'dist');
      for (const f of fs.readdirSync(d)) {
        if (!f.endsWith('.apk')) continue;
        const st = fs.statSync(path.join(d, f));
        if (st.mtimeMs > apkT) { apkT = st.mtimeMs; apkName = f; apkSize = st.size; }
      }
    } catch (e) {}
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({
      version,
      apk: apkName ? '/apk' : null,
      apkName, apkSize,
      web: '/web/',
      at: new Date().toISOString(),
    }));
  }

  /* 网页版：把 prototype/ 当静态站点发布 */
  if (req.method === 'GET' && u.pathname.startsWith('/web')) {
    const rel = u.pathname === '/web' || u.pathname === '/web/' ? 'index' : u.pathname.replace(/^\/web\/?/, '');
    const base = path.join(ROOT, 'prototype');
    let file = path.join(base, rel === 'index' ? 'ui-v4.html' : rel);
    if (!file.startsWith(base)) { res.writeHead(403); return res.end('forbidden'); }
    if (!fs.existsSync(file) && !path.extname(file)) file = path.join(base, 'ui-v4.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.js' ? 'application/javascript; charset=utf-8'
      : ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.json' ? 'application/json; charset=utf-8'
      : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return fs.createReadStream(file).pipe(res);
  }

  /* 下载最新 APK */
  if (req.method === 'GET' && u.pathname === '/apk') {
    const d = path.join(ROOT, 'dist');
    let best = null, bestT = 0;
    try {
      for (const f of fs.readdirSync(d)) {
        if (!f.endsWith('.apk')) continue;
        const st = fs.statSync(path.join(d, f));
        if (st.mtimeMs > bestT) { bestT = st.mtimeMs; best = f; }
      }
    } catch (e) {}
    if (!best) { res.writeHead(404); return res.end('no apk'); }
    const fp = path.join(d, best);
    res.writeHead(200, {
      'content-type': 'application/vnd.android.package-archive',
      'content-disposition': 'attachment; filename="life-latest.apk"',
      'content-length': fs.statSync(fp).size,
    });
    return fs.createReadStream(fp).pipe(res);
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('bridge listening on 0.0.0.0:' + PORT);
});
