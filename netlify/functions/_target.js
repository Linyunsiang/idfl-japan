// ============================================================
// Where a write lands.
//
// publish.js, upload-file.js and file-manager.js all commit to the repository
// through the GitHub Contents API. They used to hard-code branch 'main', which
// meant a Deploy Preview — a build whose whole purpose is to be safe to poke
// at — wrote straight to production. Testing the admin console on a preview
// published to the live site.
//
// Netlify sets BRANCH to the branch being built: 'main' for production, the
// pull request's head branch on a Deploy Preview. Taking the target from the
// environment keeps production behaviour identical while making a preview
// write to its own branch.
//
// The rule is deliberately one-sided: only a production build may write to
// main. If the context is anything else and the branch cannot be established,
// this refuses rather than guessing — a wrong refusal costs someone a retry,
// a wrong guess rewrites the live site.
// ============================================================
const OWNER = 'Linyunsiang';
const REPO  = 'idfl-japan';

// Conservative: git allows more than this, but everything this repository uses
// fits, and a name that does not match is a reason to stop rather than encode.
const SAFE_BRANCH = /^[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,198}[A-Za-z0-9_-])?$/;

/**
 * Which deployment is serving this request, worked out from the host it came
 * in on.
 *
 * This site's function runtime carries none of Netlify's deploy metadata —
 * CONTEXT, BRANCH, REVIEW_ID and DEPLOY_PRIME_URL are all absent, verified by
 * asking a live deploy. SITE_NAME is the only one set, and it is identical on
 * production and on a preview, so it cannot tell them apart. The host can:
 * Netlify routes by it, so a request that reached this deployment arrived on
 * one of its own hostnames.
 *
 *   idfl-japan.com                                  -> production
 *   main--idfl-japan.netlify.app                    -> production
 *   deploy-preview-<n>--idfl-japan.netlify.app      -> pull request <n>
 *   anything else                                   -> unknown, refuse
 *
 * Host cannot be used to escalate. Claiming to be a preview sends writes to a
 * pull request branch, which is strictly less privileged than main; and a
 * request claiming the production host is routed to the production deployment
 * by the edge before any of this code runs.
 */
function deploymentFromHost(host){
  const h = String(host || '').toLowerCase().split(':')[0].trim();
  if(!h) return { kind: 'unknown' };
  if(PRODUCTION_HOSTS.has(h)) return { kind: 'production' };
  const preview = /^deploy-preview-([0-9]{1,9})--idfl-japan\.netlify\.app$/.exec(h);
  if(preview) return { kind: 'preview', review: preview[1] };
  return { kind: 'unknown' };
}

const PRODUCTION_HOSTS = new Set([
  'idfl-japan.com',
  'www.idfl-japan.com',
  'idfl-japan.netlify.app',
  'main--idfl-japan.netlify.app',
]);

/** The head branch of a pull request, or null. Needs a token; public repo. */
async function branchOfPullRequest(review, token){
  if(!/^[0-9]{1,9}$/.test(String(review || '')) || !token) return null;
  try{
    const r = await fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/pulls/' + review, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'idfl-admin-publish' },
    });
    if(r.status !== 200) return null;
    const j = await r.json();
    const head = j && j.head && j.head.ref;
    return (head && head !== 'main' && isSafeBranch(head)) ? head : null;
  }catch(e){ return null; }
}

/**
 * The branch writes should go to, or null when it cannot be established
 * safely. Callers must treat null as a hard error, not as "use main".
 *
 * `host` is the request's Host header. Environment variables are consulted
 * first because they are unambiguous where they exist; the host is the
 * fallback that actually works on this site.
 */
async function resolveBranch(token, host){
  const ctx = String(process.env.CONTEXT || '').trim();
  const branch = String(process.env.BRANCH || '').trim();

  // Where Netlify does provide the context, believe it.
  if(ctx === 'production') return 'main';
  if(ctx === 'branch-deploy' && branch === 'main') return 'main';
  if(ctx && branch && branch !== 'main' && isSafeBranch(branch)) return branch;

  const review = String(process.env.REVIEW_ID || '').trim();
  if(ctx === 'deploy-preview' && review){
    return await branchOfPullRequest(review, token);
  }

  // No deploy metadata: fall back to the host the request arrived on.
  const dep = deploymentFromHost(host);
  if(dep.kind === 'production') return 'main';
  if(dep.kind === 'preview') return await branchOfPullRequest(dep.review, token);

  return null;
}

function isSafeBranch(b){ return SAFE_BRANCH.test(b) && b.indexOf('..') < 0; }

/** A Japanese message for the null case, so every caller says the same thing. */
const NO_TARGET = '公開先のブランチを特定できませんでした（この環境からは公開できません）。';

/* 公開先を決められなかったときに、何が分かっていて何が無いのかを返す。
   ここに出るのは Netlify のデプロイ文脈だけで、秘密は含まない。
   呼び出し側は必ず認証の後で使うこと。 */
function describeEnv(){
  const names = ['CONTEXT','BRANCH','HEAD','REVIEW_ID','PULL_REQUEST','DEPLOY_PRIME_URL','DEPLOY_URL','URL','SITE_NAME','NETLIFY'];
  const out = {};
  for(const n of names){
    const v = process.env[n];
    out[n] = (v === undefined || v === null || v === '') ? null : String(v).slice(0, 120);
  }
  return out;
}

function contentsUrl(path){
  return 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path;
}

module.exports = { OWNER, REPO, resolveBranch, isSafeBranch, deploymentFromHost, NO_TARGET, describeEnv, contentsUrl, SAFE_BRANCH };
