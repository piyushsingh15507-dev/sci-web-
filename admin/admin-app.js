let adminProfile = null;

// ===================== THEME (DARK / LIGHT) =====================
(function initTheme(){
  const saved = localStorage.getItem('admin-theme');
  if(saved === 'dark') document.body.classList.add('dark-mode');
  updateThemeBtnLabel();
})();
function updateThemeBtnLabel(){
  const btn = document.getElementById('theme-toggle-btn');
  if(!btn) return;
  btn.textContent = document.body.classList.contains('dark-mode') ? '☀️ Light Mode' : '🌙 Dark Mode';
}
document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('admin-theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  updateThemeBtnLabel();
});

(async () => {
  adminProfile = await requireAdmin();
  if(!adminProfile) return;
  document.getElementById('admin-name').textContent = `— ${adminProfile.name || adminProfile.email}`;
  loadTestsTable();
  loadPasscode();
  loadResultsTestOptions();
  loadMaintenanceStatus();
})();

document.getElementById('logout-btn').addEventListener('click', () => logout());

// ===================== TABS =====================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    document.getElementById('panel-' + btn.dataset.tab).style.display = 'block';
  });
});

// ===================== MANAGE TESTS =====================
async function loadTestsTable(){
  const tbody = document.getElementById('tests-table-body');
  const { data: tests, error } = await supabaseClient.from('tests').select('*').order('created_at', { ascending:false });
  if(error){ tbody.innerHTML = `<tr><td colspan="5" class="error-msg">${error.message}</td></tr>`; return; }
  if(!tests || tests.length===0){ tbody.innerHTML = `<tr><td colspan="5" class="muted">No tests yet. Create one in the "Create Test" tab.</td></tr>`; return; }

  tbody.innerHTML = tests.map(t => {
    const h = Math.floor(t.duration_ms/3600000), m = Math.round((t.duration_ms%3600000)/60000);
    return `
      <tr>
        <td><b>${t.name}</b></td>
        <td>${h>0?h+'h ':''}${m}m</td>
        <td>${t.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</td>
        <td class="muted">${new Date(t.created_at).toLocaleDateString()}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-outline small-btn" data-action="toggle" data-id="${t.id}" data-active="${t.is_active}">${t.is_active?'Deactivate':'Activate'}</button>
          <button class="btn btn-danger small-btn" data-action="delete" data-id="${t.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('button[data-action="toggle"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const isActive = btn.dataset.active === 'true';
      await supabaseClient.from('tests').update({ is_active: !isActive }).eq('id', id);
      loadTestsTable();
    });
  });
  tbody.querySelectorAll('button[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Delete this test permanently? This also deletes its sections, questions, options and results.')) return;
      const id = btn.dataset.id;
      const { error } = await supabaseClient.from('tests').delete().eq('id', id);
      if(error) alert('Delete failed: ' + error.message);
      loadTestsTable();
      loadResultsTestOptions();
    });
  });
}

// ===================== CREATE TEST BUILDER =====================
const sectionsContainer = document.getElementById('sections-container');

function uid(){ return 'x' + Math.random().toString(36).slice(2,10); }

function addSection(){
  const secId = uid();
  const div = document.createElement('div');
  div.className = 'section-block';
  div.dataset.secId = secId;
  div.innerHTML = `
    <div class="row-2">
      <div class="field"><label>Section Name</label><input type="text" class="section-name" placeholder="e.g. Biology"></div>
      <div class="field" style="align-self:end;"><button class="btn btn-danger small-btn remove-section-btn">Remove Section</button></div>
    </div>
    <div class="questions-container"></div>
    <button class="btn btn-outline small-btn add-question-btn">+ Add Question</button>
  `;
  div.querySelector('.remove-section-btn').addEventListener('click', () => div.remove());
  div.querySelector('.add-question-btn').addEventListener('click', () => addQuestion(div));
  sectionsContainer.appendChild(div);
  addQuestion(div); // start with one question
}
document.getElementById('add-section-btn').addEventListener('click', addSection);

function fileInputWithPreview(labelText, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = `<label>${labelText}</label><input type="file" accept="image/*">`;
  const input = wrap.querySelector('input');
  let preview = null;
  input.addEventListener('change', () => {
    const file = input.files[0];
    if(preview) preview.remove();
    if(file){
      preview = document.createElement('img');
      preview.className = 'thumb';
      preview.src = URL.createObjectURL(file);
      wrap.appendChild(preview);
    }
    onPick(file || null);
  });
  return { wrap, getFile: () => input.files[0] || null };
}

function addQuestion(sectionEl){
  const qId = uid();
  const qContainer = sectionEl.querySelector('.questions-container');
  const block = document.createElement('div');
  block.className = 'question-block';
  block.dataset.qId = qId;

  const qImageField = fileInputWithPreview('Question Image (required)', ()=>{});
  const solImageField = fileInputWithPreview('Solution Image (shown after submit)', ()=>{});

  block.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">
      <b>Question</b>
      <button class="btn btn-danger small-btn remove-question-btn">Remove</button>
    </div>`;
  block.appendChild(qImageField.wrap);

  const marksRow = document.createElement('div');
  marksRow.className = 'row-2';
  marksRow.innerHTML = `
    <div class="field"><label>Positive Marks</label><input type="number" class="q-positive" value="4"></div>
    <div class="field"><label>Negative Marks</label><input type="number" class="q-negative" value="1"></div>
  `;
  block.appendChild(marksRow);
  block.appendChild(solImageField.wrap);

  const optionsWrap = document.createElement('div');
  optionsWrap.className = 'options-container';
  block.appendChild(optionsWrap);

  const addOptBtn = document.createElement('button');
  addOptBtn.className = 'btn btn-outline small-btn';
  addOptBtn.textContent = '+ Add Option';
  addOptBtn.addEventListener('click', () => addOption(optionsWrap, qId));
  block.appendChild(addOptBtn);

  // default 4 options A-D
  ['A','B','C','D'].forEach(l => addOption(optionsWrap, qId, l));

  block.querySelector('.remove-question-btn').addEventListener('click', () => block.remove());

  block._qImageField = qImageField;
  block._solImageField = solImageField;

  qContainer.appendChild(block);
}

function addOption(optionsWrap, qId, defaultLabel){
  const optId = uid();
  const row = document.createElement('div');
  row.className = 'option-row';
  row.dataset.optId = optId;
  const labelVal = defaultLabel || String.fromCharCode(65 + optionsWrap.children.length);
  row.innerHTML = `
    <div style="text-align:center;">
      <input type="radio" name="correct-${qId}" class="opt-correct" title="Mark as correct answer">
      <div class="correct-hint">Correct?</div>
    </div>
    <input type="text" class="opt-label" value="${labelVal}">
    <div class="img-upload"></div>
    <button class="btn btn-danger small-btn remove-opt-btn" type="button">✕</button>
  `;
  const field = fileInputWithPreview('Image (optional)', ()=>{});
  row.querySelector('.img-upload').appendChild(field.wrap);
  row._imageField = field;
  row.querySelector('.remove-opt-btn').addEventListener('click', () => row.remove());
  optionsWrap.appendChild(row);
}

// start with one section by default
addSection();

// ===================== CREATE TEST: SAVE =====================
document.getElementById('create-test-btn').addEventListener('click', createTest);

async function uploadImage(testId, file, tag){
  if(!file) return null;
  const ext = file.name.split('.').pop() || 'png';
  const path = `${testId}/${tag}_${uid()}.${ext}`;
  const { error } = await supabaseClient.storage.from('test-images').upload(path, file);
  if(error) throw new Error('Image upload failed: ' + error.message);
  const { data } = supabaseClient.storage.from('test-images').getPublicUrl(path);
  return data.publicUrl;
}

async function createTest(){
  const msgEl = document.getElementById('create-msg');
  msgEl.innerHTML = '';
  const name = document.getElementById('new-test-name').value.trim();
  const hours = parseInt(document.getElementById('new-test-hours').value || '0');
  const minutes = parseInt(document.getElementById('new-test-minutes').value || '0');

  if(!name){ msgEl.innerHTML = `<div class="error-msg">Please enter a test name.</div>`; return; }

  const sectionEls = Array.from(sectionsContainer.querySelectorAll('.section-block'));
  if(sectionEls.length===0){ msgEl.innerHTML = `<div class="error-msg">Add at least one section.</div>`; return; }

  // Validate + collect
  const plan = [];
  for(const secEl of sectionEls){
    const secName = secEl.querySelector('.section-name').value.trim();
    if(!secName){ msgEl.innerHTML = `<div class="error-msg">Every section needs a name.</div>`; return; }
    const qEls = Array.from(secEl.querySelectorAll('.question-block'));
    if(qEls.length===0){ msgEl.innerHTML = `<div class="error-msg">Section "${secName}" needs at least one question.</div>`; return; }

    const questions = [];
    for(const qEl of qEls){
      const qFile = qEl._qImageField.getFile();
      if(!qFile){ msgEl.innerHTML = `<div class="error-msg">Every question needs an image (section "${secName}").</div>`; return; }
      const solFile = qEl._solImageField.getFile();
      const positive = parseFloat(qEl.querySelector('.q-positive').value || '4');
      const negative = parseFloat(qEl.querySelector('.q-negative').value || '1');

      const optRows = Array.from(qEl.querySelectorAll('.option-row'));
      if(optRows.length < 2){ msgEl.innerHTML = `<div class="error-msg">Each question needs at least 2 options (section "${secName}").</div>`; return; }
      const anyCorrect = optRows.some(r => r.querySelector('.opt-correct').checked);
      if(!anyCorrect){ msgEl.innerHTML = `<div class="error-msg">Mark the correct option for every question (section "${secName}").</div>`; return; }

      const options = optRows.map(r => ({
        label: r.querySelector('.opt-label').value.trim() || '?',
        file: r._imageField.getFile(),
        correct: r.querySelector('.opt-correct').checked
      }));

      questions.push({ qFile, solFile, positive, negative, options });
    }
    plan.push({ secName, questions });
  }

  // Count total uploads for progress bar
  let totalUploads = 0;
  plan.forEach(s => s.questions.forEach(q => {
    totalUploads += 1; // question image
    if(q.solFile) totalUploads += 1;
    q.options.forEach(o => { if(o.file) totalUploads += 1; });
  }));
  let doneUploads = 0;
  const progressWrap = document.getElementById('progress-wrap');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-bar-fill');
  progressWrap.style.display = 'block';
  const bump = () => {
    doneUploads++;
    const pct = totalUploads>0 ? Math.round(doneUploads/totalUploads*100) : 100;
    progressFill.style.width = pct + '%';
    progressText.textContent = `Uploading images... (${doneUploads}/${totalUploads})`;
  };

  const createBtn = document.getElementById('create-test-btn');
  createBtn.disabled = true;

  try {
    progressText.textContent = 'Creating test...';
    const { data: testRow, error: testErr } = await supabaseClient.from('tests').insert({
      name, duration_ms: (hours*3600 + minutes*60) * 1000, is_active: true, created_by: adminProfile.id
    }).select().single();
    if(testErr) throw testErr;

    let secOrder = 1;
    for(const sec of plan){
      let sectionMarksSum = sec.questions.reduce((n,q)=>n+q.positive,0);
      const { data: secRow, error: secErr } = await supabaseClient.from('sections').insert({
        test_id: testRow.id, name: sec.secName, order_no: secOrder++, section_marks: sectionMarksSum
      }).select().single();
      if(secErr) throw secErr;

      let qOrder = 1;
      for(const q of sec.questions){
        const qImgUrl = await uploadImage(testRow.id, q.qFile, 'q'); bump();
        const solImgUrl = q.solFile ? await (async()=>{ const u = await uploadImage(testRow.id, q.solFile, 'sol'); bump(); return u; })() : null;

        const { data: qRow, error: qErr } = await supabaseClient.from('questions').insert({
          section_id: secRow.id, image_url: qImgUrl, order_no: qOrder++,
          positive_marks: q.positive, negative_marks: q.negative, solution_image_url: solImgUrl
        }).select().single();
        if(qErr) throw qErr;

        let optOrder = 1;
        for(const opt of q.options){
          const optImgUrl = opt.file ? await (async()=>{ const u = await uploadImage(testRow.id, opt.file, 'opt'); bump(); return u; })() : null;
          const { error: optErr } = await supabaseClient.from('options').insert({
            question_id: qRow.id, label: opt.label, image_url: optImgUrl,
            is_correct: opt.correct, order_no: optOrder++
          });
          if(optErr) throw optErr;
        }
      }
    }

    progressWrap.style.display = 'none';
    msgEl.innerHTML = `<div class="success-msg">Test "${name}" created successfully with ${plan.reduce((n,s)=>n+s.questions.length,0)} questions!</div>`;
    sectionsContainer.innerHTML = '';
    document.getElementById('new-test-name').value = '';
    addSection();
    loadTestsTable();
    loadResultsTestOptions();
  } catch(err){
    console.error(err);
    progressWrap.style.display = 'none';
    msgEl.innerHTML = `<div class="error-msg">Failed: ${err.message}</div>`;
  } finally {
    createBtn.disabled = false;
  }
}

// ===================== BULK IMPORT (paste JSON) =====================
function extractImgSrc(html){
  if(!html) return null;
  const m = html.match(/src="([^"]+)"/);
  return m ? m[1] : null;
}

function parseRawTestJson(raw){
  const t = raw.data || raw; // tolerate either wrapped {data:{...}} or bare {test:..., sections:...}
  const testMeta = t.test;
  const sectionsRaw = t.sections || [];
  const sections = sectionsRaw.map(s => ({
    name: s.name,
    marks: s.sectionMarks || 0,
    questions: (s.questions || []).map(q => {
      const pos = (q.marks && q.marks.positive > 0) ? q.marks.positive : 4;
      const neg = (q.marks && q.marks.negative > 0) ? q.marks.negative : 1;
      return {
        imgUrl: extractImgSrc(q.name),
        solImgUrl: extractImgSrc(q.solution),
        pos, neg,
        options: (q.options || []).map(o => ({
          label: (o.nameText || '').trim() || '?',
          imgUrl: extractImgSrc(o.name),
          correct: !!o.isCorrect
        }))
      };
    })
  }));
  return {
    name: testMeta?.name || 'Imported Test',
    duration_ms: testMeta?.testTotalDuration || 10800000,
    sections
  };
}

async function mirrorImageToStorage(testId, url, tag){
  if(!url) return { url: null, mirrored: false };
  try {
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('fetch failed: ' + resp.status);
    const blob = await resp.blob();
    let ext = (url.split('.').pop() || 'png').split('?')[0];
    if(!ext || ext.length > 5) ext = 'png';
    const path = `${testId}/${tag}_${uid()}.${ext}`;
    const { error } = await supabaseClient.storage.from('test-images')
      .upload(path, blob, { contentType: blob.type || 'image/png' });
    if(error) throw error;
    const { data } = supabaseClient.storage.from('test-images').getPublicUrl(path);
    return { url: data.publicUrl, mirrored: true };
  } catch(err){
    return { url, mirrored: false }; // fall back to original external URL
  }
}

document.getElementById('bulk-import-btn').addEventListener('click', async () => {
  const msgEl = document.getElementById('bulk-msg');
  msgEl.innerHTML = '';
  const raw = document.getElementById('bulk-json-input').value.trim();
  const doMirror = document.getElementById('bulk-mirror-images').checked;

  if(!raw){ msgEl.innerHTML = `<div class="error-msg">Paste the JSON first.</div>`; return; }

  let parsed;
  try {
    const jsonObj = JSON.parse(raw);
    parsed = parseRawTestJson(jsonObj);
  } catch(err){
    msgEl.innerHTML = `<div class="error-msg">Couldn't read that JSON: ${err.message}</div>`;
    return;
  }
  if(!parsed.sections.length){ msgEl.innerHTML = `<div class="error-msg">No sections found in this JSON.</div>`; return; }

  const totalQuestions = parsed.sections.reduce((n,s)=>n+s.questions.length,0);
  let totalImages = 0;
  parsed.sections.forEach(s=>s.questions.forEach(q=>{
    if(q.imgUrl) totalImages++;
    if(q.solImgUrl) totalImages++;
    q.options.forEach(o=>{ if(o.imgUrl) totalImages++; });
  }));

  const btn = document.getElementById('bulk-import-btn');
  btn.disabled = true;
  const progressWrap = document.getElementById('bulk-progress-wrap');
  const progressText = document.getElementById('bulk-progress-text');
  const progressFill = document.getElementById('bulk-progress-fill');
  progressWrap.style.display = 'block';

  let done = 0, mirroredCt = 0, fallbackCt = 0;
  const bump = (mirrored) => {
    done++;
    if(mirrored) mirroredCt++; else fallbackCt++;
    const pct = totalImages>0 ? Math.round(done/totalImages*100) : 100;
    progressFill.style.width = pct + '%';
    progressText.textContent = `Processing images... (${done}/${totalImages})`;
  };

  try {
    progressText.textContent = 'Creating test...';
    const { data: testRow, error: testErr } = await supabaseClient.from('tests').insert({
      name: parsed.name, duration_ms: parsed.duration_ms, is_active: true, created_by: adminProfile.id
    }).select().single();
    if(testErr) throw testErr;

    let secOrder = 1;
    for(const sec of parsed.sections){
      const sectionMarksSum = sec.questions.reduce((n,q)=>n+q.pos,0);
      const { data: secRow, error: secErr } = await supabaseClient.from('sections').insert({
        test_id: testRow.id, name: sec.name, order_no: secOrder++, section_marks: sectionMarksSum
      }).select().single();
      if(secErr) throw secErr;

      let qOrder = 1;
      for(const q of sec.questions){
        let qImgUrl = q.imgUrl, solImgUrl = q.solImgUrl;
        if(doMirror){
          if(q.imgUrl){ const r = await mirrorImageToStorage(testRow.id, q.imgUrl, 'q'); qImgUrl = r.url; bump(r.mirrored); }
          if(q.solImgUrl){ const r = await mirrorImageToStorage(testRow.id, q.solImgUrl, 'sol'); solImgUrl = r.url; bump(r.mirrored); }
        }

        const { data: qRow, error: qErr } = await supabaseClient.from('questions').insert({
          section_id: secRow.id, image_url: qImgUrl, order_no: qOrder++,
          positive_marks: q.pos, negative_marks: q.neg, solution_image_url: solImgUrl
        }).select().single();
        if(qErr) throw qErr;

        let optOrder = 1;
        for(const opt of q.options){
          let optImgUrl = opt.imgUrl;
          if(doMirror && opt.imgUrl){ const r = await mirrorImageToStorage(testRow.id, opt.imgUrl, 'opt'); optImgUrl = r.url; bump(r.mirrored); }
          const { error: optErr } = await supabaseClient.from('options').insert({
            question_id: qRow.id, label: opt.label, image_url: optImgUrl,
            is_correct: opt.correct, order_no: optOrder++
          });
          if(optErr) throw optErr;
        }
      }
    }

    progressWrap.style.display = 'none';
    let report = `<div class="success-msg">Imported "${parsed.name}" with ${totalQuestions} questions across ${parsed.sections.length} sections.`;
    if(doMirror) report += ` Images mirrored to your storage: ${mirroredCt}. Kept original link (source didn't allow mirroring): ${fallbackCt}.`;
    report += `</div>`;
    msgEl.innerHTML = report;
    document.getElementById('bulk-json-input').value = '';
    loadTestsTable();
    loadResultsTestOptions();
  } catch(err){
    console.error(err);
    progressWrap.style.display = 'none';
    msgEl.innerHTML = `<div class="error-msg">Import failed: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
  }
});

// ===================== PASSCODE =====================
async function loadPasscode(){
  const { data, error } = await supabaseClient.from('app_settings').select('signup_passcode').eq('id',1).single();
  if(!error && data) document.getElementById('passcode-input').value = data.signup_passcode;
}
document.getElementById('save-passcode-btn').addEventListener('click', async () => {
  const msgEl = document.getElementById('passcode-msg');
  const val = document.getElementById('passcode-input').value.trim();
  if(!val){ msgEl.innerHTML = `<div class="error-msg">Passcode can't be empty.</div>`; return; }
  const { error } = await supabaseClient.from('app_settings').update({ signup_passcode: val }).eq('id',1);
  msgEl.innerHTML = error ? `<div class="error-msg">${error.message}</div>` : `<div class="success-msg">Passcode updated!</div>`;
});

// ===================== MAINTENANCE MODE =====================
async function loadMaintenanceStatus(){
  const { data, error } = await supabaseClient.from('app_settings').select('maintenance_mode').eq('id',1).single();
  const toggle = document.getElementById('maintenance-toggle');
  if(!error && data){
    toggle.checked = !!data.maintenance_mode;
    updateMaintenanceLabel();
  }
}
function updateMaintenanceLabel(){
  const toggle = document.getElementById('maintenance-toggle');
  const label = document.getElementById('maintenance-status-label');
  if(toggle.checked){
    label.textContent = 'Offline (Maintenance)';
    label.style.color = '#c0292c';
  } else {
    label.textContent = 'Online';
    label.style.color = 'var(--green-dark)';
  }
}
document.getElementById('maintenance-toggle').addEventListener('change', async (e) => {
  const msgEl = document.getElementById('maintenance-msg');
  const isOn = e.target.checked;
  updateMaintenanceLabel();
  const { error } = await supabaseClient.from('app_settings').update({ maintenance_mode: isOn }).eq('id',1);
  if(error){
    msgEl.innerHTML = `<div class="error-msg">${error.message}</div>`;
    e.target.checked = !isOn; // revert on failure
    updateMaintenanceLabel();
  } else {
    msgEl.innerHTML = isOn
      ? `<div class="success-msg">Student portal is now offline. Students will see the maintenance page.</div>`
      : `<div class="success-msg">Student portal is back online.</div>`;
  }
});
// ===================== RESULTS =====================
async function loadResultsTestOptions(){
  const select = document.getElementById('results-test-select');
  const { data: tests, error } = await supabaseClient.from('tests').select('id,name').order('created_at', { ascending:false });
  if(error || !tests || tests.length===0){ select.innerHTML = `<option>No tests yet</option>`; return; }
  select.innerHTML = tests.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  select.addEventListener('change', () => loadResultsTable(select.value));
  loadResultsTable(select.value);
}

let currentResultsData = [];

async function loadResultsTable(testId){
  const tbody = document.getElementById('results-table-body');
  tbody.innerHTML = `<tr><td colspan="10" class="muted">Loading...</td></tr>`;
  const { data, error } = await supabaseClient
    .from('results')
    .select('*, profiles(name, email, role)')
    .eq('test_id', testId)
    .order('submitted_at', { ascending:false });
  if(error){ tbody.innerHTML = `<tr><td colspan="10" class="error-msg">${error.message}</td></tr>`; return; }
  currentResultsData = (data || []).filter(r => r.profiles?.role !== 'admin'); // hide admin's own preview attempts
  if(currentResultsData.length===0){ tbody.innerHTML = `<tr><td colspan="10" class="muted">No attempts yet for this test.</td></tr>`; return; }

  tbody.innerHTML = currentResultsData.map(r => `
    <tr>
      <td>${r.profiles?.name || '—'}</td>
      <td>${r.profiles?.email || '—'}</td>
      <td><b>${r.total_score}</b></td>
      <td style="color:var(--green-dark);">${r.total_correct}</td>
      <td style="color:#c0292c;">${r.total_incorrect}</td>
      <td class="muted">${r.total_unattempted}</td>
      <td class="muted">${Math.round(r.time_taken_ms/60000)}m</td>
      <td style="color:${r.tab_switch_count>0?'#c0292c':'var(--muted)'};font-weight:${r.tab_switch_count>0?'700':'400'};">${r.tab_switch_count ?? 0}</td>
      <td style="color:${r.fullscreen_exit_count>0?'#c0292c':'var(--muted)'};font-weight:${r.fullscreen_exit_count>0?'700':'400'};">${r.fullscreen_exit_count ?? 0}</td>
      <td class="muted">${new Date(r.submitted_at).toLocaleString()}</td>
    </tr>
  `).join('');
}

document.getElementById('export-csv-btn').addEventListener('click', () => {
  if(currentResultsData.length===0){ alert('No results to export.'); return; }
  const header = ['Name','Email','Score','Correct','Incorrect','Unattempted','TimeTakenMin','TabSwitches','FullscreenExits','SubmittedAt'];
  const rows = currentResultsData.map(r => [
    r.profiles?.name || '', r.profiles?.email || '', r.total_score, r.total_correct,
    r.total_incorrect, r.total_unattempted, Math.round(r.time_taken_ms/60000),
    r.tab_switch_count ?? 0, r.fullscreen_exit_count ?? 0,
    new Date(r.submitted_at).toISOString()
  ]);
  const csv = [header, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'results.csv';
  a.click();
});
