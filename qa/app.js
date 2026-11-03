import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, getDoc, collection, doc, addDoc, setDoc, deleteDoc, updateDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const configured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('PASTE_');
let auth, db, user = null, isMember = false, authEpoch = 0, questions = [], answers = [], votes = [], view = 'questions', selected = null, mode = 'signin';
let unsubscribe = [];
let wikiArticles = [], wikiSelected = null, wikiEditingId = null;
const escapeHTML = (text = '') => String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const time = (stamp) => stamp?.toDate?.()?.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) || 'Just now';
const displayName = (record) => record.authorName || 'Group member';
const short = (text,max=160) => String(text||'').length>max ? `${String(text).slice(0,max)}…` : String(text||'');
const voteId = (kind,id,uid) => `${uid}_${kind}_${id}`;
const mineVote = (kind,id) => !!user && votes.some(v=>v.id===voteId(kind,id,user.uid));
const tally = (kind,id) => votes.filter(v=>v.targetType===kind && v.targetId===id).length;
const answerCount = id => answers.filter(a=>a.questionId===id).length;
const notify = (message,error=false) => { const box=$('status');box.textContent=message;box.classList.remove('hidden','error','success');box.classList.add(error?'error':'success');box.scrollIntoView({block:'nearest',behavior:'smooth'}); };
const issue = e => notify(e?.message?.replace(/^Firebase: /,'')||'Something went wrong.',true);
function requireAuth(){if(!configured){notify('First configure Firebase using the README.',true);return false;}if(!user){openAuth();return false;}if(!isMember){notify('Your account is not yet approved for this research group.',true);return false;}return true;}
function openAuth(){if(!configured){notify('Please configure Firebase before registering.',true);return;} $('auth-dialog').showModal();}
function switchView(next){
  view=next;selected=null;wikiSelected=null;
  for(const section of ['questions','wiki','leaderboard']){
    $(section+'-view').classList.toggle('hidden',next!==section);
    $('nav-'+section).classList.toggle('active',next===section);
  }
  render();
}
function rankData(){const map=new Map();const add=(id,name,n)=>{if(!id)return;let entry=map.get(id)||{uid:id,name:name||'Member',points:0};if(name)entry.name=name;entry.points+=n;map.set(id,entry);};for(const q of questions)add(q.authorId,q.authorName,2);for(const a of answers)add(a.authorId,a.authorName,5);for(const q of questions){const accepted=answers.find(a=>a.id===q.acceptedAnswerId && a.questionId===q.id);if(accepted)add(accepted.authorId,accepted.authorName,15);}for(const v of votes){const target=v.targetType==='question'?questions.find(q=>q.id===v.targetId):answers.find(a=>a.id===v.targetId);if(target)add(target.authorId,target.authorName,2);}return [...map.values()].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));}
function renderRanks(){const ranks=rankData();$('stat-questions').textContent=questions.length;$('stat-answers').textContent=answers.length;$('stat-solved').textContent=questions.filter(q=>answers.some(a=>a.id===q.acceptedAnswerId&&a.questionId===q.id)).length;$('stat-members').textContent=ranks.length;$('stat-wiki').textContent=wikiArticles.filter(a=>a.status==='published').length;const row=(p,i)=>`<div class="rank-row"><span class="rank-num">${i+1}</span><span class="rank-avatar">${escapeHTML(p.name.trim().charAt(0).toUpperCase()||'?')}</span><span class="rank-name">${escapeHTML(p.name)}${p.uid===user?.uid?' (you)':''}</span><span class="rank-points">${p.points} pts</span></div>`;$('mini-leaderboard').innerHTML=ranks.length?ranks.slice(0,4).map(row).join(''):'<p class="muted">No contributors yet.</p>';$('full-leaderboard').innerHTML=ranks.length?ranks.map(row).join(''):'<div class="empty-state">No activity yet. Ask the first question!</div>';}
function renderQuestions(){const query=$('search').value.trim().toLowerCase(),filter=$('filter').value,sort=$('sort').value;let data=questions.filter(q=>([q.title,q.body,q.tag,q.authorName].some(s=>String(s||'').toLowerCase().includes(query)))&&(filter==='all'||filter==='mine'&&q.authorId===user?.uid||filter==='open'&&!answers.some(a=>a.id===q.acceptedAnswerId&&a.questionId===q.id)||filter==='solved'&&answers.some(a=>a.id===q.acceptedAnswerId&&a.questionId===q.id)));data.sort((a,b)=>sort==='votes'?tally('question',b.id)-tally('question',a.id):sort==='answers'?answerCount(b.id)-answerCount(a.id):(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));$('question-count').textContent=questions.length;$('questions-list').innerHTML=data.length?data.map(q=>{const solved=answers.some(a=>a.id===q.acceptedAnswerId&&a.questionId===q.id);return `<article class="question-card"><div class="question-score"><b>${tally('question',q.id)}</b><span>votes</span><b>${answerCount(q.id)}</b><span>answers</span></div><div class="question-info"><button class="question-title" type="button" data-open="${q.id}">${escapeHTML(q.title)}</button><p class="question-excerpt">${escapeHTML(short(q.body,180))}</p><div class="question-meta"><span class="tag">${escapeHTML(q.tag)}</span>${solved?'<span class="solved">✓ Solved</span>':''}<span>by ${escapeHTML(displayName(q))}</span><span>·</span><span>${time(q.createdAt)}</span></div></div></article>`}).join(''):'<div class="empty-state">No questions match your filters. Try another search or ask a new question.</div>';$('question-count').textContent=questions.length;}
// Render untrusted Markdown safely. Sanitization is mandatory before using innerHTML.
// If either library fails to load, show escaped plain text rather than unsafe HTML.
function formatBody(text) {
  const source = String(text ?? '');
  if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
    return `<div class="markdown-fallback">${escapeHTML(source)}</div>`;
  }
  const raw = window.marked.parse(source, { gfm: true, breaks: true });
  return window.DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed'],
    FORBID_ATTR: ['style']
  });
}
function typesetMarkdown(root) {
  if (!root || typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '$', right: '$', display: false }
      ],
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      throwOnError: false,
      trust: false
    });
  } catch (err) { console.warn('Math rendering failed:', err); }
}
function typesetAll(root) {
  root.querySelectorAll('.markdown-render, .post-body').forEach(typesetMarkdown);
}
function refreshWikiPreview() {
  const preview = $('wiki-markdown-preview');
  if (!preview) return;
  const content = $('wiki-content').value;
  preview.innerHTML = content.trim() ? formatBody(content) : '<p class="muted">Start writing to preview your article.</p>';
  typesetMarkdown(preview);
}
function renderDetail(){const q=questions.find(item=>item.id===selected);if(!q){selected=null;return render();}const qAnswers=answers.filter(a=>a.questionId===q.id).sort((a,b)=>(a.id===q.acceptedAnswerId?-1:0)-(b.id===q.acceptedAnswerId?-1:0)||(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));$('questions-list').classList.add('hidden');$('question-detail').classList.remove('hidden');$('question-detail').innerHTML=`<button class="detail-back" type="button" data-back>← All questions</button><div class="detail-heading"><h2>${escapeHTML(q.title)}</h2></div><div class="question-meta detail-meta"><span class="tag">${escapeHTML(q.tag)}</span><span>Asked by ${escapeHTML(displayName(q))}</span><span>·</span><span>${time(q.createdAt)}</span></div><div class="post-body markdown-render">${formatBody(q.body)}</div><div class="detail-actions"><button class="vote-btn ${mineVote('question',q.id)?'voted':''}" data-vote-type="question" data-vote-id="${q.id}" ${q.authorId===user?.uid?'disabled title="Cannot upvote your own post"':''}>▲ ${tally('question',q.id)} Upvotes</button><button class="btn btn-outline compact" type="button" data-wiki-from="${q.id}">Summarize into Wiki</button></div><hr class="detail-divider"/><h3 class="answers-title">${qAnswers.length} ${qAnswers.length===1?'Answer':'Answers'}</h3>${qAnswers.map(a=>`<div class="answer-card"><div class="answer-meta"><span>Answered by <b>${escapeHTML(displayName(a))}</b> · ${time(a.createdAt)}</span>${q.acceptedAnswerId===a.id?'<span class="answer-accepted">✓ Accepted solution</span>':''}</div><div class="post-body markdown-render">${formatBody(a.body)}</div><div class="answer-buttons"><button class="vote-btn ${mineVote('answer',a.id)?'voted':''}" data-vote-type="answer" data-vote-id="${a.id}" ${a.authorId===user?.uid?'disabled title="Cannot upvote your own post"':''}>▲ ${tally('answer',a.id)} Upvotes</button>${user?.uid===q.authorId&&q.acceptedAnswerId!==a.id?`<button class="accept-btn" data-accept="${a.id}">✓ Accept answer</button>`:''}</div></div>`).join('')}<form id="answer-form" class="answer-form"><h3 class="answers-title">Your answer</h3><textarea id="answer-body" required minlength="10" maxlength="10000" placeholder="Share a well-reasoned answer, sources, or a reproducible example..."></textarea><button class="btn btn-primary" type="submit" ${!user?'disabled':''}>Post answer · +5 pts</button>${!user?'<p class="muted">Sign in to post an answer.</p>':''}</form>`;typesetAll($('question-detail'));}
function render(){renderRanks();if(view==='questions'){if(selected)renderDetail();else{$('questions-list').classList.remove('hidden');$('question-detail').classList.add('hidden');renderQuestions();}}if(view==='wiki')renderWiki();}
function attachData(){unsubscribe.forEach(fn=>fn());unsubscribe=[];for(const [name,put] of [['questions',v=>questions=v],['answers',v=>answers=v],['votes',v=>votes=v],['wiki',v=>wikiArticles=v]]){unsubscribe.push(onSnapshot(collection(db,name),snapshot=>{put(snapshot.docs.map(d=>({id:d.id,...d.data()})));render();},err=>{if(name==='wiki')notify('Wiki access blocked. Publish the supplied Wiki Firestore rules before using this tab.',true);else issue(err);console.error(name,err);}));}}

// -------- Research Wiki: collaborative editing by approved group members --------
const wikiTagOptions = ['Computational Chemistry','Machine Learning','Programming','Research Methods','Literature','Other'];
const wikiPermitted = a => isMember && !!a;
function renderWiki(){
  $('wiki-count').textContent=wikiArticles.filter(a=>a.status==='published').length;
  $('stat-wiki').textContent=wikiArticles.filter(a=>a.status==='published').length;
  $('wiki-new').disabled=!isMember;
  if(wikiSelected){renderWikiDetail();return;}
  $('wiki-browser').classList.remove('hidden');$('wiki-detail').classList.add('hidden');
  const search=$('wiki-search').value.trim().toLowerCase(), filter=$('wiki-filter').value;
  const filtered=wikiArticles.filter(a=>{
    const statusOk=filter==='all'||filter==='mine'&&a.authorId===user?.uid||filter==='draft'&&a.status==='draft'||filter==='published'&&a.status==='published';
    return statusOk && [a.title,a.summary,a.content,a.tag,a.references].some(x=>String(x||'').toLowerCase().includes(search));
  }).sort((a,b)=>(b.updatedAt?.seconds||b.createdAt?.seconds||0)-(a.updatedAt?.seconds||a.createdAt?.seconds||0));
  $('wiki-list').innerHTML=filtered.length?filtered.map(a=>`<article class="wiki-card">
    <div class="wiki-card-icon">▤</div><div class="wiki-card-content"><button type="button" class="question-title" data-wiki-open="${a.id}">${escapeHTML(a.title)}</button>
    <p class="question-excerpt">${escapeHTML(short(a.summary,240))}</p>
    <div class="question-meta"><span class="tag">${escapeHTML(a.tag)}</span><span class="wiki-state ${a.status==='published'?'published':'draft'}">${a.status==='published'?'✓ Published':'Unpublished legacy draft'}</span><span>by ${escapeHTML(a.authorName||'Group member')}</span><span>· ${time(a.updatedAt||a.createdAt)}</span><span>${(a.questionIds||[]).length} discussions</span></div></div></article>`).join(''):
    '<div class="empty-state">No Wiki articles match. Create the first summary of a research discussion.</div>';
}
function renderWikiDetail(){
  const a=wikiArticles.find(x=>x.id===wikiSelected);
  if(!a){wikiSelected=null;renderWiki();return;}
  $('wiki-browser').classList.add('hidden');$('wiki-detail').classList.remove('hidden');
  const links=(a.questionIds||[]).map(id=>{
    const q=questions.find(x=>x.id===id);
    return q?`<li><button type="button" class="text-link wiki-discussion-link" data-wiki-question="${q.id}">${escapeHTML(q.title)}</button></li>`:'';
  }).filter(Boolean).join('');
  $('wiki-detail').innerHTML=`<button class="detail-back" type="button" data-wiki-back>← All Wiki articles</button>
    <div class="question-meta"><span class="tag">${escapeHTML(a.tag)}</span><span class="wiki-state ${a.status==='published'?'published':'draft'}">${a.status==='published'?'✓ Published':'Unpublished legacy draft'}</span></div>
    <h2 class="wiki-article-title">${escapeHTML(a.title)}</h2>
    <p class="wiki-byline">Created by ${escapeHTML(a.authorName||'Group member')} · Last updated ${time(a.updatedAt||a.createdAt)}</p>
    <p class="wiki-article-summary">${escapeHTML(a.summary)}</p>
    <div class="post-body wiki-prose markdown-render">${formatBody(a.content)}</div>
    ${a.references?.trim()?`<section class="wiki-related"><h3>References</h3><div class="post-body markdown-render">${formatBody(a.references)}</div></section>`:''}
    ${links?`<section class="wiki-related"><h3>Related Q&A discussions</h3><ul>${links}</ul></section>`:''}
    <div class="wiki-article-actions">${wikiPermitted(a)?`<button class="btn btn-outline compact" type="button" data-wiki-edit="${a.id}">Edit article</button>`:''}
    ${isMember&&a.status==='draft'?`<button class="btn btn-primary compact" type="button" data-wiki-publish="${a.id}">Publish now</button>`:''}
</div>`;
  typesetAll($('wiki-detail'));
}
function openWikiEditor(id=null,fromQuestion=null){
  if(!requireAuth())return;
  const a=id?wikiArticles.find(x=>x.id===id):null;
  if(id&&(!a||!wikiPermitted(a))){notify('You cannot edit this Wiki article.',true);return;}
  wikiEditingId=id;$('wiki-form').reset();$('wiki-form-message').textContent='';
  $('wiki-form-heading').textContent=a?'Edit Wiki article':'Create Wiki article';
  $('wiki-save').textContent=a?'Save changes':'Publish article';
  $('wiki-title').value=a?.title||(fromQuestion?questions.find(q=>q.id===fromQuestion)?.title||'':'');
  $('wiki-tag').value=a?.tag||(fromQuestion?questions.find(q=>q.id===fromQuestion)?.tag||wikiTagOptions[0]:wikiTagOptions[0]);
  $('wiki-summary').value=a?.summary||'';
  $('wiki-content').value=a?.content||'';
  $('wiki-references').value=a?.references||'';
  refreshWikiPreview();
  const linked=new Set(a?.questionIds||[]);if(fromQuestion)linked.add(fromQuestion);
  $('wiki-question-options').innerHTML=questions.length?questions.map(q=>`<label class="wiki-question-option"><input type="checkbox" value="${q.id}" ${linked.has(q.id)?'checked':''}/><span>${escapeHTML(q.title)}</span></label>`).join(''):'No questions yet.';
  $('wiki-dialog').showModal();
}
$('wiki-new').addEventListener('click',()=>openWikiEditor());
$('wiki-content').addEventListener('input',refreshWikiPreview);
$('wiki-search').addEventListener('input',()=>{wikiSelected=null;renderWiki();});
$('wiki-filter').addEventListener('change',()=>{wikiSelected=null;renderWiki();});
$('wiki-list').addEventListener('click',e=>{const target=e.target.closest('[data-wiki-open]');if(target){wikiSelected=target.dataset.wikiOpen;renderWiki();}});
$('wiki-detail').addEventListener('click',async e=>{
  if(e.target.closest('[data-wiki-back]')){wikiSelected=null;renderWiki();return;}
  const discussion=e.target.closest('[data-wiki-question]');
  if(discussion){switchView('questions');selected=discussion.dataset.wikiQuestion;render();return;}
  const edit=e.target.closest('[data-wiki-edit]');if(edit){openWikiEditor(edit.dataset.wikiEdit);return;}
  const publish=e.target.closest('[data-wiki-publish]');
  if(!publish||!requireAuth())return;
  const id=publish.dataset.wikiPublish;
  const article=wikiArticles.find(a=>a.id===id);
  if(!article||article.status!=='draft')return;
  try{
    await updateDoc(doc(db,'wiki',id),{status:'published',updatedAt:serverTimestamp()});
    notify('Wiki article published for all approved members.');
  }catch(err){issue(err);}

});
$('wiki-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!requireAuth())return;
  const button=$('wiki-save');button.disabled=true;
  $('wiki-form-message').textContent='';
  const questionIds=[...$('wiki-question-options').querySelectorAll('input:checked')].map(x=>x.value).slice(0,12);
  const payload={title:$('wiki-title').value.trim(),tag:$('wiki-tag').value,summary:$('wiki-summary').value.trim(),content:$('wiki-content').value.trim(),references:$('wiki-references').value.trim(),questionIds,status:'published',updatedAt:serverTimestamp()};
  try{
    if(wikiEditingId){await updateDoc(doc(db,'wiki',wikiEditingId),payload);wikiSelected=wikiEditingId;}
    else {const item=await addDoc(collection(db,'wiki'),{...payload,authorId:user.uid,authorName:user.displayName||$('user-chip').textContent||user.email,createdAt:serverTimestamp()});wikiSelected=item.id;}
    $('wiki-dialog').close();const targetArticle=wikiSelected;switchView('wiki');wikiSelected=targetArticle;renderWiki();notify(wikiEditingId?'Wiki article updated and published.':'Wiki article published.');
  }catch(error){$('wiki-form-message').textContent=error.message||'Unable to save article';$('wiki-form-message').className='form-message error-text';issue(error);}
  finally{button.disabled=false;}
});

$('nav-questions').addEventListener('click',()=>switchView('questions'));$('nav-wiki').addEventListener('click',()=>switchView('wiki'));$('sidebar-wiki').addEventListener('click',()=>switchView('wiki'));$('nav-leaderboard').addEventListener('click',()=>switchView('leaderboard'));$('view-all').addEventListener('click',()=>switchView('leaderboard'));
$('search').addEventListener('input',()=>{selected=null;render();});for(const id of ['filter','sort'])$(id).addEventListener('change',()=>{selected=null;render();});
for(const id of ['ask-hero','ask-inline'])$(id).addEventListener('click',()=>{if(requireAuth())$('ask-dialog').showModal();});
$('auth-button').addEventListener('click',()=>{if(user){signOut(auth).catch(issue);}else openAuth();});

$('forgot-password-button').addEventListener('click',()=>{
  if(!configured)return notify('Firebase is not configured.',true);
  $('reset-password-form').reset();
  $('reset-email').value=$('auth-email').value.trim();
  $('reset-message').textContent='';
  $('auth-dialog').close();
  $('reset-password-dialog').showModal();
});
$('reset-password-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=$('reset-submit');button.disabled=true;
  $('reset-message').textContent='';
  try {
    await sendPasswordResetEmail(auth,$('reset-email').value.trim());
    $('reset-message').textContent='If this email is registered, a password-reset link will arrive shortly. Check your spam folder too.';
    $('reset-message').className='form-message success-text';
  } catch(error) {
    if(error.code==='auth/invalid-email'){
      $('reset-message').textContent='Please enter a valid email address.';
      $('reset-message').className='form-message error-text';
    } else if(error.code==='auth/too-many-requests'){
      $('reset-message').textContent='Too many requests. Try again later.';
      $('reset-message').className='form-message error-text';
    } else {
      // Do not reveal whether an account exists.
      $('reset-message').textContent='If this email is registered, you should receive a reset link. If not, contact the group administrator.';
      $('reset-message').className='form-message';
      console.error('Password reset error:',error);
    }
  } finally {button.disabled=false;}
});
$('change-password-button').addEventListener('click',()=>{
  if(!user)return;
  $('change-password-form').reset();
  $('change-message').textContent='';
  $('change-password-dialog').showModal();
});
$('change-password-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const current=$('current-password').value;
  const next=$('new-password').value;
  const confirm=$('confirm-password').value;
  const output=$('change-message');
  output.className='form-message';
  if(next!==confirm){output.textContent='The new passwords do not match.';output.classList.add('error-text');return;}
  if(next.length<6){output.textContent='Use a password with at least 6 characters.';output.classList.add('error-text');return;}
  const button=$('change-submit');button.disabled=true;
  try {
    if(!auth.currentUser?.email)throw new Error('Please sign in again.');
    const credentials=EmailAuthProvider.credential(auth.currentUser.email,current);
    await reauthenticateWithCredential(auth.currentUser,credentials);
    await updatePassword(auth.currentUser,next);
    $('change-password-form').reset();
    $('change-password-dialog').close();
    notify('Your password has been changed successfully.');
  } catch(error) {
    output.textContent=error.code==='auth/invalid-credential'||error.code==='auth/wrong-password'?'Current password is incorrect.':
      error.code==='auth/weak-password'?'Choose a stronger password.':
      error.code==='auth/too-many-requests'?'Too many attempts. Try again later.':
      error.code==='auth/requires-recent-login'?'Please sign out and sign in again before changing the password.':
      'Could not update password: '+(error.message||'Unknown error');
    output.classList.add('error-text');
  } finally {button.disabled=false;}
});

document.querySelectorAll('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$('auth-form').addEventListener('submit',async e=>{e.preventDefault();if(!configured)return;const email=$('auth-email').value.trim(),password=$('auth-password').value;const button=$('auth-submit');button.disabled=true;try{await signInWithEmailAndPassword(auth,email,password);$('auth-dialog').close();$('auth-form').reset();}catch(err){issue(err);}finally{button.disabled=false;}});
$('ask-form').addEventListener('submit',async e=>{e.preventDefault();if(!requireAuth())return;const button=$('question-submit');button.disabled=true;try{await addDoc(collection(db,'questions'),{title:$('question-title').value.trim(),body:$('question-body').value.trim(),tag:$('question-tag').value,authorId:user.uid,authorName:user.displayName||user.email.split('@')[0],acceptedAnswerId:null,createdAt:serverTimestamp()});$('ask-dialog').close();$('ask-form').reset();selected=null;switchView('questions');notify('Question published!');}catch(err){issue(err);}finally{button.disabled=false;}});
$('questions-list').addEventListener('click',e=>{const element=e.target.closest('[data-open]');if(element){selected=element.dataset.open;render();}});
$('question-detail').addEventListener('click',async e=>{if(e.target.closest('[data-back]')){selected=null;render();return;}const summarize=e.target.closest('[data-wiki-from]');if(summarize){if(requireAuth())openWikiEditor(null,summarize.dataset.wikiFrom);return;}const vote=e.target.closest('[data-vote-id]');if(vote){if(!requireAuth())return;const kind=vote.dataset.voteType,id=vote.dataset.voteId,target=kind==='question'?questions.find(q=>q.id===id):answers.find(a=>a.id===id);if(!target||target.authorId===user.uid)return;const record=doc(db,'votes',voteId(kind,id,user.uid));try{if(mineVote(kind,id))await deleteDoc(record);else await setDoc(record,{userId:user.uid,targetType:kind,targetId:id,createdAt:serverTimestamp()});}catch(err){issue(err);}return;}const accepted=e.target.closest('[data-accept]');if(accepted){if(!requireAuth())return;const q=questions.find(q=>q.id===selected);if(q?.authorId!==user.uid)return;try{await updateDoc(doc(db,'questions',q.id),{acceptedAnswerId:accepted.dataset.accept});notify('Answer marked as accepted!');}catch(err){issue(err);}}});
$('question-detail').addEventListener('submit',async e=>{if(e.target.id!=='answer-form')return;e.preventDefault();if(!requireAuth())return;const content=$('answer-body').value.trim();if(content.length<10)return;const button=e.target.querySelector('button[type=submit]');button.disabled=true;try{await addDoc(collection(db,'answers'),{questionId:selected,body:content,authorId:user.uid,authorName:user.displayName||user.email.split('@')[0],createdAt:serverTimestamp()});notify('Answer submitted!');}catch(err){issue(err);}finally{button.disabled=false;}});
document.querySelectorAll('[data-topic]').forEach(button=>button.addEventListener('click',()=>{$('search').value=button.dataset.topic;$('filter').value='all';switchView('questions');}));
if(configured){try{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);$('setup-banner').classList.add('hidden');onAuthStateChanged(auth,async next=>{
  const epoch=++authEpoch;
  unsubscribe.forEach(fn=>fn());unsubscribe=[];
  isMember=false;user=null;questions=[];answers=[];votes=[];wikiArticles=[];selected=null;wikiSelected=null;
  $('user-chip').classList.add('hidden');$('auth-button').textContent='Sign in';$('change-password-button').classList.add('hidden');
  $('questions-list').innerHTML='<div class="empty-state">Sign in with a group-approved account to view questions.</div>';
  if(!next){renderRanks();return;}
  try {
    const membership=await getDoc(doc(db,'members',next.uid));
    if(epoch!==authEpoch)return;
    if(!membership.exists() || membership.data().active!==true){
      notify('This account is not approved for the MOLDIS research group. Ask the group administrator for access.',true);
      await signOut(auth);return;
    }
    user=next;isMember=true;
    $('user-chip').classList.remove('hidden');
    $('user-chip').textContent=user.displayName||membership.data().name||user.email;
    $('auth-button').textContent='Sign out';$('change-password-button').classList.remove('hidden');
    attachData();render();
  } catch(err){if(epoch===authEpoch)issue(err);}
});}catch(err){issue(err);}}else{$('questions-list').innerHTML='<div class="empty-state">Set up Firebase to enable the forum. See README.md.</div>';}
renderRanks();
