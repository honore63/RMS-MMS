const SchoolSettings = {
  state: {
    settings: {},
    saving: false
  },

  async render() {
    setHeader('School Settings', 'Configure school information and logos');
    setContent(Utils.loading());

    const settings = await ReportUtils.getSettings();
    this.state.settings = settings;

    setContent(`
      <div class="card mb-6">
        <div class="card-header">
          <h3><i data-lucide="building-2" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>School Information</h3>
        </div>
        <div class="card-body">
          <div class="form-grid">
            <div class="form-group">
              <label>Country</label>
              <input id="ss-country" class="select-field" value="${Utils.escapeHtml(settings.country || 'Republic of Rwanda')}">
            </div>
            <div class="form-group">
              <label>Ministry</label>
              <input id="ss-ministry" class="select-field" value="${Utils.escapeHtml(settings.ministry || 'Ministry of Education')}">
            </div>
            <div class="form-group">
              <label>Province</label>
              <input id="ss-province" class="select-field" value="${Utils.escapeHtml(settings.province || 'Eastern Province')}">
            </div>
            <div class="form-group">
              <label>District</label>
              <input id="ss-district" class="select-field" value="${Utils.escapeHtml(settings.district || 'Kayonza')}">
            </div>
            <div class="form-group">
              <label>Sector</label>
              <input id="ss-sector" class="select-field" value="${Utils.escapeHtml(settings.sector || 'Gahini')}">
            </div>
            <div class="form-group">
              <label>School Name</label>
              <input id="ss-school-name" class="select-field" value="${Utils.escapeHtml(settings.school_name || 'Rukara Model School')}">
            </div>
            <div class="form-group">
              <label>School Code</label>
              <input id="ss-school-code" class="select-field" value="${Utils.escapeHtml(settings.school_code || '541023')}">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input id="ss-email" class="select-field" type="email" value="${Utils.escapeHtml(settings.school_email || '')}">
            </div>
            <div class="form-group">
              <label>Phone</label>
              <input id="ss-phone" class="select-field" value="${Utils.escapeHtml(settings.school_phone || '')}">
            </div>
            <div class="form-group">
              <label>Pass Mark (%)</label>
              <input id="ss-pass-mark" class="select-field" type="number" value="${settings.pass_mark || 50}">
            </div>
          </div>
          <div class="flex gap-3 mt-4">
            <button class="btn btn-primary" onclick="SchoolSettings.save()"><i data-lucide="save"></i> Save Settings</button>
            <button class="btn btn-secondary" onclick="SchoolSettings.uploadLogo('ministry')"><i data-lucide="image"></i> Upload Ministry Logo</button>
            <button class="btn btn-secondary" onclick="SchoolSettings.uploadLogo('school')"><i data-lucide="image"></i> Upload School Logo</button>
          </div>
        </div>
      </div>
      <div id="ss-preview" class="card">
        <div class="card-header">
          <h3><i data-lucide="eye" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Header Preview</h3>
        </div>
        <div class="card-body" id="ss-header-preview"></div>
      </div>
    `);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    this.updatePreview();
  },

  async save() {
    this.state.saving = true;
    const settings = {
      school_name: document.getElementById('ss-school-name')?.value || '',
      school_code: document.getElementById('ss-school-code')?.value || '',
      school_email: document.getElementById('ss-email')?.value || '',
      school_phone: document.getElementById('ss-phone')?.value || '',
      pass_mark: parseInt(document.getElementById('ss-pass-mark')?.value || '50'),
      country: document.getElementById('ss-country')?.value || 'Republic of Rwanda',
      ministry: document.getElementById('ss-ministry')?.value || 'Ministry of Education',
      province: document.getElementById('ss-province')?.value || 'Eastern Province',
      district: document.getElementById('ss-district')?.value || 'Kayonza',
      sector: document.getElementById('ss-sector')?.value || 'Gahini'
    };

    try {
      const existing = await DB.query('school_settings', '*');
      if (existing.length) {
        await DB.update('school_settings', existing[0].id, settings);
      } else {
        await DB.insert('school_settings', settings);
      }
      Utils.toast('School settings saved', 'success');
      this.state.settings = settings;
      this.updatePreview();
    } catch (e) {
      Utils.toast('Error saving settings: ' + e.message, 'error');
    }
    this.state.saving = false;
  },

  async uploadLogo(type) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const logoData = await Utils.compressImage(file);
        const existing = await DB.query('school_settings', '*');
        const field = type === 'ministry' ? 'ministry_logo_url' : 'school_logo_url';
        const settings = { [field]: logoData };
        if (existing.length) {
          await DB.update('school_settings', existing[0].id, settings);
        } else {
          settings.id = await DB.insert('school_settings', { ...settings, school_name: 'Rukara Model School' });
        }
        Utils.toast(`${type} logo uploaded`, 'success');
        this.updatePreview();
      } catch (e) {
        Utils.toast('Error uploading logo: ' + e.message, 'error');
      }
    };
    input.click();
  },

  updatePreview() {
    const preview = document.getElementById('ss-header-preview');
    if (!preview) return;
    const s = this.state.settings;
    preview.innerHTML = ReportHeader.getOfficialHeader({
      settings: s,
      title: 'SCHOOL SETTINGS PREVIEW',
      showLogoLeft: true,
      showLogoRight: true
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
};

function renderSettings() {
  SchoolSettings.render();
}
