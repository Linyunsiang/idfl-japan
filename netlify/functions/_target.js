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
 * The branch writes should go to, or null when it cannot be established
 * safely. Callers must treat null as a hard error, not as "use main".
 *
 * BRANCH is a BUILD variable. Netlify does not put it in the function
 * runtime, so on a Deploy Preview it is simply absent — which is why this
 * asks GitHub instead. REVIEW_ID is the pull request number and is available
 * at runtime, and the PR knows its own head branch.
 *
 * Needs a token only for the preview lookup; production never gets that far.
 */
async function resolveBranch(token){
  const ctx = String(process.env.CONTEXT || '').trim();

  // A production build always writes to main, whatever else is set.
  if(ctx === 'production') return 'main';

  // A branch deploy of main is legitimately main.
  const branch = String(process.env.BRANCH || '').trim();
  if(ctx === 'branch-deploy' && branch === 'main') return 'main';

  // If the runtime does happen to carry BRANCH, trust it — but never as main
  // outside a production or branch-deploy context.
  if(branch && branch !== 'main' && isSafeBranch(branch)) return branch;

  // Deploy Preview: ask the pull request which branch it is for.
  const review = String(process.env.REVIEW_ID || '').trim();
  if(/^[0-9]{1,9}$/.test(review) && token){
    try{
      const r = await fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/pulls/' + review, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'idfl-admin-publish' },
      });
      if(r.status === 200){
        const j = await r.json();
        const head = j && j.head && j.head.ref;
        if(head && head !== 'main' && isSafeBranch(head)) return head;
      }
    }catch(e){ /* fall through to the refusal */ }
  }

  return null;
}

function isSafeBranch(b){ return SAFE_BRANCH.test(b) && b.indexOf('..') < 0; }

/** A Japanese message for the null case, so every caller says the same thing. */
const NO_TARGET = '公開先のブランチを特定できませんでした（この環境からは公開できません）。';

/* 公開先を決められなかったときに、何が分かっていて何が無いのかを返す。
   ここに出るのは Netlify のデプロイ文脈だけで、秘密は含まない。
   呼び出し側は必ず認証の後で使うこと。 */
function describeEnv(){
  const names = ['CONTEXT','BRANCH','HEAD','REVIEW_ID','PULL_REQUEST','DEPLOY_PRIME_URL','SITE_NAME'];
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

module.exports = { OWNER, REPO, resolveBranch, isSafeBranch, NO_TARGET, describeEnv, contentsUrl, SAFE_BRANCH };
