// Netlify Edge Function: role-based route gate. Verifies signed HttpOnly cookie.
// Bound (in-file config) only to protected paths -> public pages are never affected.
import { requiredRole } from './_permissions.js';
const RANK = { PUBLIC:0, CUSTOMER:1, STAFF:2 };
const COOKIE = 'idfl_session';

function b64urlToBytes(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); const pad=s.length%4?4-(s.length%4):0; s+='='.repeat(pad); const bin=atob(s); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u; }
function bytesToB64url(bytes){ let bin=''; bytes.forEach(b=>bin+=String.fromCharCode(b)); return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
async function hmac(secret, data){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
async function verify(token, secret){
  if(!token || token.indexOf('.')<0) return null;
  const [p, sig] = token.split('.');
  const expected = bytesToB64url(await hmac(secret, p));
  if(sig !== expected) return null;
  let d; try{ d = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))); }catch(e){ return null; }
  if(!d || !d.exp || d.exp < Math.floor(Date.now()/1000)) return null;
  if(!(d.role in RANK)) return null;
  return d;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const need = requiredRole(url.pathname);
  if (need === 'PUBLIC') return; // pass through

  const secret = Netlify.env.get('SESSION_SECRET') || '';
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)idfl_session=([^;]+)/);
  let role = 'PUBLIC';
  if (m && secret){ const d = await verify(decodeURIComponent(m[1]), secret); if (d) role = d.role; }

  if ((RANK[role]||0) >= (RANK[need]||0)) return; // authorized -> pass

  const roleParam = need === 'STAFF' ? 'staff' : 'customer';
  const next = encodeURIComponent(url.pathname + url.search);
  return Response.redirect(`${url.origin}/login.html?role=${roleParam}&next=${next}`, 302);
};

export const config = { path: ['/converter*','/customer/*','/files/staff/*','/files/customer/*'] };
