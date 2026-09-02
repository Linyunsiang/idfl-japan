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
 */
function targetBranch(){
  const ctx = String(process.env.CONTEXT || '').trim();
  const branch = String(process.env.BRANCH || '').trim();

  // A production build always writes to main, whatever BRANCH happens to say.
  if(ctx === 'production') return 'main';

  // Any other context writes to its own branch, never to production.
  if(branch && branch !== 'main' && SAFE_BRANCH.test(branch) && branch.indexOf('..') < 0) return branch;

  // A branch deploy of main is legitimately main.
  if(ctx === 'branch-deploy' && branch === 'main') return 'main';

  return null;
}

/** A Japanese message for the null case, so every caller says the same thing. */
const NO_TARGET = '公開先のブランチを特定できませんでした（この環境からは公開できません）。';

function contentsUrl(path){
  return 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path;
}

module.exports = { OWNER, REPO, targetBranch, NO_TARGET, contentsUrl, SAFE_BRANCH };
