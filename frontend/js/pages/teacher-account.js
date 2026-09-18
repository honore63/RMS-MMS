/* ============================================================
   TEACHER ACCOUNT SETTINGS
   Sections: My Profile | Security & Login | Teacher Code
   ============================================================ */

let _accountTab = 'profile';

async function renderTeacherAccount() {
  setHeader('My Account', 'Manage your personal information and security settings');
  setContent(Utils.loading());

  let teacherId = Auth.getTeacherId();
  let teacher = null;

  if (teacherId) {
    const res = await DB.query('teachers', '*', { id: teacherId });
    teacher = res[0];
  }

  if (!teacher && Auth.currentUser?.id) {
    const res = await DB.query('teachers', '*', { user_id: Auth.currentUser.id });
    teacher = res[0];
  }

  if (!teacher && Auth.currentUser?.email) {
    const res = await DB.query('teachers', '*', { email: Auth.currentUser.email });
    teacher = res[0];
  }

  if (!teacher) {
    setContent(Utils.errorCard('No Teacher Profile', 'Your account is not linked to an active teacher record. Please contact the DOS.'));
    return;
  }

  window._currentTeacherProfile = teacher;
  _renderAccountShell(teacher);
}

function _renderAccountShell(teacher) {
  const avatarUrl = teacher.profile_photo_url
    ? `<img src="${Utils.escapeHtml(teacher.profile_photo_url)}" alt="Profile Photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<i data-lucide="user-circle" style="width:64px;height:64px;color:var(--gray-400)"></i>`;

  setContent(`
    <div style="display:grid;grid-template-columns:240px 1fr;gap:24px;align-items:start" class="account-layout">

      <!-- Sidebar nav -->
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:24px;text-align:center;background:linear-gradient(135deg,var(--blue-900),var(--blue-700));color:white">
          <div style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;overflow:hidden;border:3px solid rgba(255,255,255,.3)">
            ${avatarUrl}
          </div>
          <div style="font-weight:600;font-size:15px">${Utils.escapeHtml(teacher.full_name || '')}</div>
          <div style="font-size:12px;opacity:.8;margin-top:4px">${Utils.escapeHtml(teacher.teacher_code || '')}</div>
          <div style="margin-top:8px">
            <span class="badge" style="background:rgba(255,255,255,.2);color:white;font-size:11px">
              <i data-lucide="shield-check" style="width:12px;height:12px"></i> Active Teacher
            </span>
          </div>
        </div>
        <nav style="padding:8px">
          <button class="account-nav-btn ${_accountTab === 'profile' ? 'active' : ''}" onclick="switchAccountTab('profile')" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 14px;border:none;background:${_accountTab==='profile'?'var(--blue-50)':'transparent'};color:${_accountTab==='profile'?'var(--blue-700)':'var(--gray-700)'};border-radius:var(--radius);cursor:pointer;font-weight:${_accountTab==='profile'?'600':'400'};text-align:left;transition:all .15s">
            <i data-lucide="user" style="width:16px;height:16px;flex-shrink:0"></i> Personal Information
          </button>
          <button class="account-nav-btn ${_accountTab === 'security' ? 'active' : ''}" onclick="switchAccountTab('security')" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 14px;border:none;background:${_accountTab==='security'?'var(--blue-50)':'transparent'};color:${_accountTab==='security'?'var(--blue-700)':'var(--gray-700)'};border-radius:var(--radius);cursor:pointer;font-weight:${_accountTab==='security'?'600':'400'};text-align:left;transition:all .15s">
            <i data-lucide="lock" style="width:16px;height:16px;flex-shrink:0"></i> Security & Login
          </button>
          <button class="account-nav-btn ${_accountTab === 'photo' ? 'active' : ''}" onclick="switchAccountTab('photo')" style="width:100%;display:flex;align-items:center;gap:10px;padding:10px 14px;border:none;background:${_accountTab==='photo'?'var(--blue-50)':'transparent'};color:${_accountTab==='photo'?'var(--blue-700)':'var(--gray-700)'};border-radius:var(--radius);cursor:pointer;font-weight:${_accountTab==='photo'?'600':'400'};text-align:left;transition:all .15s">
            <i data-lucide="camera" style="width:16px;height:16px;flex-shrink:0"></i> Profile Photo
          </button>
        </nav>
        <div style="padding:12px 16px;border-top:1px solid var(--gray-100)">
          <button class="btn btn-danger btn-sm" style="width:100%" onclick="App.logout()">
            <i data-lucide="log-out"></i> Sign Out
          </button>
        </div>
      </div>

      <!-- Main content panel -->
      <div id="account-panel">
        ${_accountTab === 'profile' ? _profileTabHtml(teacher) : _accountTab === 'security' ? _securityTabHtml(teacher) : _photoTabHtml(teacher)}
      </div>
    </div>`);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function switchAccountTab(tab) {
  _accountTab = tab;
  const teacher = window._currentTeacherProfile;
  if (teacher) _renderAccountShell(teacher);
}

/* ---- PROFILE TAB ---- */
function _profileTabHtml(t) {
  return `
    <div class="card">
      <div class="card-header">
        <div>
          <h3><i data-lucide="user" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Personal Information</h3>
          <p class="card-subtitle">Update your personal contact details. Administrative data (class, subject, code) can only be changed by the DOS.</p>
        </div>
      </div>
      <div style="padding:24px">
        <div class="form-row">
          <div class="form-group">
            <label>Full Name <span class="required">*</span></label>
            <input id="acc-name" class="input-field" value="${Utils.escapeHtml(t.full_name || '')}" placeholder="Your full name">
          </div>
          <div class="form-group">
            <label>Gender</label>
            <select id="acc-gender" class="select-field">
              <option value="">Prefer not to say</option>
              <option value="M" ${t.gender === 'M' ? 'selected' : ''}>Male</option>
              <option value="F" ${t.gender === 'F' ? 'selected' : ''}>Female</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Date of Birth</label>
            <input id="acc-dob" type="date" class="input-field" value="${Utils.escapeHtml(t.date_of_birth || '')}">
          </div>
          <div class="form-group">
            <label>Phone Number</label>
            <input id="acc-phone" class="input-field" value="${Utils.escapeHtml(t.phone || '')}" placeholder="+250 7XX XXX XXX">
          </div>
        </div>
        <div class="form-group">
          <label>Address</label>
          <input id="acc-address" class="input-field" value="${Utils.escapeHtml(t.address || '')}" placeholder="Province, District, Sector">
        </div>

        <div class="alert alert-warning" style="margin-top:12px;margin-bottom:16px">
          <i data-lucide="info"></i>
          <div>
            <strong>Read-Only Fields (DOS Managed)</strong><br>
            <span class="text-sm">Teacher Code, Email, Role, Assigned Classes, and Account Status can only be changed by the Director of Studies.</span>
          </div>
        </div>

        <div class="form-row" style="background:var(--gray-50);padding:16px;border-radius:var(--radius);border:1px solid var(--gray-200);margin-bottom:4px">
          <div class="form-group">
            <label style="color:var(--gray-500)">Teacher Code (Read-Only)</label>
            <div style="display:flex;align-items:center;gap:10px">
              <input class="input-field" value="${Utils.escapeHtml(t.teacher_code || '—')}" readonly style="background:var(--gray-100);color:var(--gray-500);cursor:not-allowed;font-family:monospace;letter-spacing:2px;font-size:16px">
              <span class="badge badge-info" style="white-space:nowrap"><i data-lucide="shield-check"></i> Verified</span>
            </div>
            <p class="form-hint">Your official 11-digit identification code. Contact the DOS to update.</p>
          </div>
          <div class="form-group">
            <label style="color:var(--gray-500)">Email (via Security Tab)</label>
            <input class="input-field" value="${Utils.escapeHtml(t.email || Auth.currentUser?.email || '')}" readonly style="background:var(--gray-100);color:var(--gray-500);cursor:not-allowed">
            <p class="form-hint">Use Security & Login to change your email address.</p>
          </div>
        </div>

        <div style="margin-top:20px;display:flex;justify-content:flex-end">
          <button class="btn btn-primary" onclick="saveTeacherProfile('${t.id}')">
            <i data-lucide="save"></i> Save Changes
          </button>
        </div>
      </div>
    </div>`;
}

/* ---- SECURITY TAB ---- */
function _securityTabHtml(t) {
  return `
    <div class="flex flex-col gap-4">
      <!-- Change Password -->
      <div class="card">
        <div class="card-header">
          <h3><i data-lucide="key-round" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Change Password</h3>
        </div>
        <div style="padding:24px">
          <div class="form-group">
            <label>Current Password <span class="required">*</span></label>
            <input id="sec-cur-pass" type="password" class="input-field" placeholder="Enter your current password" autocomplete="current-password">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>New Password <span class="required">*</span></label>
              <input id="sec-new-pass" type="password" class="input-field" placeholder="At least 8 characters" autocomplete="new-password">
            </div>
            <div class="form-group">
              <label>Confirm New Password <span class="required">*</span></label>
              <input id="sec-confirm-pass" type="password" class="input-field" placeholder="Repeat new password" autocomplete="new-password">
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-primary" onclick="changeTeacherPassword(this)">
              <i data-lucide="lock"></i> Update Password
            </button>
          </div>
        </div>
      </div>

      <!-- Change Email -->
      <div class="card">
        <div class="card-header">
          <h3><i data-lucide="mail" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Change Email Address</h3>
        </div>
        <div style="padding:24px">
          <p class="text-sm text-muted" style="margin-bottom:16px">Your current email: <strong>${Utils.escapeHtml(t.email || Auth.currentUser?.email || '—')}</strong></p>
          <div class="form-group">
            <label>New Email Address <span class="required">*</span></label>
            <input id="sec-new-email" type="email" class="input-field" placeholder="new@school.edu">
          </div>
          <div class="form-group">
            <label>Current Password (required for verification) <span class="required">*</span></label>
            <input id="sec-email-pass" type="password" class="input-field" placeholder="Enter your current password">
          </div>
          <div class="alert alert-warning" style="margin-bottom:16px">
            <i data-lucide="alert-triangle"></i>
            <span class="text-sm">After updating, you will receive a confirmation email to your new address. You'll need to confirm it before signing in again.</span>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-primary" onclick="changeTeacherEmail('${t.id}', this)">
              <i data-lucide="send"></i> Update Email
            </button>
          </div>
        </div>
      </div>

      <!-- Change Phone -->
      <div class="card">
        <div class="card-header">
          <h3><i data-lucide="phone" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Update Phone Number</h3>
        </div>
        <div style="padding:24px">
          <div class="form-group">
            <label>Phone Number</label>
            <input id="sec-phone" class="input-field" value="${Utils.escapeHtml(t.phone || '')}" placeholder="+250 7XX XXX XXX">
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-primary" onclick="changeTeacherPhone('${t.id}', this)">
              <i data-lucide="save"></i> Save Phone
            </button>
          </div>
        </div>
      </div>

      <!-- Teacher Code display only -->
      <div class="card">
        <div class="card-header">
          <h3><i data-lucide="badge" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--green-600)"></i>Teacher Code</h3>
        </div>
        <div style="padding:24px">
          <div style="display:flex;align-items:center;gap:16px;background:var(--gray-50);border:2px dashed var(--gray-300);border-radius:var(--radius);padding:20px">
            <i data-lucide="fingerprint" style="width:40px;height:40px;color:var(--blue-600);flex-shrink:0"></i>
            <div>
              <div style="font-size:26px;font-weight:800;font-family:monospace;letter-spacing:4px;color:var(--blue-900)">${Utils.escapeHtml(t.teacher_code || '—')}</div>
              <div style="font-size:12px;color:var(--gray-500);margin-top:4px">Your official 11-digit identification code used for login and records.</div>
              <span class="badge badge-info" style="margin-top:6px"><i data-lucide="shield-check"></i> Verified · Read-Only</span>
            </div>
          </div>
          <p class="form-hint" style="margin-top:10px">Only the Director of Studies can update your official teacher code. Contact them if there is an error.</p>
        </div>
      </div>
    </div>`;
}

/* ---- PHOTO TAB ---- */
function _photoTabHtml(t) {
  const current = t.profile_photo_url
    ? `<img id="photo-preview" src="${Utils.escapeHtml(t.profile_photo_url)}" alt="Profile Photo" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:4px solid var(--blue-200)">`
    : `<div id="photo-preview" style="width:120px;height:120px;border-radius:50%;background:var(--gray-100);display:flex;align-items:center;justify-content:center;border:4px dashed var(--gray-300)"><i data-lucide="user" style="width:48px;height:48px;color:var(--gray-400)"></i></div>`;

  return `
    <div class="card">
      <div class="card-header">
        <h3><i data-lucide="camera" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Profile Photo</h3>
      </div>
      <div style="padding:24px">
        <div style="display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center">
          ${current}
          <div>
            <p class="text-sm text-muted">Accepted: JPG, PNG, WEBP · Max size: 2 MB</p>
          </div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center">
            <label class="btn btn-primary" style="cursor:pointer">
              <i data-lucide="upload"></i> Choose Photo
              <input type="file" id="photo-file-input" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="previewPhoto(event)">
            </label>
            ${t.profile_photo_url ? `<button class="btn btn-danger btn-sm" onclick="removePhoto('${t.id}')"><i data-lucide="trash-2"></i> Remove</button>` : ''}
          </div>
          <div id="photo-status" style="display:none"></div>
          <button class="btn btn-primary" id="photo-save-btn" style="display:none" onclick="uploadPhoto('${t.id}', this)">
            <i data-lucide="save"></i> Save Photo
          </button>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   ACTIONS
   ============================================================ */

async function saveTeacherProfile(teacherId) {
  const full_name = document.getElementById('acc-name')?.value?.trim();
  const gender = document.getElementById('acc-gender')?.value;
  const date_of_birth = document.getElementById('acc-dob')?.value || null;
  const phone = document.getElementById('acc-phone')?.value?.trim();
  const address = document.getElementById('acc-address')?.value?.trim();

  if (!full_name) return Utils.toast('Full name is required', 'error');

  try {
    await DB.update('teachers', teacherId, { full_name, gender: gender || null, date_of_birth, phone, address });
    // Also update users table so sidebar shows correct name
    if (Auth.currentUser?.id) {
      await sbClient.from('users').update({ full_name, phone }).eq('id', Auth.currentUser.id);
      if (Auth.currentUser) Auth.currentUser.full_name = full_name;
    }
    Utils.toast('Profile updated successfully', 'success');
    await renderTeacherAccount();
    if (typeof Sidebar !== 'undefined' && typeof Sidebar.render === 'function') {
      Sidebar.render('teacher');
      if (typeof Sidebar.highlight === 'function') Sidebar.highlight();
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  } catch (e) {
    Utils.toast('Update error: ' + e.message, 'error');
  }
}

async function changeTeacherPassword(btn) {
  const curPass = document.getElementById('sec-cur-pass')?.value;
  const newPass = document.getElementById('sec-new-pass')?.value;
  const confirmPass = document.getElementById('sec-confirm-pass')?.value;

  if (!curPass || !newPass || !confirmPass) return Utils.toast('Fill all password fields', 'error');
  if (newPass.length < 8) return Utils.toast('New password must be at least 8 characters', 'error');
  if (newPass !== confirmPass) return Utils.toast('New passwords do not match', 'error');

  if (btn) { btn.disabled = true; btn.innerHTML = 'Updating...'; }
  try {
    // Re-authenticate then update
    const email = Auth.currentUser?.email;
    if (!email) throw new Error('Cannot resolve your email. Please re-sign in.');

    const { error: signInErr } = await sbClient.auth.signInWithPassword({ email, password: curPass });
    if (signInErr) throw new Error('Current password is incorrect.');

    const { error } = await sbClient.auth.updateUser({ password: newPass });
    if (error) throw error;

    document.getElementById('sec-cur-pass').value = '';
    document.getElementById('sec-new-pass').value = '';
    document.getElementById('sec-confirm-pass').value = '';
    Utils.toast('Password updated successfully', 'success');
  } catch (e) {
    Utils.toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="lock"></i> Update Password'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }
}

async function changeTeacherEmail(teacherId, btn) {
  const newEmail = document.getElementById('sec-new-email')?.value?.trim();
  const curPass = document.getElementById('sec-email-pass')?.value;

  if (!newEmail || !curPass) return Utils.toast('Enter new email and current password', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return Utils.toast('Enter a valid email address', 'error');

  if (btn) { btn.disabled = true; btn.innerHTML = 'Updating...'; }
  try {
    const oldEmail = Auth.currentUser?.email;
    const { error: signInErr } = await sbClient.auth.signInWithPassword({ email: oldEmail, password: curPass });
    if (signInErr) throw new Error('Current password is incorrect.');

    const { error } = await sbClient.auth.updateUser({ email: newEmail });
    if (error) throw error;

    // Sync in teachers and users tables
    await sbClient.from('teachers').update({ email: newEmail }).eq('id', teacherId);
    await sbClient.from('users').update({ email: newEmail }).eq('id', Auth.currentUser.id);

    Utils.toast('Email update requested. Check your new inbox for a confirmation link.', 'success');
    document.getElementById('sec-new-email').value = '';
    document.getElementById('sec-email-pass').value = '';
    await renderTeacherAccount();
  } catch (e) {
    Utils.toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="send"></i> Update Email'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }
}

async function changeTeacherPhone(teacherId, btn) {
  const phone = document.getElementById('sec-phone')?.value?.trim();
  if (btn) { btn.disabled = true; btn.innerHTML = 'Saving...'; }
  try {
    await DB.update('teachers', teacherId, { phone });
    await sbClient.from('users').update({ phone }).eq('id', Auth.currentUser.id);
    if (Auth.currentUser) Auth.currentUser.phone = phone;
    Utils.toast('Phone number updated', 'success');
    await renderTeacherAccount();
  } catch (e) {
    Utils.toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Save Phone'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }
}

/* ---- PHOTO ---- */
function previewPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return Utils.toast('Only JPG, PNG, or WEBP images are allowed', 'error');
  }
  if (file.size > 2 * 1024 * 1024) {
    return Utils.toast('Image must be under 2 MB', 'error');
  }
  const reader = new FileReader();
  reader.onload = ev => {
    const preview = document.getElementById('photo-preview');
    if (preview) {
      preview.outerHTML = `<img id="photo-preview" src="${ev.target.result}" alt="Preview" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:4px solid var(--blue-200)">`;
    }
    const saveBtn = document.getElementById('photo-save-btn');
    if (saveBtn) saveBtn.style.display = '';
  };
  reader.readAsDataURL(file);
}

async function uploadPhoto(teacherId, btn) {
  const input = document.getElementById('photo-file-input');
  const file = input?.files[0];
  if (!file) return Utils.toast('No photo selected', 'error');

  if (btn) { btn.disabled = true; btn.innerHTML = 'Uploading...'; }

  try {
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `teacher-photos/${teacherId}.${ext}`;
    const { error: upErr } = await sbClient.storage.from('profile-photos').upload(path, file, { 
      upsert: true,
      contentType: file.type
    });
    
    if (upErr) {
      if (upErr.message?.includes('not found') || upErr.statusCode === '404' || upErr.error === 'Bucket not found') {
        throw new Error('Storage bucket "profile-photos" does not exist in Supabase yet. Please create it under Supabase Dashboard -> Storage -> New Bucket (Public: true).');
      }
      throw upErr;
    }

    const { data: urlData } = sbClient.storage.from('profile-photos').getPublicUrl(path);
    const publicUrl = urlData?.publicUrl;

    await DB.update('teachers', teacherId, { profile_photo_url: publicUrl });
    Utils.toast('Profile photo updated!', 'success');

    const saveBtn = document.getElementById('photo-save-btn');
    if (saveBtn) saveBtn.style.display = 'none';
    if (typeof renderTeacherAccount === 'function') renderTeacherAccount();
  } catch (e) {
    Utils.toast('Upload error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Save Photo'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }
}

async function removePhoto(teacherId) {
  try {
    await DB.update('teachers', teacherId, { profile_photo_url: null });
    Utils.toast('Photo removed', 'success');
    renderTeacherAccount();
  } catch (e) {
    Utils.toast('Error: ' + e.message, 'error');
  }
}
