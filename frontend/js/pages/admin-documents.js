let docFilter = 'all';
let docUploading = false;

async function renderDocuments() {
  setHeader('Documents', 'Store and manage school documents: images, Excel, Word and PDF files');
  setContent(Utils.loading());
  let docs = [], learners = [];
  try {
    [docs, learners] = await Promise.all([
      DB.query('documents', '*', {}, { column: 'created_at', asc: false }),
      DB.get('learners')
    ]);
  } catch (e) {
    console.error('[Documents] load error:', e);
    return showDocumentsSetupNotice(e);
  }
  const filtered = docFilter === 'all' ? docs
    : docFilter === 'learner' ? docs.filter(d => d.learner_id)
    : docs.filter(d => !d.learner_id);

  const rows = filtered.map(d => {
    const learner = learners.find(l => l.id === d.learner_id);
    const ic = docIcon(d.file_type);
    return `<tr>
      <td class="col-name"><i data-lucide="${ic.icon}" style="width:16px;height:16px;margin-right:6px;color:${ic.color}"></i>${Utils.escapeHtml(d.title)}<br><span class="text-xs text-muted">${Utils.escapeHtml(d.file_name)}</span></td>
      <td><span class="badge badge-neutral">${Utils.escapeHtml(d.category)}</span></td>
      <td>${learner ? `<span class="text-sm font-semibold">${Utils.escapeHtml(learner.full_name)}</span><br><span class="text-xs text-muted">${Utils.escapeHtml(learner.learner_code)}</span>` : '<span class="text-xs text-muted">—</span>'}</td>
      <td class="text-center text-sm">${formatSize(d.file_size)}</td>
      <td class="text-center text-sm">${d.created_at ? Utils.dateStr(d.created_at) : '-'}</td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline" onclick="docDownload('${d.id}')"><i data-lucide="download"></i> Download</button>
        <button class="btn btn-sm btn-danger" onclick="docDelete('${d.id}')" title="Delete document"><i data-lucide="trash-2"></i></button>
      </td></tr>`;
  }).join('');

  setContent(`
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <div>
          <h3><i data-lucide="upload-cloud" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Upload Document</h3>
          <p class="text-sm text-muted mt-1">Images, Excel, Word and PDF files are accepted.</p>
        </div>
      </div>
      <div style="padding:16px">
        <div class="form-row">
          <div class="form-group"><label>Document Title <span class="required">*</span></label>
            <input type="text" id="doc-title" class="input-field" placeholder="e.g. Circular January, Result Slip, Learner Photo"></div>
          <div class="form-group"><label>Category</label>
            <select id="doc-category" class="select-field">
              <option>General</option><option>Learner Record</option><option>Results</option>
              <option>Circular</option><option>Photos</option><option>Other</option>
            </select></div>
          <div class="form-group"><label>Learner (optional)</label>
            <select id="doc-learner" class="select-field"><option value="">— Not attached —</option>
              ${learners.map(l => `<option value="${l.id}">${Utils.escapeHtml(l.full_name)} (${Utils.escapeHtml(l.learner_code)})</option>`).join('')}
            </select></div>
        </div>
        <div class="form-row" style="align-items:flex-end">
          <div class="form-group" style="flex:2;margin-bottom:0">
            <label>Choose Files</label>
            <input type="file" id="doc-file" class="input-field" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.gif">
          </div>
          <button class="btn btn-primary" id="doc-upload-btn" onclick="docUpload()" style="margin-bottom:1px"><i data-lucide="upload"></i> Upload</button>
        </div>
      </div>
    </div>

    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <div class="tab-bar">
        <button class="tab-btn ${docFilter === 'all' ? 'active' : ''}" onclick="docFilter='all';renderDocuments()">All</button>
        <button class="tab-btn ${docFilter === 'learner' ? 'active' : ''}" onclick="docFilter='learner';renderDocuments()">Attached to Learner</button>
        <button class="tab-btn ${docFilter === 'general' ? 'active' : ''}" onclick="docFilter='general';renderDocuments()">General</button>
      </div>
    </div>
    <div class="card"><div class="table-container"><table class="data-table">
      <thead><tr><th>Title</th><th>Category</th><th>Learner</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="text-center">${Utils.empty('No documents uploaded yet', 'folder-open')}</td></tr>`}</tbody></table></div></div>`);
}

function showDocumentsSetupNotice(e) {
  const msg = (e && e.message) || 'Unknown error';
  const specific = /does not exist|PGRST205|42P01/i.test(String(msg));
  setContent(`
    <div class="card" style="margin:10px auto;max-width:640px">
      <div style="padding:28px;text-align:center">
        <div style="width:52px;height:52px;margin:0 auto 14px;border-radius:50%;background:var(--amber-50);color:var(--amber-500);display:flex;align-items:center;justify-content:center"><i data-lucide="folder-open" style="width:24px;height:24px"></i></div>
        <h3 style="margin:0 0 8px">Documents setup required</h3>
        <p class="text-sm text-muted" style="margin:0 0 18px">The Documents module needs a one-time SQL setup in Supabase.</p>
        <div class="alert alert-warning" style="text-align:left;margin-bottom:0"><i data-lucide="info"></i>
          Open your Supabase project &rarr; <strong>SQL Editor</strong> &rarr; New query, then paste and run the contents of<br><strong>backend/sql/migration-documents.sql</strong>.<br>
          ${specific ? '<br>Database says: ' + Utils.escapeHtml(String(msg)) : ''}
        </div>
      </div>
    </div>`);
  lucide.createIcons();
}

function docStorageReady() {
  if (!sbClient.storage || typeof sbClient.storage.from !== 'function') {
    Utils.toast('File storage unavailable — run migration-documents.sql', 'error');
    return false;
  }
  return true;
}

function docIcon(type) {
  const t = String(type || '').toLowerCase();
  if (/image|jpeg|png|webp|gif/.test(t)) return { icon: 'image', color: 'var(--green-600)' };
  if (/sheet|excel|xls/.test(t) || /csv/.test(t)) return { icon: 'file-spreadsheet', color: 'var(--green-600)' };
  if (t.includes('pdf')) return { icon: 'file-text', color: 'var(--red-500)' };
  if (/word|document/.test(t)) return { icon: 'file-text', color: 'var(--blue-600)' };
  return { icon: 'file', color: 'var(--gray-500)' };
}

function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function docUpload() {
  if (!docStorageReady()) return;
  const files = document.getElementById('doc-file').files;
  const title = (document.getElementById('doc-title').value || '').trim();
  if (!files.length) return Utils.toast('Choose at least one file', 'error');
  if (!title && files.length > 1) return Utils.toast('Enter a title when uploading multiple files', 'error');
  const category = document.getElementById('doc-category').value;
  const learnerId = document.getElementById('doc-learner').value || null;
  const btn = document.getElementById('doc-upload-btn');
  if (docUploading) return;
  docUploading = true;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-circle" class="spin"></i> Uploading...';
  if (typeof lucide !== 'undefined') lucide.createIcons();

  const uploads = Array.from(files).map(async (file, i) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const path = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + (i + 1) + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
    const { error } = await sbClient.storage.from('documents').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) throw error;
    await DB.insert('documents', {
      title: title || file.name.replace(/\.[^.]+$/, ''),
      category,
      file_name: file.name,
      file_type: file.type || '',
      file_size: file.size,
      storage_path: path,
      learner_id: learnerId,
      uploaded_by: Auth.currentUser?.id || null,
      uploaded_by_name: Auth.currentUser?.full_name || ''
    });
  });

  Promise.all(uploads).then(() => {
    Utils.toast(files.length + ' document(s) uploaded', 'success');
    resetUploadBtn(btn);
    docUploading = false;
    renderDocuments();
  }).catch(e => {
    Utils.toast('Upload error: ' + e.message, 'error');
    resetUploadBtn(btn);
    docUploading = false;
  });
}

function resetUploadBtn(btn) {
  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="upload"></i> Upload';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function docDownload(id) {
  try {
    const [d] = await DB.getRelated('documents', '*', { id });
    if (!d) return Utils.toast('Document not found', 'error');
    if (!docStorageReady()) return;
    const { data } = sbClient.storage.from('documents').getPublicUrl(d.storage_path);
    const a = document.createElement('a');
    a.href = data.publicUrl;
    a.download = d.file_name;
    a.target = '_blank';
    a.click();
  } catch (e) { Utils.toast('Download error: ' + e.message, 'error'); }
}

function docDelete(id) {
  DB.getRelated('documents', '*', { id }).then(([d]) => {
    if (!d) return Utils.toast('Document not found', 'error');
    Modal.show('Delete Document', `
      <div class="text-center mb-4">
        <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:50%;background:var(--red-50);color:var(--red-500);display:flex;align-items:center;justify-content:center"><i data-lucide="trash-2" style="width:24px;height:24px"></i></div>
        <p style="font-size:15px;color:var(--gray-800)">Delete <strong>${Utils.escapeHtml(d.title)}</strong> permanently?</p>
        <p class="text-sm text-muted">${Utils.escapeHtml(d.file_name)}</p>
      </div>
      <div class="alert alert-danger" style="margin-bottom:0"><i data-lucide="alert-triangle"></i> The stored file will also be removed. This cannot be undone.</div>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-danger" onclick="confirmDocDelete('${id}')"><i data-lucide="trash-2"></i> Delete</button>`, true);
  });
}

async function confirmDocDelete(id) {
  try {
    const [d] = await DB.getRelated('documents', '*', { id });
    if (d) {
      if (!sbClient.storage || typeof sbClient.storage.from !== 'function') {
        await DB.remove('documents', id);
        Modal.close();
        Utils.toast('Document deleted', 'success');
        renderDocuments();
        return;
      }
      const { error: sErr } = await sbClient.storage.from('documents').remove([d.storage_path]);
      if (sErr) throw sErr;
    }
    await DB.remove('documents', id);
    Modal.close();
    Utils.toast('Document deleted', 'success');
    renderDocuments();
  } catch (e) { Utils.toast('Delete error: ' + e.message, 'error'); }
}