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
  loadResourceTestOptions();
  loadResourcesTable();
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
          <button class="btn btn-outline small-btn" data-action="edit" data-id="${t.id}">Edit</button>
          <button class="btn btn-outline small-btn" data-action="toggle" data-id="${t.id}" data-active="${t.is_active}">${t.is_active?'Deactivate':'Activate'}</button>
          <button class="btn btn-danger small-btn" data-action="delete" data-id="${t.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('button[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => editTest(btn.dataset.id));
  });
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
      loadResourceTestOptions();
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
    loadResourceTestOptions();
  } catch(err){
    console.error(err);
    progressWrap.style.display = 'none';
    msgEl.innerHTML = `<div class="error-msg">Failed: ${err.message}</div>`;
  } finally {
    createBtn.disabled = false;
  }
}

// ===================== BULK IMPORT (paste JSON) =====================
function extractAllImgSrcs(html){
  if(!html) return [];
  return [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
}
// Extracts a plain-text fallback from HTML (strips tags/&nbsp;), used when there's no <img>.
function extractPlainText(html){
  if(!html) return null;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}
function extractQuestionContent(html){
  const imgUrls = extractAllImgSrcs(html);
  return { imgUrls, text: imgUrls.length ? null : extractPlainText(html) };
}
// For options: if there's an image use it. Otherwise, if the raw text is more than just a bare
// letter (A/B/C/D) — meaning the option itself carries the real answer content — keep it as text.
// If it's just the bare letter (normal for image-based questions), there's nothing extra to show.
function extractOptionContent(html){
  const imgUrls = extractAllImgSrcs(html);
  if(imgUrls.length) return { imgUrls, text: null };
  const text = extractPlainText(html);
  if(text && /^[A-D]$/i.test(text)) return { imgUrls: [], text: null };
  return { imgUrls: [], text };
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
      const qContent = extractQuestionContent(q.name);
      const solContent = extractQuestionContent(q.solution);
      return {
        imgUrls: qContent.imgUrls,
        text: qContent.text,
        solImgUrls: solContent.imgUrls,
        solText: solContent.text,
        pos, neg,
        options: (q.options || []).map((o, idx) => {
          const optContent = extractOptionContent(o.name);
          return {
            label: String.fromCharCode(65 + idx), // always positional A/B/C/D
            imgUrls: optContent.imgUrls,
            text: optContent.text,
            correct: !!o.isCorrect
          };
        })
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

// Some questions have MULTIPLE <img> tags (e.g. a diagram + a data table as two images).
// Since each question/option only has one image_url column, we stitch all images for that
// question vertically into a single combined PNG, so both parts show together as intended.
function stitchImagesVertically(blobs){
  return Promise.all(blobs.map(b => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(b);
  }))).then(imgs => {
    const gap = 14;
    const width = Math.max(...imgs.map(i => i.naturalWidth));
    const totalHeight = imgs.reduce((sum, i) => sum + i.naturalHeight, 0) + gap * (imgs.length - 1);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, totalHeight);
    let y = 0;
    for(const img of imgs){
      const x = Math.round((width - img.naturalWidth) / 2);
      ctx.drawImage(img, x, y);
      y += img.naturalHeight + gap;
    }
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  });
}

async function mirrorMultiImagesStacked(testId, urls, tag){
  if(!urls || !urls.length) return { url: null, mirrored: false };
  if(urls.length === 1) return mirrorImageToStorage(testId, urls[0], tag);
  try {
    const blobs = [];
    for(const u of urls){
      const resp = await fetch(u);
      if(!resp.ok) throw new Error('fetch failed: ' + resp.status);
      blobs.push(await resp.blob());
    }
    const stitched = await stitchImagesVertically(blobs);
    const path = `${testId}/${tag}_${uid()}.png`;
    const { error } = await supabaseClient.storage.from('test-images')
      .upload(path, stitched, { contentType: 'image/png' });
    if(error) throw error;
    const { data } = supabaseClient.storage.from('test-images').getPublicUrl(path);
    return { url: data.publicUrl, mirrored: true };
  } catch(err){
    // stitching failed (e.g. one URL blocked) — fall back to just the first image so the
    // question isn't left completely blank
    return mirrorImageToStorage(testId, urls[0], tag);
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
    if(q.imgUrls.length) totalImages++; // stitched as one upload regardless of count
    if(q.solImgUrls.length) totalImages++;
    q.options.forEach(o=>{ if(o.imgUrls.length) totalImages++; });
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
        let qImgUrl = null, solImgUrl = null;
        if(doMirror){
          if(q.imgUrls.length){ const r = await mirrorMultiImagesStacked(testRow.id, q.imgUrls, 'q'); qImgUrl = r.url; bump(r.mirrored); }
          if(q.solImgUrls.length){ const r = await mirrorMultiImagesStacked(testRow.id, q.solImgUrls, 'sol'); solImgUrl = r.url; bump(r.mirrored); }
        } else {
          qImgUrl = q.imgUrls[0] || null;
          solImgUrl = q.solImgUrls[0] || null;
        }

        const { data: qRow, error: qErr } = await supabaseClient.from('questions').insert({
          section_id: secRow.id, image_url: qImgUrl, text_content: q.text, order_no: qOrder++,
          positive_marks: q.pos, negative_marks: q.neg, solution_image_url: solImgUrl, solution_text: q.solText
        }).select().single();
        if(qErr) throw qErr;

        let optOrder = 1;
        for(const opt of q.options){
          let optImgUrl = opt.imgUrls[0] || null;
          if(doMirror && opt.imgUrls.length){ const r = await mirrorMultiImagesStacked(testRow.id, opt.imgUrls, 'opt'); optImgUrl = r.url; bump(r.mirrored); }
          const { error: optErr } = await supabaseClient.from('options').insert({
            question_id: qRow.id, label: opt.label, image_url: optImgUrl, text_content: opt.text,
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
    loadResourceTestOptions();
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

// ===================== STUDY MATERIAL (PDFs) =====================
async function loadResourceTestOptions(){
  const select = document.getElementById('resource-test-select');
  if(!select) return;
  const { data: tests } = await supabaseClient.from('tests').select('id,name').order('created_at', { ascending:false });
  select.innerHTML = '<option value="">General (shown to everyone)</option>' +
    (tests || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

async function loadResourcesTable(){
  const tbody = document.getElementById('resources-table-body');
  if(!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="muted">Loading...</td></tr>`;
  const { data, error } = await supabaseClient
    .from('resources')
    .select('*, tests(name)')
    .order('created_at', { ascending:false });
  if(error){ tbody.innerHTML = `<tr><td colspan="5" class="error-msg">${error.message}</td></tr>`; return; }
  if(!data || data.length===0){ tbody.innerHTML = `<tr><td colspan="5" class="muted">No PDFs added yet.</td></tr>`; return; }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td><b>${r.title}</b></td>
      <td class="muted">${r.tests?.name || 'General'}</td>
      <td><a href="${r.url}" target="_blank" style="font-size:12px;">${r.url.length>40 ? r.url.slice(0,40)+'…' : r.url}</a></td>
      <td class="muted">${new Date(r.created_at).toLocaleDateString()}</td>
      <td><button class="btn btn-danger small-btn" data-id="${r.id}">Delete</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Delete this PDF link?')) return;
      await supabaseClient.from('resources').delete().eq('id', btn.dataset.id);
      loadResourcesTable();
    });
  });
}

document.getElementById('add-resource-btn').addEventListener('click', async () => {
  const msgEl = document.getElementById('resource-msg');
  msgEl.innerHTML = '';
  const title = document.getElementById('resource-title').value.trim();
  const url = document.getElementById('resource-url').value.trim();
  const testId = document.getElementById('resource-test-select').value || null;

  if(!title || !url){ msgEl.innerHTML = `<div class="error-msg">Title and link are both required.</div>`; return; }
  try { new URL(url); } catch { msgEl.innerHTML = `<div class="error-msg">That doesn't look like a valid URL.</div>`; return; }

  const btn = document.getElementById('add-resource-btn');
  btn.disabled = true;
  const { error } = await supabaseClient.from('resources').insert({
    title, url, test_id: testId, created_by: adminProfile.id
  });
  btn.disabled = false;

  if(error){ msgEl.innerHTML = `<div class="error-msg">${error.message}</div>`; return; }
  msgEl.innerHTML = `<div class="success-msg">PDF added!</div>`;
  document.getElementById('resource-title').value = '';
  document.getElementById('resource-url').value = '';
  loadResourcesTable();
});

// ===================== EDIT TEST (fix images/text/marks/answer without recreating) =====================
let editState = { testId:null, sections:[], activeSectionIdx:0, solutionsReleased:false };

async function editTest(testId){
  document.querySelector('.tab-btn[data-tab="edit"]').click();
  document.getElementById('edit-empty-state').style.display = 'none';
  document.getElementById('edit-test-wrap').style.display = 'block';
  document.getElementById('edit-questions-list').innerHTML = '<p class="muted">Loading...</p>';

  const { data: test } = await supabaseClient.from('tests').select('*').eq('id', testId).single();
  document.getElementById('edit-test-name').value = test.name;
  document.getElementById('edit-max-attempts').value = test.max_attempts || '';

  const { data: sections } = await supabaseClient.from('sections').select('*').eq('test_id', testId).order('order_no');
  for(const sec of sections){
    const { data: questions } = await supabaseClient.from('questions').select('*, options(*)').eq('section_id', sec.id).order('order_no');
    questions.forEach(q => q.options.sort((a,b)=>a.order_no-b.order_no));
    sec.questions = questions;
  }
  editState = { testId, sections, activeSectionIdx: 0, solutionsReleased: test.solutions_released };
  renderSolutionsToggleBtn();
  renderEditSectionTabs();
  renderEditQuestions();
}

function renderSolutionsToggleBtn(){
  const btn = document.getElementById('edit-solutions-toggle-btn');
  if(editState.solutionsReleased){
    btn.textContent = '🔓 Released — click to hide again';
    btn.className = 'btn btn-block btn-outline';
  } else {
    btn.textContent = '🔒 Release Solutions to Students';
    btn.className = 'btn btn-block btn-primary';
  }
}

document.getElementById('edit-max-attempts').addEventListener('change', async () => {
  const val = document.getElementById('edit-max-attempts').value.trim();
  const max_attempts = val ? parseInt(val) : null;
  const msg = document.getElementById('edit-settings-msg');
  const { error } = await supabaseClient.from('tests').update({ max_attempts }).eq('id', editState.testId);
  msg.innerHTML = error ? `<div class="error-msg">${error.message}</div>` : '<div class="success-msg">Attempt limit saved.</div>';
});

document.getElementById('edit-solutions-toggle-btn').addEventListener('click', async () => {
  const newVal = !editState.solutionsReleased;
  const { error } = await supabaseClient.from('tests').update({ solutions_released: newVal }).eq('id', editState.testId);
  const msg = document.getElementById('edit-settings-msg');
  if(error){ msg.innerHTML = `<div class="error-msg">${error.message}</div>`; return; }
  editState.solutionsReleased = newVal;
  renderSolutionsToggleBtn();
  msg.innerHTML = '<div class="success-msg">Saved.</div>';
});

document.getElementById('edit-save-name-btn').addEventListener('click', async () => {
  const msg = document.getElementById('edit-name-msg');
  const name = document.getElementById('edit-test-name').value.trim();
  if(!name){ msg.innerHTML = '<div class="error-msg">Name can\'t be empty.</div>'; return; }
  const { error } = await supabaseClient.from('tests').update({ name }).eq('id', editState.testId);
  msg.innerHTML = error ? `<div class="error-msg">${error.message}</div>` : '<div class="success-msg">Saved.</div>';
  loadTestsTable();
});

function renderEditSectionTabs(){
  const wrap = document.getElementById('edit-section-tabs');
  wrap.innerHTML = editState.sections.map((s,i) =>
    `<button class="tab-btn ${i===editState.activeSectionIdx?'active':''}" data-sec-idx="${i}">${s.name} (${s.questions.length})</button>`
  ).join('');
  wrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      editState.activeSectionIdx = parseInt(btn.dataset.secIdx);
      renderEditSectionTabs();
      renderEditQuestions();
    });
  });
}

function renderEditQuestions(){
  const listEl = document.getElementById('edit-questions-list');
  const sec = editState.sections[editState.activeSectionIdx];
  if(!sec || !sec.questions.length){ listEl.innerHTML = '<p class="muted">No questions in this section.</p>'; return; }

  listEl.innerHTML = sec.questions.map(q => `
    <div class="card mt-16" data-qid="${q.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <b>Question ${q.order_no}</b>
        <div style="display:flex;gap:8px;align-items:center;">
          <label style="margin:0;">+<input type="number" step="0.5" class="q-pos" value="${q.positive_marks}" style="width:60px;display:inline-block;"></label>
          <label style="margin:0;">-<input type="number" step="0.5" class="q-neg" value="${q.negative_marks}" style="width:60px;display:inline-block;"></label>
          <button class="btn btn-danger btn-sm" data-del-q="${q.id}">Delete Q</button>
        </div>
      </div>

      <div class="mt-16">
        <label>Question Image ${q.image_url ? '' : '<span class="badge badge-gray">none</span>'}</label>
        ${q.image_url ? `<img src="${q.image_url}" style="max-width:280px;border:1px solid var(--border);border-radius:8px;" class="q-img-preview">` : ''}
        <input type="file" accept="image/*" class="q-img-file mt-8">
        <div class="muted" style="font-size:12px;">Uploading replaces the image immediately.</div>
      </div>

      <div class="field mt-16">
        <label>Fallback / plain text (shown if there's no image, or as backup)</label>
        <textarea class="q-text" rows="3">${q.text_content || ''}</textarea>
      </div>

      <div class="field mt-16">
        <label>Solution text (optional, shown in result if no solution image)</label>
        <textarea class="q-soltext" rows="2">${q.solution_text || ''}</textarea>
      </div>

      <div class="mt-16">
        <label>Options</label>
        ${q.options.map(o => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:8px;" data-oid="${o.id}">
            <input type="radio" name="correct-${q.id}" class="o-correct" value="${o.id}" ${o.is_correct?'checked':''}>
            <input type="text" class="o-label" value="${o.label}" style="width:50px;">
            <input type="text" class="o-text" value="${o.text_content || ''}" placeholder="option text (optional)" style="flex:1;">
            ${o.image_url ? `<img src="${o.image_url}" style="height:36px;border-radius:4px;">` : ''}
            <input type="file" accept="image/*" class="o-img-file" style="width:140px;">
          </div>
        `).join('')}
      </div>

      <button class="btn btn-primary btn-block mt-16 save-q-btn" data-qid="${q.id}">Save Question</button>
      <div class="save-q-msg mt-8"></div>
    </div>
  `).join('');

  // delete question
  listEl.querySelectorAll('[data-del-q]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Delete this question permanently?')) return;
      await supabaseClient.from('questions').delete().eq('id', btn.dataset.delQ);
      const sec2 = editState.sections[editState.activeSectionIdx];
      sec2.questions = sec2.questions.filter(q => q.id !== btn.dataset.delQ);
      renderEditSectionTabs();
      renderEditQuestions();
    });
  });

  // instant image replace - question
  listEl.querySelectorAll('.q-img-file').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files[0]; if(!file) return;
      const qid = input.closest('[data-qid]').dataset.qid;
      input.disabled = true;
      try{
        const url = await uploadImage(editState.testId, file, 'q');
        await supabaseClient.from('questions').update({ image_url: url }).eq('id', qid);
        const sec2 = editState.sections[editState.activeSectionIdx];
        const q2 = sec2.questions.find(q=>q.id===qid);
        q2.image_url = url;
        renderEditQuestions();
      }catch(e){ alert(e.message); input.disabled = false; }
    });
  });

  // instant image replace - option
  listEl.querySelectorAll('.o-img-file').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files[0]; if(!file) return;
      const oid = input.closest('[data-oid]').dataset.oid;
      input.disabled = true;
      try{
        const url = await uploadImage(editState.testId, file, 'opt');
        await supabaseClient.from('options').update({ image_url: url }).eq('id', oid);
        const sec2 = editState.sections[editState.activeSectionIdx];
        for(const q2 of sec2.questions){
          const o2 = q2.options.find(o=>o.id===oid);
          if(o2){ o2.image_url = url; break; }
        }
        renderEditQuestions();
      }catch(e){ alert(e.message); input.disabled = false; }
    });
  });

  // save question (text, marks, solution text, option labels/text/correct)
  listEl.querySelectorAll('.save-q-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-qid]');
      const qid = btn.dataset.qid;
      const msg = card.querySelector('.save-q-msg');
      btn.disabled = true;
      try{
        const { error: qErr } = await supabaseClient.from('questions').update({
          text_content: card.querySelector('.q-text').value.trim() || null,
          solution_text: card.querySelector('.q-soltext').value.trim() || null,
          positive_marks: parseFloat(card.querySelector('.q-pos').value) || 0,
          negative_marks: parseFloat(card.querySelector('.q-neg').value) || 0
        }).eq('id', qid);
        if(qErr) throw qErr;

        const correctId = card.querySelector('.o-correct:checked')?.value;
        for(const optRow of card.querySelectorAll('[data-oid]')){
          const oid = optRow.dataset.oid;
          const { error: oErr } = await supabaseClient.from('options').update({
            label: optRow.querySelector('.o-label').value.trim(),
            text_content: optRow.querySelector('.o-text').value.trim() || null,
            is_correct: oid === correctId
          }).eq('id', oid);
          if(oErr) throw oErr;
        }
        msg.innerHTML = '<div class="success-msg">Saved.</div>';
      }catch(e){
        msg.innerHTML = `<div class="error-msg">${e.message}</div>`;
      }
      btn.disabled = false;
    });
  });
}
