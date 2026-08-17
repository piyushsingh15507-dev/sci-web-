// ===================== BOOTSTRAP =====================
let sections = [];       // [{id,name,marks,questions:[{id,img,pos,neg,options:[{id,label,img}]}]}]
let testRow = null;
let profile = null;
let totalDuration = 0;
let remainingMs = 0;
let timerInterval = null;
let curSection = 0, curQuestion = 0;
let submitted = false;
let answers = [];
let totalMarksPossible = 0;
let tabSwitchCount = 0;
let fullscreenExitCount = 0;
const MAX_FULLSCREEN_EXITS = 3;
let questionTimerInterval = null;
let questionEnterTs = 0;

const params = new URLSearchParams(window.location.search);
const testId = params.get('test_id');
const reviewResultId = params.get('review');

(async () => {
  const session = await requireLogin();
  if(!session) return;
  profile = await getCurrentProfile();

  if(reviewResultId){
    try {
      await loadReviewMode(reviewResultId);
    } catch(err){
      console.error(err);
      document.getElementById('loading-text').textContent = 'Failed to load result: ' + err.message;
    }
    return;
  }

  // Check once, before starting — an active timed exam is never interrupted mid-way by maintenance mode.
  if(await isMaintenanceOn(profile)){
    document.getElementById('loading-screen').style.display = 'none';
    showMaintenanceOverlay();
    return;
  }

  if(!testId){ document.getElementById('loading-text').textContent = 'No test specified.'; return; }

  try {
    await loadTestData();
    startExam();
  } catch(err){
    console.error(err);
    document.getElementById('loading-text').textContent = 'Failed to load test: ' + err.message;
  }
})();

async function loadReviewMode(resultId){
  document.getElementById('loading-text').textContent = 'Loading your result...';
  const { data: result, error } = await supabaseClient
    .from('results').select('*, tests(*)').eq('id', resultId).single();
  if(error) throw error;
  testRow = result.tests;

  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('result').style.display = 'block';
  document.getElementById('result-title').textContent = testRow.name + ' — Result';

  if(!testRow.solutions_released){
    document.getElementById('btn-download-report').style.display = 'none';
    document.getElementById('result-sub').textContent = 'Score is in — solutions are locked for now.';
    document.getElementById('result-score').textContent = `${result.total_score}`;
    document.getElementById('summary-cards').innerHTML = `
      <div class="summary-card"><div class="val" style="color:var(--green-dark)">${result.total_correct}</div><div class="lbl">Correct</div></div>
      <div class="summary-card"><div class="val" style="color:#c0292c">${result.total_incorrect}</div><div class="lbl">Incorrect</div></div>
      <div class="summary-card"><div class="val" style="color:var(--gray)">${result.total_unattempted}</div><div class="lbl">Unattempted</div></div>
      <div class="summary-card"><div class="val" style="color:var(--primary-dark)">${fmtHMS(result.time_taken_ms)}</div><div class="lbl">Time Taken</div></div>
    `;
    document.getElementById('section-table-body').innerHTML = '';
    document.getElementById('review-tabs').style.display = 'none';
    document.getElementById('review-container').innerHTML =
      `<div class="shadow-card center muted" style="padding:36px;">🔒 Solutions & correct answers haven't been released for this test yet.<br>Check back later on "My Results".</div>`;
    return;
  }

  // solutions released — load section/question order so the review can render fully
  const { data: secRows } = await supabaseClient.from('sections').select('*').eq('test_id', testRow.id).order('order_no');
  const sectionIds = secRows.map(s => s.id);
  const { data: qRows } = await supabaseClient.from('questions_for_student').select('*').in('section_id', sectionIds).order('order_no');
  const questionIds = qRows.map(q => q.id);
  let optRows = [];
  if(questionIds.length){
    const { data: oRows } = await supabaseClient.from('options_for_student').select('*').in('question_id', questionIds).order('order_no');
    optRows = oRows;
  }
  sections = secRows.map(sec => ({
    id: sec.id, name: sec.name, marks: sec.section_marks,
    questions: qRows.filter(q => q.section_id === sec.id).map(q => ({
      id: q.id, img: q.image_url, text: q.text_content, pos: q.positive_marks, neg: q.negative_marks,
      options: optRows.filter(o => o.question_id === q.id).map(o => ({ id: o.id, label: o.label, img: o.image_url, text: o.text_content }))
    }))
  }));
  totalMarksPossible = sections.reduce((n,s) => n + s.questions.reduce((m,q) => m+q.pos, 0), 0);

  renderResult(result, false);
}

async function loadTestData(){
  document.getElementById('loading-text').textContent = 'Fetching test details...';
  const { data: test, error: testErr } = await supabaseClient
    .from('tests').select('*').eq('id', testId).single();
  if(testErr) throw testErr;
  testRow = test;
  totalDuration = test.duration_ms;
  remainingMs = totalDuration;

  if(test.max_attempts){
    const { count, error: cntErr } = await supabaseClient
      .from('results').select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id).eq('test_id', testId);
    if(cntErr) throw cntErr;
    if(count >= test.max_attempts){
      throw new Error(`You've already used all ${test.max_attempts} attempt(s) allowed for this test.`);
    }
  }

  document.getElementById('loading-text').textContent = 'Loading sections...';
  const { data: secRows, error: secErr } = await supabaseClient
    .from('sections').select('*').eq('test_id', testId).order('order_no');
  if(secErr) throw secErr;
  if(!secRows || secRows.length===0) throw new Error('This test has no sections yet.');

  const sectionIds = secRows.map(s => s.id);

  document.getElementById('loading-text').textContent = 'Loading questions...';
  const { data: qRows, error: qErr } = await supabaseClient
    .from('questions_for_student').select('*').in('section_id', sectionIds).order('order_no');
  if(qErr) throw qErr;

  const questionIds = qRows.map(q => q.id);
  let optRows = [];
  if(questionIds.length>0){
    document.getElementById('loading-text').textContent = 'Loading options...';
    const { data: oRows, error: oErr } = await supabaseClient
      .from('options_for_student').select('*').in('question_id', questionIds).order('order_no');
    if(oErr) throw oErr;
    optRows = oRows;
  }

  sections = secRows.map(sec => ({
    id: sec.id,
    name: sec.name,
    marks: sec.section_marks,
    questions: qRows.filter(q => q.section_id === sec.id).map(q => ({
      id: q.id,
      img: q.image_url,
      text: q.text_content,
      pos: q.positive_marks,
      neg: q.negative_marks,
      options: optRows.filter(o => o.question_id === q.id).map(o => ({
        id: o.id, label: o.label, img: o.image_url, text: o.text_content
      }))
    }))
  }));

  totalMarksPossible = sections.reduce((n,s)=>n+s.questions.reduce((m,q)=>m+q.pos,0),0);
  answers = sections.map(sec => sec.questions.map(() => ({ selectedOptId: null, status: 'not-visited' })));
}

function startExam(){
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('exam').style.display = 'flex';
  document.getElementById('exam-title').textContent = testRow.name;
  document.getElementById('exam-user').textContent = profile?.name || profile?.email || 'Candidate';
  if(profile && profile.role === 'admin'){
    document.getElementById('exam-user').textContent += ' — 👁 Admin Preview Mode';
  }
  const displayName = profile?.name || profile?.email || 'Candidate';
  document.getElementById('sidebar-name').textContent = displayName;
  const initials = displayName.trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()).join('') || 'C';
  const avatarColors = ['#2f6fed','#7c5cf0','#22a06b','#f5a524','#e5484d','#0ea5b7'];
  const colorIdx = displayName.length % avatarColors.length;
  const avatarEl = document.getElementById('avatar-circle');
  avatarEl.textContent = initials;
  avatarEl.style.background = avatarColors[colorIdx];
  document.getElementById('result-title').textContent = testRow.name + ' — Result';
  buildSectionTabs();
  buildPalette();
  visit(0,0);
  startTimer();
  document.body.classList.add('exam-active');
  enterFullscreen();
  setupAntiCheat();
}

// ===================== ANTI-CHEATING =====================
function enterFullscreen(){
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if(req) req.call(el).catch(()=>{ /* user may have blocked it; still proceed */ });
}
function isFullscreen(){
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
}

function setupAntiCheat(){
  // Block right-click
  document.addEventListener('contextmenu', e => { if(!submitted) e.preventDefault(); });
  // Block copy
  document.addEventListener('copy', e => { if(!submitted && document.getElementById('exam').style.display!=='none') e.preventDefault(); });
  // Block common devtools / view-source shortcuts
  document.addEventListener('keydown', e => {
    if(submitted) return;
    const k = e.key ? e.key.toUpperCase() : '';
    const blocked =
      k === 'F12' ||
      (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(k)) ||
      (e.ctrlKey && k === 'U') ||
      (e.metaKey && e.altKey && ['I','J','C'].includes(k));
    if(blocked) e.preventDefault();
  });

  // Tab switch detection
  document.addEventListener('visibilitychange', () => {
    if(submitted) return;
    if(document.visibilityState === 'hidden'){
      tabSwitchCount++;
      const banner = document.getElementById('tab-warning-banner');
      banner.textContent = `⚠ Tab switch detected (${tabSwitchCount})! Stay on this page — this is being recorded.`;
    }
  });
  window.addEventListener('focus', () => {
    if(submitted) return;
    if(tabSwitchCount > 0){
      const banner = document.getElementById('tab-warning-banner');
      banner.classList.add('show');
      setTimeout(()=>banner.classList.remove('show'), 4000);
    }
  });

  // Fullscreen exit detection
  ['fullscreenchange','webkitfullscreenchange','msfullscreenchange'].forEach(evt => {
    document.addEventListener(evt, onFullscreenChange);
  });

  document.getElementById('violation-resume-btn').addEventListener('click', () => {
    document.getElementById('violation-modal').classList.remove('show');
    enterFullscreen();
  });
}

function onFullscreenChange(){
  if(submitted) return;
  if(!isFullscreen()){
    fullscreenExitCount++;
    if(fullscreenExitCount >= MAX_FULLSCREEN_EXITS){
      finishSubmit(false, 'fullscreen');
      return;
    }
    const modal = document.getElementById('violation-modal');
    const title = document.getElementById('violation-title');
    const text = document.getElementById('violation-text');
    if(fullscreenExitCount === 1){
      title.textContent = '⚠ Warning 1/3 — Fullscreen Exited';
      text.textContent = "You must stay in fullscreen during the test. Exiting 3 times will auto-submit your test.";
    } else if(fullscreenExitCount === 2){
      title.textContent = '🚨 Warning 2/3 — Final Warning';
      text.textContent = "One more exit and your test will be auto-submitted immediately!";
    }
    modal.classList.add('show');
  }
}

// ===================== TIMER =====================
function startTimer(){
  updateClock();
  timerInterval = setInterval(()=>{
    remainingMs -= 1000;
    if(remainingMs <= 0){
      remainingMs = 0; updateClock();
      clearInterval(timerInterval);
      finishSubmit(true);
      return;
    }
    updateClock();
  }, 1000);
}
function updateClock(){
  const totalSec = Math.max(0, Math.floor(remainingMs/1000));
  const h = String(Math.floor(totalSec/3600)).padStart(2,'0');
  const m = String(Math.floor((totalSec%3600)/60)).padStart(2,'0');
  const s = String(totalSec%60).padStart(2,'0');
  document.getElementById('clock').textContent = `${h}:${m}:${s}`;
  document.getElementById('timer-wrap').classList.toggle('timer-warning', totalSec<=300);
}

// ===================== SECTION TABS =====================
function buildSectionTabs(){
  const wrap = document.getElementById('section-tabs');
  wrap.innerHTML = '';
  sections.forEach((sec,i)=>{
    const btn = document.createElement('button');
    btn.className = 'section-tab' + (i===curSection?' active':'');
    btn.textContent = `${sec.name} (${sec.questions.length})`;
    btn.addEventListener('click', ()=> visit(i,0));
    wrap.appendChild(btn);
  });
}
function refreshSectionTabs(){
  document.querySelectorAll('.section-tab').forEach((b,i)=>b.classList.toggle('active', i===curSection));
}

// ===================== PALETTE =====================
function buildPalette(){
  const container = document.getElementById('palette-container');
  container.innerHTML='';
  sections.forEach((sec,si)=>{
    const label = document.createElement('div');
    label.className='palette-section-name'; label.textContent=sec.name;
    container.appendChild(label);
    const grid = document.createElement('div');
    grid.className='palette-grid';
    sec.questions.forEach((q,qi)=>{
      const b = document.createElement('button');
      b.className='palette-btn'; b.textContent=qi+1; b.id=`pal-${si}-${qi}`;
      b.addEventListener('click', ()=>visit(si,qi));
      grid.appendChild(b);
    });
    container.appendChild(grid);
  });
  refreshPalette();
}
function refreshPalette(){
  sections.forEach((sec,si)=>sec.questions.forEach((q,qi)=>{
    const b = document.getElementById(`pal-${si}-${qi}`);
    if(!b) return;
    b.className = 'palette-btn ' + answers[si][qi].status;
    if(si===curSection && qi===curQuestion) b.classList.add('current');
  }));
  updateProgressCounts();
}
function updateProgressCounts(){
  let answeredCt=0, notAnsweredCt=0, markedCt=0, notVisitedCt=0;
  answers.forEach(secArr=>secArr.forEach(st=>{
    if(st.status==='answered'||st.status==='answered-marked') answeredCt++;
    else if(st.status==='not-answered') notAnsweredCt++;
    else if(st.status==='marked') markedCt++;
    else notVisitedCt++;
  }));
  const set = (id,val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set('cnt-answered', answeredCt);
  set('cnt-not-answered', notAnsweredCt);
  set('cnt-marked', markedCt);
  set('cnt-not-visited', notVisitedCt);
}

// ===================== NAVIGATION =====================
function visit(si,qi){
  accumulateQuestionTime(); // save elapsed time on the question we're leaving
  curSection=si; curQuestion=qi;
  const st = answers[si][qi];
  if(st.status==='not-visited') st.status='not-answered';
  startQuestionTimer();
  renderQuestion();
  refreshSectionTabs();
  refreshPalette();
}

function accumulateQuestionTime(){
  if(questionEnterTs && answers[curSection] && answers[curSection][curQuestion]){
    const elapsed = Date.now() - questionEnterTs;
    const st = answers[curSection][curQuestion];
    st.timeSpentMs = (st.timeSpentMs || 0) + elapsed;
  }
}

function startQuestionTimer(){
  clearInterval(questionTimerInterval);
  questionEnterTs = Date.now();
  updateQuestionTimerDisplay();
  questionTimerInterval = setInterval(updateQuestionTimerDisplay, 1000);
}
function updateQuestionTimerDisplay(){
  const el = document.getElementById('q-timer-display');
  if(!el) return;
  const secs = Math.floor((Date.now() - questionEnterTs) / 1000);
  const m = String(Math.floor(secs/60)).padStart(2,'0');
  const s = String(secs%60).padStart(2,'0');
  el.textContent = `${m}:${s}`;
}
function renderQuestion(){
  const sec = sections[curSection];
  const q = sec.questions[curQuestion];
  const state = answers[curSection][curQuestion];
  const scroll = document.getElementById('q-scroll');

  const statusLabel = state.status==='answered' ? 'Answered'
    : state.status==='answered-marked' ? 'Answered & Marked'
    : state.status==='marked' ? 'Marked for Review'
    : 'Not Answered';
  const statusCls = (state.status==='answered'||state.status==='answered-marked') ? 'st-answered'
    : (state.status==='marked') ? 'st-marked' : '';

  let html = `
    <div class="q-header">
      <div class="q-header-left">
        <span class="q-num-badge">Question-${curQuestion+1}</span>
        <span class="q-status-pill ${statusCls}">${statusLabel}</span>
      </div>
      <div class="q-header-right">
        <span class="q-timer">⏱ <span id="q-timer-display">00:00</span></span>
        <span class="q-marks"><span class="mark-pill pos">+${q.pos}</span><span class="mark-pill neg">-${q.neg}</span></span>
        <button class="btn-header-outline ${(state.status==='marked'||state.status==='answered-marked')?'active':''}" id="btn-mark-header">🚩 Mark for Review</button>
        <button class="btn-save-header" id="btn-save-header">🔖 Save</button>
      </div>
    </div>
    <div class="q-card"><div class="q-image-wrap">${q.img?`<img src="${q.img}" alt="Question">`: q.text ? `<p style="font-size:15px;line-height:1.6;white-space:pre-wrap;">${q.text}</p>` : '<p>(no content)</p>'}</div></div>
    <div class="q-card"><div class="options">
  `;
  q.options.forEach(opt=>{
    const selected = state.selectedOptId===opt.id;
    html += `<div class="option ${selected?'selected':''}" data-optid="${opt.id}">
      <span class="opt-letter">${opt.label}</span>
      ${opt.img?`<img src="${opt.img}" style="max-height:60px;">`: opt.text ? `<span>${opt.text}</span>` : ''}
    </div>`;
  });
  html += `</div></div>`;
  scroll.innerHTML = html;
  updateQuestionTimerDisplay();

  document.getElementById('btn-save-header').addEventListener('click', goNext);
  document.getElementById('btn-mark-header').addEventListener('click', () => {
    state.status = state.selectedOptId ? 'answered-marked' : 'marked';
    refreshPalette();
    goNext();
  });

  scroll.querySelectorAll('.option').forEach(el=>{
    el.addEventListener('click', ()=>{
      const optId = el.getAttribute('data-optid');
      state.selectedOptId = (state.selectedOptId===optId) ? null : optId;
      if(state.status==='marked') state.status='answered-marked';
      else if(state.status!=='answered-marked') state.status = state.selectedOptId ? 'answered' : 'not-answered';
      renderQuestion();
      refreshPalette();
    });
  });
  document.getElementById('btn-prev').disabled = (curSection===0 && curQuestion===0);
}

// ===================== ACTIONS =====================
document.getElementById('btn-save').addEventListener('click', goNext);
document.getElementById('btn-clear').addEventListener('click', ()=>{
  const state = answers[curSection][curQuestion];
  state.selectedOptId = null;
  state.status = (state.status==='answered-marked'||state.status==='marked') ? 'marked' : 'not-answered';
  renderQuestion(); refreshPalette();
});
document.getElementById('btn-prev').addEventListener('click', ()=>{
  if(curQuestion>0) visit(curSection, curQuestion-1);
  else if(curSection>0) visit(curSection-1, sections[curSection-1].questions.length-1);
});
function goNext(){
  const sec = sections[curSection];
  if(curQuestion < sec.questions.length-1) visit(curSection, curQuestion+1);
  else if(curSection < sections.length-1) visit(curSection+1, 0);
  else refreshPalette();
}

// ===================== SUBMIT =====================
document.getElementById('btn-submit').addEventListener('click', openSubmitModal);
document.getElementById('btn-submit-bottom').addEventListener('click', openSubmitModal);
document.getElementById('modal-cancel').addEventListener('click', ()=>document.getElementById('submit-modal').classList.remove('show'));
document.getElementById('modal-confirm').addEventListener('click', ()=>{
  document.getElementById('submit-modal').classList.remove('show');
  finishSubmit(false);
});

function computeCounts(){
  let answeredCt=0, notAnsweredCt=0, markedCt=0, notVisitedCt=0;
  answers.forEach(secArr=>secArr.forEach(st=>{
    if(st.status==='answered'||st.status==='answered-marked') answeredCt++;
    else if(st.status==='not-answered') notAnsweredCt++;
    else if(st.status==='marked') markedCt++;
    else notVisitedCt++;
  }));
  return {answeredCt,notAnsweredCt,markedCt,notVisitedCt};
}
function openSubmitModal(){
  const c = computeCounts();
  document.getElementById('modal-stats').innerHTML = `
    <div class="modal-stat">Answered <b style="color:var(--green-dark)">${c.answeredCt}</b></div>
    <div class="modal-stat">Not Answered <b style="color:#c0292c">${c.notAnsweredCt}</b></div>
    <div class="modal-stat">Marked for Review <b style="color:#7c3aed">${c.markedCt}</b></div>
    <div class="modal-stat">Not Visited <b style="color:var(--muted)">${c.notVisitedCt}</b></div>
  `;
  document.getElementById('submit-modal').classList.add('show');
}

async function finishSubmit(auto, reason){
  if(submitted) return;
  submitted = true;
  accumulateQuestionTime(); // flush the time on whichever question was open at submit
  clearInterval(timerInterval);
  clearInterval(questionTimerInterval);
  document.body.classList.remove('exam-active');
  if(isFullscreen()){
    const exitFn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if(exitFn) exitFn.call(document).catch(()=>{});
  }
  document.getElementById('violation-modal').classList.remove('show');
  document.getElementById('tab-warning-banner').classList.remove('show');
  document.getElementById('exam').style.display='none';
  document.getElementById('loading-screen').style.display='flex';
  document.getElementById('loading-text').textContent = reason==='fullscreen'
    ? 'Too many fullscreen exits — auto-submitting your test...'
    : 'Submitting your answers...';

  // Build the answers payload { question_id: chosen_option_id }
  const payload = {};
  sections.forEach((sec,si)=>sec.questions.forEach((q,qi)=>{
    const st = answers[si][qi];
    if(st.selectedOptId) payload[q.id] = st.selectedOptId;
  }));

  const timeUsedMs = totalDuration - remainingMs;

  const { data, error } = await supabaseClient.rpc('submit_attempt', {
    p_test_id: testId,
    p_answers: payload,
    p_time_taken_ms: timeUsedMs,
    p_tab_switches: tabSwitchCount,
    p_fullscreen_exits: fullscreenExitCount
  });

  document.getElementById('loading-screen').style.display='none';

  if(error){
    alert('Submission failed: ' + error.message + '\nPlease try again or contact your admin.');
    submitted = false;
    document.getElementById('exam').style.display='flex';
    document.body.classList.add('exam-active');
    startTimer(); // resume, in case of transient error (not auto-submit case)
    return;
  }

  document.getElementById('result').style.display='block';
  renderResult(data, auto || reason==='fullscreen');
  window.scrollTo(0,0);
}

// ===================== RESULT RENDER =====================
function fmtHMS(ms){
  const totalSec = Math.max(0,Math.floor(ms/1000));
  const h = Math.floor(totalSec/3600), m = Math.floor((totalSec%3600)/60), s = totalSec%60;
  return `${h>0?h+'h ':''}${m}m ${s}s`;
}

let lastResultData = null;

document.getElementById('btn-download-report').addEventListener('click', downloadReportPdf);

function renderResult(data, auto){
  lastResultData = data;
  document.getElementById('btn-download-report').style.display = testRow.solutions_released ? '' : 'none';
  let subText = auto
    ? "Time's up — your test was auto-submitted."
    : "Here's how you performed.";
  if(fullscreenExitCount >= MAX_FULLSCREEN_EXITS){
    subText = "Your test was auto-submitted after repeated fullscreen exits.";
  }
  document.getElementById('result-sub').textContent = subText;
  document.getElementById('result-score').textContent = `${data.total_score} / ${totalMarksPossible}`;

  document.getElementById('summary-cards').innerHTML = `
    <div class="summary-card"><div class="val" style="color:var(--green-dark)">${data.total_correct}</div><div class="lbl">Correct</div></div>
    <div class="summary-card"><div class="val" style="color:#c0292c">${data.total_incorrect}</div><div class="lbl">Incorrect</div></div>
    <div class="summary-card"><div class="val" style="color:var(--gray)">${data.total_unattempted}</div><div class="lbl">Unattempted</div></div>
    <div class="summary-card"><div class="val" style="color:var(--primary-dark)">${fmtHMS(data.time_taken_ms)}</div><div class="lbl">Time Taken</div></div>
  `;

  // group detail by section_name, preserving section order from `sections`
  const detailByQ = {};
  data.detail.forEach(d => detailByQ[d.question_id] = d);

  const secStats = sections.map(sec => {
    let correct=0, incorrect=0, unattempted=0, marks=0;
    sec.questions.forEach(q=>{
      const d = detailByQ[q.id];
      if(!d) return;
      if(d.outcome==='correct') correct++;
      else if(d.outcome==='incorrect') incorrect++;
      else unattempted++;
      marks += Number(d.gained);
    });
    return { name: sec.name, marks, maxMarks: sec.marks, correct, incorrect, unattempted };
  });

  document.getElementById('section-table-body').innerHTML = secStats.map(s=>`
    <tr>
      <td><b>${s.name}</b></td>
      <td>${s.marks} / ${s.maxMarks}</td>
      <td style="color:var(--green-dark);font-weight:700;">${s.correct}</td>
      <td style="color:#c0292c;font-weight:700;">${s.incorrect}</td>
      <td style="color:var(--muted);">${s.unattempted}</td>
    </tr>
  `).join('');

  const tabsWrap = document.getElementById('review-tabs');
  if(testRow.solutions_released){
    tabsWrap.style.display = '';
    tabsWrap.innerHTML = sections.map((s,i)=>`<button class="review-tab ${i===0?'active':''}" data-idx="${i}">${s.name}</button>`).join('');
    tabsWrap.querySelectorAll('.review-tab').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        tabsWrap.querySelectorAll('.review-tab').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        renderReviewSection(parseInt(btn.getAttribute('data-idx')), detailByQ);
      });
    });
    renderReviewSection(0, detailByQ);
  } else {
    tabsWrap.style.display = 'none';
    document.getElementById('review-container').innerHTML =
      `<div class="shadow-card center muted" style="padding:36px;">🔒 Solutions & correct answers haven't been released yet.<br>Your instructor will release them soon — check "My Results" later.</div>`;
  }
}

function renderReviewSection(si, detailByQ){
  const sec = sections[si];
  const container = document.getElementById('review-container');
  let html = '';
  sec.questions.forEach((q,qi)=>{
    const d = detailByQ[q.id];
    if(!d) return;
    const pillClass = d.outcome==='correct'?'correct':(d.outcome==='incorrect'?'incorrect':'unattempted');
    const pillText = d.outcome==='correct'?'Correct':(d.outcome==='incorrect'?'Incorrect':'Not Attempted');
    html += `
      <div class="review-q-card">
        <div class="review-q-head">
          <span class="q-num-badge">${sec.name} · Q${qi+1}</span>
          <div style="display:flex;gap:8px;">
            <span class="status-pill ${pillClass}">${pillText}</span>
            <span class="status-pill marks">${d.gained>=0?'+':''}${d.gained} marks</span>
          </div>
        </div>
        <div class="q-image-wrap">${q.img?`<img src="${q.img}" alt="Question">`: q.text ? `<p style="font-size:15px;line-height:1.6;white-space:pre-wrap;">${q.text}</p>` : ''}</div>
        <div class="options" style="margin-top:14px;">
          ${q.options.map(opt=>{
            let cls='option';
            if(opt.id === d.correct_option_id) cls+=' correct-answer';
            else if(opt.id === d.chosen_option_id) cls+=' wrong-selected';
            let tag='';
            if(opt.id === d.correct_option_id) tag='<span class="tag correct">Correct Answer</span>';
            else if(opt.id === d.chosen_option_id) tag='<span class="tag wrong">Your Answer</span>';
            const content = opt.img?`<img src="${opt.img}" style="max-height:50px;">`: opt.text ? `<span>${opt.text}</span>` : '';
            return `<div class="${cls}"><span class="opt-letter">${opt.label}</span>${content}${tag}</div>`;
          }).join('')}
        </div>
        ${(d.solution_image_url || d.solution_text) ? `
          <div class="solution-box">
            <h4>Solution</h4>
            <div class="q-image-wrap">${d.solution_image_url ? `<img src="${d.solution_image_url}" alt="Solution">` : `<p style="font-size:14px;line-height:1.6;white-space:pre-wrap;">${d.solution_text}</p>`}</div>
          </div>` : ''}
      </div>
    `;
  });
  container.innerHTML = html;
}

// ===================== PERFORMANCE REPORT (PDF) =====================
// Generates the report entirely in the browser using data already in memory —
// nothing is uploaded or stored on our server, it goes straight to the student's download.
function downloadReportPdf(){
  if(!lastResultData){ alert('No result available yet.'); return; }
  if(!window.jspdf){ alert('PDF library failed to load. Please check your internet connection and try again.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageBottom = 280;
  let y = 20;

  function ensureSpace(lines=1){
    if(y + lines*6 > pageBottom){ doc.addPage(); y = 20; }
  }

  doc.setFontSize(16); doc.setFont(undefined,'bold');
  doc.text(testRow.name + ' - Performance Report', 14, y); y += 9;

  doc.setFontSize(10); doc.setFont(undefined,'normal');
  doc.text(`Student: ${profile?.name || profile?.email || 'N/A'}`, 14, y); y += 6;
  doc.text(`Submitted: ${new Date().toLocaleString()}`, 14, y); y += 10;

  doc.setFontSize(13); doc.setFont(undefined,'bold');
  doc.text(`Total Score: ${lastResultData.total_score} / ${totalMarksPossible}`, 14, y); y += 8;
  doc.setFont(undefined,'normal'); doc.setFontSize(10);
  doc.text(`Correct: ${lastResultData.total_correct}    Incorrect: ${lastResultData.total_incorrect}    Unattempted: ${lastResultData.total_unattempted}`, 14, y); y += 6;
  doc.text(`Time Taken: ${fmtHMS(lastResultData.time_taken_ms)}`, 14, y); y += 12;

  const detailByQ = {};
  lastResultData.detail.forEach(d => detailByQ[d.question_id] = d);

  const secStats = sections.map((sec, si) => {
    let correct=0, incorrect=0, unattempted=0, marks=0, timeMs=0;
    sec.questions.forEach((q, qi) => {
      const d = detailByQ[q.id];
      if(d){
        if(d.outcome==='correct') correct++;
        else if(d.outcome==='incorrect') incorrect++;
        else unattempted++;
        marks += Number(d.gained);
      }
      timeMs += (answers[si][qi].timeSpentMs || 0);
    });
    const attempted = correct+incorrect;
    return { name: sec.name, marks, maxMarks: sec.marks, correct, incorrect, unattempted, timeMs,
      accuracy: attempted>0 ? (correct/attempted*100) : 0 };
  });

  ensureSpace(3);
  doc.setFontSize(12); doc.setFont(undefined,'bold');
  doc.text('Section-wise Performance', 14, y); y += 8;
  doc.setFontSize(9); doc.setFont(undefined,'bold');
  doc.text('Section', 14, y); doc.text('Score', 75, y); doc.text('Correct', 100, y);
  doc.text('Incorrect', 125, y); doc.text('Unatt.', 155, y); doc.text('Time', 175, y);
  y += 3;
  doc.setLineWidth(0.2); doc.line(14, y, 196, y); y += 6;
  doc.setFont(undefined,'normal');

  secStats.forEach(s => {
    ensureSpace(1);
    doc.text(s.name, 14, y);
    doc.text(`${s.marks}/${s.maxMarks}`, 75, y);
    doc.text(String(s.correct), 100, y);
    doc.text(String(s.incorrect), 125, y);
    doc.text(String(s.unattempted), 155, y);
    doc.text(fmtHMS(s.timeMs), 175, y);
    y += 7;
  });
  y += 6;

  const attemptedSecs = secStats.filter(s => s.correct + s.incorrect > 0);
  if(attemptedSecs.length){
    const weakest = [...attemptedSecs].sort((a,b)=>a.accuracy-b.accuracy)[0];
    ensureSpace(2);
    doc.setFont(undefined,'bold'); doc.setFontSize(11);
    doc.text(`Focus Area: ${weakest.name} (${weakest.accuracy.toFixed(0)}% accuracy)`, 14, y); y += 10;
  }

  let allQTimes = [];
  sections.forEach((sec, si) => sec.questions.forEach((q, qi) => {
    allQTimes.push({ label: `${sec.name} — Q${qi+1}`, timeMs: answers[si][qi].timeSpentMs || 0 });
  }));
  allQTimes.sort((a,b)=>b.timeMs-a.timeMs);
  const slowest = allQTimes.filter(t=>t.timeMs>0).slice(0,5);
  if(slowest.length){
    ensureSpace(slowest.length + 2);
    doc.setFont(undefined,'bold'); doc.setFontSize(11);
    doc.text('Questions That Took the Longest', 14, y); y += 8;
    doc.setFont(undefined,'normal'); doc.setFontSize(9.5);
    slowest.forEach(t => {
      ensureSpace(1);
      doc.text(`${t.label}  —  ${fmtHMS(t.timeMs)}`, 14, y);
      y += 6;
    });
  }

  const safeTestName = testRow.name.replace(/[^a-z0-9]+/gi, '_');
  doc.save(`${safeTestName}_Report.pdf`);
}
