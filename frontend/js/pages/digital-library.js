const DigitalLibrary = {
  bucket: 'digital-library',
  pageSize: 40,
  maxFileBytes: 25 * 1024 * 1024,
  reviewTypes: new Set(['lesson_plan', 'assessment', 'past_paper', 'class_test', 'mock_exam', 'marking_guide', 'answer_key', 'scheme_of_work']),
  resourceTypes: [
    ['lesson_plan', 'Lesson plan'], ['notes', 'Notes'], ['presentation', 'Presentation'],
    ['teaching_material', 'Teaching material'], ['scheme_of_work', 'Scheme of work'],
    ['revision', 'Revision material'], ['assessment', 'Assessment'],
    ['past_paper', 'Past paper'], ['class_test', 'Class test'], ['mock_exam', 'Mock examination'],
    ['marking_guide', 'Marking guide'], ['answer_key', 'Answer key'],
    ['video', 'Video'], ['audio', 'Audio'], ['image', 'Image'],
    ['document', 'Document'], ['resource', 'Other resource']
  ],
  state: {},

  escape(value) {
    return Utils.escapeHtml(value == null ? '' : String(value));
  },

  resourceTypeLabel(type) {
    return this.resourceTypes.find(([key]) => key === type)?.[1] || 'Resource';
  },

  statusLabel(status) {
    return ({ draft: 'Draft', submitted: 'Pending review', approved: 'Approved', returned: 'Returned', published: 'Published', archived: 'Archived' })[status] || status || 'Unknown';
  },

  iconFor(resource) {
    if (resource.resource_url) return 'external-link';
    if (resource.mime_type === 'application/pdf') return 'file-text';
    if (String(resource.mime_type || '').startsWith('image/')) return 'image';
    if (String(resource.mime_type || '').startsWith('video/')) return 'video';
    if (String(resource.mime_type || '').startsWith('audio/')) return 'audio-lines';
    if (/presentation|powerpoint/.test(resource.mime_type || '')) return 'presentation';
    if (/spreadsheet|excel/.test(resource.mime_type || '')) return 'sheet';
    return 'file';
  },

  isAIResourceSupported(resource) {
    if (resource.resource_url) return false;
    return ['application/pdf', 'text/plain', 'image/jpeg', 'image/png', 'image/webp']
      .includes(resource.mime_type);
  },

  safeExternalUrl(value) {
    try {
      const valueText = String(value || '').trim();
      if (!valueText || valueText.length > 2048) return '';
      const url = new URL(valueText);
      if (url.protocol !== 'https:' || url.username || url.password
        || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
        || url.hostname.endsWith('.local')) return '';
      return url.href;
    } catch {
      return '';
    }
  },

  formatSize(bytes) {
    const size = Number(bytes) || 0;
    return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
  },

  uuid() {
    return globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
        const value = Math.random() * 16 | 0;
        return (char === 'x' ? value : (value & 0x3 | 0x8)).toString(16);
      });
  },

  async signResourceUrl(path, downloadName = null) {
    const options = downloadName ? { download: downloadName } : {};
    const { data, error } = await sbClient.storage.from(this.bucket).createSignedUrl(path, 3600, options);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('A temporary resource link could not be created.');
    return data.signedUrl;
  },

  async prepareResourceUrls(resources) {
    if (!this.state.signedUrls) this.state.signedUrls = new Map();
    const files = resources.filter(resource => resource.storage_path && !this.state.signedUrls.has(resource.storage_path));
    await Promise.all(files.map(async resource => {
      try {
        this.state.signedUrls.set(resource.storage_path, await this.signResourceUrl(resource.storage_path));
      } catch (error) {
        console.warn('[DigitalLibrary] Could not prepare a resource preview:', resource.id, error);
      }
    }));
  },

  async track(resourceId, event) {
    const { error } = await sbClient.rpc('rms_library_track_event', {
      p_resource_id: resourceId,
      p_event: event
    });
    if (error) console.warn(`[DigitalLibrary] Could not record ${event} event:`, error);
  },

  async initPublic() {
    this.state = {
      resources: [], offset: 0, hasMore: true, loading: false, request: 0,
      searchTimer: null, signedUrls: new Map(),
      publicResourceGroups: new Map(),
      aiSelectedResources: new Map(), aiMessages: [], aiSending: false, aiEnabled: false, aiHighContrast: false,
      filterOptions: {
        classes: new Map(), subjects: new Map(), years: new Map(),
        terms: new Map(), assessmentTypes: new Map()
      }
    };
    const { data: settings, error: settingsError } = await sbClient
      .from('digital_library_settings')
      .select('ai_enabled')
      .eq('id', true)
      .maybeSingle();
    if (settingsError) {
      console.error('[DigitalLibrary] Could not load AI availability:', settingsError);
    } else {
      this.state.aiEnabled = settings?.ai_enabled === true;
    }
    this.renderPublicShell();
    await this.loadPublicResources(false);
  },

  renderPublicShell() {
    const root = document.getElementById('digital-library-root');
    if (!root) return;
    const types = this.resourceTypes.map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
    root.innerHTML = `
      <header class="dl-header">
        <a class="dl-brand" href="index.html" aria-label="RMS-MIS home">
          <img src="public/logo.webp" alt="">
          <span><strong>Rukara Model School</strong><small>Digital Library</small></span>
        </a>
        <a class="btn btn-outline" href="index.html#login"><i data-lucide="log-in"></i> Teacher sign in</a>
      </header>
      <main class="dl-main">
        <section class="dl-hero">
          <span class="dl-eyebrow"><i data-lucide="library-big"></i> Learning resources</span>
          <h1>Digital Library</h1>
          <p>Browse and download assessments, lesson plans, notes, and other learning resources shared by RMS teachers.</p>
          ${this.state.aiEnabled ? '<button type="button" class="btn btn-primary dl-ai-hero-button" onclick="DigitalLibrary.openAI()"><i data-lucide="sparkles"></i> Ask RMS AI <span>Ask. Learn. Understand.</span></button>' : ''}
        </section>
        <section class="dl-panel" aria-label="Library resources">
          <div class="dl-toolbar">
            <label class="dl-search"><i data-lucide="search"></i><span class="sr-only">Search resources</span>
              <input id="dl-search" type="search" placeholder="Search resources, topics, teachers..." oninput="DigitalLibrary.updateFilters()">
            </label>
            <label><span class="sr-only">Filter by class</span><select id="dl-class-filter" onchange="DigitalLibrary.updateFilters()"><option value="">All classes</option></select></label>
            <label><span class="sr-only">Filter by subject</span><select id="dl-subject-filter" onchange="DigitalLibrary.updateFilters()"><option value="">All subjects</option></select></label>
            <label><span class="sr-only">Filter by resource type</span><select id="dl-type-filter" onchange="DigitalLibrary.updateFilters()"><option value="">All resource types</option>${types}</select></label>
            <label><span class="sr-only">Filter by academic year</span><select id="dl-year-filter" onchange="DigitalLibrary.updateFilters()"><option value="">All years</option></select></label>
            <label><span class="sr-only">Filter by term</span><select id="dl-term-filter" onchange="DigitalLibrary.updateFilters()"><option value="">All terms</option></select></label>
            <label><span class="sr-only">Filter by assessment type</span><select id="dl-assessment-filter" onchange="DigitalLibrary.updateFilters()"><option value="">All assessment types</option></select></label>
            <label><span class="sr-only">Filter by file type</span><select id="dl-file-filter" onchange="DigitalLibrary.updateFilters()">
              <option value="">All file types</option><option value="application/pdf">PDF</option><option value="word">Word</option>
              <option value="presentation">PowerPoint</option><option value="spreadsheet">Excel</option><option value="image">Images</option>
              <option value="video">Video</option><option value="audio">Audio</option><option value="text">Text</option><option value="link">Web links</option>
            </select></label>
          </div>
          <div id="dl-results-summary" class="dl-results-summary" aria-live="polite"></div>
          <div id="dl-resource-list" class="dl-resource-grid"><div class="dl-empty">Loading library resources...</div></div>
          <div id="dl-load-more" class="dl-load-more"></div>
        </section>
      </main>
      <dialog id="dl-preview-dialog" class="dl-preview-dialog">
        <div class="dl-preview-head"><strong id="dl-preview-title"></strong><button type="button" class="btn btn-outline btn-sm" onclick="DigitalLibrary.closePreview()" aria-label="Close preview"><i data-lucide="x"></i> Close</button></div>
        <div id="dl-preview-content" class="dl-preview-content"></div>
      </dialog>
      <dialog id="dl-ai-dialog" class="dl-ai-dialog">
        <header class="dl-ai-topbar">
          <div class="dl-ai-brand">
            <button type="button" class="dl-ai-back" onclick="DigitalLibrary.closeAI()"><i data-lucide="arrow-left"></i><span>Back</span></button>
            <span class="dl-ai-brand-name"><i data-lucide="library-big"></i> RMS Digital Library</span>
          </div>
          <div class="dl-ai-classroom-title"><strong>YOUR AI LEARNING CLASSROOM</strong><span>Ask. Learn. Understand.</span></div>
          <label class="dl-ai-contrast"><span>High contrast</span><input type="checkbox" onchange="DigitalLibrary.setAIContrast(this.checked)" aria-label="Enable high contrast"><i></i></label>
        </header>
        <div class="dl-ai-classroom">
          <aside class="dl-ai-sidebar">
            <div class="dl-ai-sidebar-heading"><i data-lucide="book-open-check"></i><h2>Your lesson</h2></div>
            <p id="dl-ai-progress" class="dl-ai-progress">Choose up to 3 resources to get started</p>
            <div id="dl-ai-selected" class="dl-ai-selected"></div>
            <p class="dl-ai-sidebar-note"><i data-lucide="info"></i> RMS AI answers using only the public school resources you select.</p>
          </aside>
          <section class="dl-ai-stage" aria-label="RMS AI tutor chat">
            <div class="dl-ai-stage-heading"><span class="dl-eyebrow"><i data-lucide="sparkles"></i> RMS AI LEARNING ASSISTANT</span><h1>What would you like to learn?</h1><p>Ask about your selected lesson, or choose a learning activity.</p></div>
            <div id="dl-ai-messages" class="dl-ai-messages" aria-live="polite" aria-relevant="additions text"></div>
            <div id="dl-ai-quick-actions" class="dl-ai-quick-actions" aria-label="Learning activities" hidden>
              <button type="button" class="btn btn-outline btn-sm" onclick="DigitalLibrary.useAIAction('Explain this content in simple language, using an example suitable for my class.')">Explain</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="DigitalLibrary.useAIAction('Summarize the selected resource in a short list of key ideas.')">Summarize</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="DigitalLibrary.useAIAction('Quiz me with five questions based only on the selected resource. Ask one question at a time.')">Quiz me</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="DigitalLibrary.useAIAction('Give me practice exercises based only on the selected resource, with hints but not the answers first.')">Practice</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="DigitalLibrary.useAIAction('List the most important key points in the selected resource.')">Key points</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="DigitalLibrary.useAIAction('Create a concise revision guide from the selected resource.')">Revision</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="DigitalLibrary.useAIAction('Explain the difficult ideas in this resource using learner-friendly language.')">Simplify</button>
            </div>
            <form class="dl-ai-composer" onsubmit="DigitalLibrary.sendAIMessage(event)">
              <label for="dl-ai-question" class="sr-only">Ask a question about the selected RMS resources</label>
              <textarea id="dl-ai-question" maxlength="1200" rows="1" aria-label="Ask a question about the selected RMS resources" placeholder="Ask your tutor about this lesson..." required></textarea>
              <button class="btn btn-primary" type="submit" aria-label="Send question"><i data-lucide="send"></i> Send</button>
            </form>
            <p class="dl-ai-disclaimer">RMS AI is a learning assistant, not a replacement for your teacher.</p>
          </section>
        </div>
        <footer class="dl-ai-bottom-bar">
          <div class="dl-ai-tutor-badge"><span><i data-lucide="bot"></i></span><div><strong>RMS AI</strong><small>AI tutor</small></div></div>
          <nav class="dl-ai-action-dock" aria-label="Tutor controls">
            <button type="button" class="dl-ai-dock-primary" onclick="document.getElementById('dl-ai-question')?.focus()"><i data-lucide="message-circle"></i> Ask tutor</button>
            <button type="button" onclick="DigitalLibrary.toggleAIQuickActions(this)" aria-expanded="false"><i data-lucide="list-checks"></i> Learning tools</button>
            <button type="button" onclick="DigitalLibrary.closeAI()"><i data-lucide="arrow-left"></i> Library</button>
          </nav>
          <div class="dl-ai-grounded-badge"><i data-lucide="shield-check"></i> Public RMS resources only</div>
        </footer>
      </dialog>
      <footer class="dl-footer">Rukara Model School · Educational resources for our community</footer>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async loadPublicResources(append) {
    if ((append && this.state.loading) || (!this.state.hasMore && append)) return;
    if (!append) {
      this.state.offset = 0;
      this.state.hasMore = true;
      this.state.resources = [];
    }
    const requestId = ++this.state.request;
    this.state.loading = true;
    const list = document.getElementById('dl-resource-list');
    if (!append && list) list.innerHTML = '<div class="dl-empty">Loading library resources...</div>';
    const queryValues = this.readPublicFilters();
    try {
      let query = sbClient.from('digital_library_resources')
        .select('id,upload_group_id,title,description,resource_type,class_id,subject_id,class_name,subject_name,academic_year_id,academic_year_name,term_id,term_name,assessment_type_id,assessment_type_name,unit,topic,education_level,file_name,storage_path,resource_url,mime_type,file_size,uploader_name,view_count,download_count,ai_enabled,published_at,created_at')
        .eq('status', 'published')
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(this.state.offset, this.state.offset + this.pageSize - 1);
      if (queryValues.search) query = query.textSearch('search_vector', queryValues.search, { type: 'websearch', config: 'simple' });
      if (queryValues.classId) query = query.eq('class_id', queryValues.classId);
      if (queryValues.subjectId) query = query.eq('subject_id', queryValues.subjectId);
      if (queryValues.resourceType) query = query.eq('resource_type', queryValues.resourceType);
      if (queryValues.yearId) query = query.eq('academic_year_id', queryValues.yearId);
      if (queryValues.termId) query = query.eq('term_id', queryValues.termId);
      if (queryValues.assessmentTypeId) query = query.eq('assessment_type_id', queryValues.assessmentTypeId);
      if (queryValues.fileType) {
        if (queryValues.fileType === 'link') query = query.not('resource_url', 'is', null);
        else {
          query = query.is('resource_url', null);
          if (queryValues.fileType === 'application/pdf') query = query.eq('mime_type', queryValues.fileType);
          else if (queryValues.fileType === 'image' || queryValues.fileType === 'video' || queryValues.fileType === 'audio' || queryValues.fileType === 'text') query = query.like('mime_type', `${queryValues.fileType}/%`);
          else if (queryValues.fileType === 'word') query = query.in('mime_type', ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
          else if (queryValues.fileType === 'presentation') query = query.in('mime_type', ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']);
          else if (queryValues.fileType === 'spreadsheet') query = query.in('mime_type', ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
        }
      }
      const { data, error } = await query;
      if (error) throw error;
      if (requestId !== this.state.request) return;
      const page = data || [];
      this.state.resources = append ? this.state.resources.concat(page) : page;
      this.state.offset += page.length;
      this.state.hasMore = page.length === this.pageSize;
      this.updateFilterOptions();
      await this.renderPublicResources(requestId);
    } catch (error) {
      if (requestId !== this.state.request) return;
      console.error('[DigitalLibrary] Public resources failed to load:', error);
      if (list) list.innerHTML = `<div class="dl-empty dl-error">Could not load library resources: ${this.escape(error.message || 'Please try again.')}</div>`;
      const more = document.getElementById('dl-load-more');
      if (more) more.innerHTML = '<button type="button" class="btn btn-outline" onclick="DigitalLibrary.loadPublicResources(false)">Try again</button>';
    } finally {
      if (requestId === this.state.request) {
        this.state.loading = false;
        this.updatePublicLoadMore();
      }
    }
  },

  updatePublicLoadMore() {
    const more = document.getElementById('dl-load-more');
    if (!more) return;
    more.innerHTML = this.state.hasMore
      ? `<button type="button" class="btn btn-outline" onclick="DigitalLibrary.loadPublicResources(true)" ${this.state.loading ? 'disabled' : ''}>${this.state.loading ? 'Loading...' : 'Load more resources'}</button>`
      : '';
  },

  readPublicFilters() {
    return {
      search: (document.getElementById('dl-search')?.value || '').trim(),
      classId: document.getElementById('dl-class-filter')?.value || '',
      subjectId: document.getElementById('dl-subject-filter')?.value || '',
      resourceType: document.getElementById('dl-type-filter')?.value || '',
      yearId: document.getElementById('dl-year-filter')?.value || '',
      termId: document.getElementById('dl-term-filter')?.value || '',
      assessmentTypeId: document.getElementById('dl-assessment-filter')?.value || '',
      fileType: document.getElementById('dl-file-filter')?.value || ''
    };
  },

  updateFilterOptions() {
    const options = this.state.filterOptions;
    this.state.resources.forEach(item => {
      if (item.class_id && item.class_name) options.classes.set(String(item.class_id), item.class_name);
      if (item.subject_id && item.subject_name) options.subjects.set(String(item.subject_id), item.subject_name);
      if (item.academic_year_id) options.years.set(String(item.academic_year_id), item.academic_year_name || String(item.academic_year_id));
      if (item.term_id) options.terms.set(String(item.term_id), item.term_name || String(item.term_id));
      if (item.assessment_type_id) options.assessmentTypes.set(String(item.assessment_type_id), item.assessment_type_name || String(item.assessment_type_id));
    });
    this.setOptions('dl-class-filter', options.classes, 'All classes');
    this.setOptions('dl-subject-filter', options.subjects, 'All subjects');
    this.setOptions('dl-year-filter', options.years, 'All years');
    this.setOptions('dl-term-filter', options.terms, 'All terms');
    this.setOptions('dl-assessment-filter', options.assessmentTypes, 'All assessment types');
  },

  async renderPublicResources(requestId) {
    const list = document.getElementById('dl-resource-list');
    if (!list || requestId !== this.state.request) return;
    const groups = new Map();
    this.state.resources.forEach(resource => {
      const groupId = resource.upload_group_id || resource.id;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(resource);
    });
    const displayResources = [...groups.values()].map(resources => {
      const resource = resources.find(item =>
        item.ai_enabled !== false && this.isAIResourceSupported(item)) || resources[0];
      return {
        ...resource,
        grouped_resources: resources,
        ai_available: resources.some(item => item.ai_enabled !== false && this.isAIResourceSupported(item)),
        class_names: [...new Set(resources.map(item => item.class_name).filter(Boolean))]
      };
    });
    this.state.publicResourceGroups = new Map(displayResources.map(resource => [String(resource.id), resource.grouped_resources]));
    const cards = await Promise.all(displayResources.map(async resource => {
      try {
        const url = resource.resource_url
          ? this.safeExternalUrl(resource.resource_url)
          : this.state.signedUrls.get(resource.storage_path) || await this.signResourceUrl(resource.storage_path);
        if (!url) throw new Error('This resource link is invalid or unsupported.');
        if (!resource.resource_url) this.state.signedUrls.set(resource.storage_path, url);
        return this.publicResourceCard(resource, url);
      } catch (error) {
        console.error('[DigitalLibrary] Could not prepare a public file link:', error);
        return this.publicResourceCard(resource, '');
      }
    }));
    if (requestId !== this.state.request) return;
    list.innerHTML = cards.length ? cards.join('') : '<div class="dl-empty">No published resources match these filters.</div>';
    const summary = document.getElementById('dl-results-summary');
    if (summary) summary.textContent = `${cards.length} document card${cards.length === 1 ? '' : 's'} loaded${this.state.hasMore ? ' · Load more to browse older resources' : ''}`;
    const more = document.getElementById('dl-load-more');
    if (more) more.innerHTML = this.state.hasMore
      ? `<button type="button" class="btn btn-outline" onclick="DigitalLibrary.loadPublicResources(true)" ${this.state.loading ? 'disabled' : ''}>${this.state.loading ? 'Loading...' : 'Load more resources'}</button>`
      : '';
    list.querySelectorAll('[data-dl-preview]').forEach(button => {
      button.addEventListener('click', () => this.previewResource(button.dataset.dlPreview));
    });
    list.querySelectorAll('[data-dl-download]').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        this.downloadResource(link.dataset.dlDownload);
      });
    });
    list.querySelectorAll('[data-dl-ask-ai]').forEach(button => {
      button.addEventListener('click', () => this.openAI(button.dataset.dlAskAi));
    });
    list.querySelectorAll('[data-dl-select-ai]').forEach(input => {
      input.checked = this.state.aiSelectedResources.has(input.dataset.dlSelectAi);
      input.addEventListener('change', () => this.toggleAIResource(input.dataset.dlSelectAi, input.checked));
    });
    list.querySelectorAll('[data-dl-youtube-thumbnail]').forEach(image => {
      image.addEventListener('error', () => {
        image.hidden = true;
        const fallback = image.parentElement?.querySelector('.dl-youtube-fallback');
        if (fallback) fallback.hidden = false;
      }, { once: true });
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  setOptions(id, values, label) {
    const select = document.getElementById(id);
    if (!select) return;
    const selected = select.value;
    const selectedLabel = select.selectedOptions[0]?.textContent || selected;
    select.innerHTML = `<option value="">${label}</option>` + [...values.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([value, name]) => `<option value="${this.escape(value)}">${this.escape(name)}</option>`).join('');
    if (selected && !values.has(selected)) {
      select.insertAdjacentHTML('beforeend', `<option value="${this.escape(selected)}">${this.escape(selectedLabel)}</option>`);
    }
    if (selected) select.value = selected;
  },

  updateFilters() {
    clearTimeout(this.state.searchTimer);
    this.state.searchTimer = setTimeout(() => this.loadPublicResources(false), 300);
  },

  publicResourceCard(resource, url) {
    const date = resource.created_at ? new Date(resource.created_at).toLocaleDateString() : '';
    const detail = [
      resource.academic_year_name || '',
      resource.term_name || '',
      resource.topic || resource.unit || ''
    ].filter(Boolean).join(' · ');
    const actions = resource.resource_url && url
      ? `<a class="btn btn-primary dl-download" href="${this.escape(url)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i> Open link</a>`
      : url
      ? `<button type="button" class="btn btn-outline dl-preview" data-dl-preview="${this.escape(resource.id)}"><i data-lucide="eye"></i> View</button>
         <a class="btn btn-primary dl-download" data-dl-download="${this.escape(resource.id)}" href="#"><i data-lucide="download"></i> Download</a>
         ${this.state.aiEnabled && resource.ai_available ? `<button type="button" class="btn btn-outline dl-preview" data-dl-ask-ai="${this.escape(resource.id)}"><i data-lucide="sparkles"></i> Ask AI</button>` : ''}`
      : '<span class="dl-file-unavailable">Preview unavailable</span>';
    const isYoutubeVideo = Boolean(resource.resource_url && this.youtubeVideoId(resource.resource_url));
    const preview = this.resourceCardPreview(resource, url);
    return `<article class="dl-resource-card${isYoutubeVideo ? ' dl-resource-card-video' : ''}" data-resource-id="${this.escape(resource.id)}" style="cursor: pointer;" onclick="if(event && !event.target.closest('button, a, input, label')) DigitalLibrary.previewResource('${this.escape(resource.id)}')">
      ${preview}
      <div class="dl-card-body">
        <div class="dl-card-labels"><span>${this.escape(this.resourceTypeLabel(resource.resource_type))}</span><span>${this.escape((resource.class_names || [resource.class_name]).join(' · '))}</span></div>
        ${this.state.aiEnabled && resource.ai_available ? `<label class="dl-ai-select"><input type="checkbox" data-dl-select-ai="${this.escape(resource.id)}"><span>Add to RMS AI</span></label>` : ''}
        <h2>${this.escape(resource.title)}</h2>
        ${resource.subject_name ? `<p class="dl-subject">${this.escape(resource.subject_name)}</p>` : ''}
        ${resource.description ? `<p class="dl-description">${this.escape(resource.description)}</p>` : ''}
        ${detail ? `<p class="dl-description">${this.escape(detail)}</p>` : ''}
        <div class="dl-file-meta"><span>${this.escape(resource.uploader_name || 'RMS Teacher')}</span>${resource.resource_url && url ? `<span>${this.escape(new URL(url).hostname)}</span>` : `<span>${this.escape(resource.file_name)}</span><span>${this.formatSize(resource.file_size)}</span>`}${date ? `<span>${this.escape(date)}</span>` : ''}</div>
        <div class="dl-stats"><span>${Number(resource.view_count) || 0} views</span><span>${Number(resource.download_count) || 0} downloads</span></div>
      </div>
      <div class="dl-card-actions">${actions}</div>
    </article>`;
  },

  managedResourceCard(resource, url, mode) {
    const date = resource.created_at ? new Date(resource.created_at).toLocaleDateString() : '';
    const classes = (resource.class_names || [resource.class_name]).filter(Boolean).join(' · ');
    const detail = [
      resource.academic_year_name || '',
      resource.term_name || '',
      resource.topic || resource.unit || ''
    ].filter(Boolean).join(' · ');
    const status = `<span class="dl-status dl-status-${this.escape(resource.status)}">${this.escape(this.statusLabel(resource.status))}</span>`;
    const teacherActions = `<button type="button" class="btn btn-outline dl-preview" data-dl-edit="${this.escape(resource.id)}" aria-label="Edit details for ${this.escape(resource.title)}"><i data-lucide="pencil"></i> Edit details</button>
      ${resource.resource_url ? '' : `<button type="button" class="btn btn-outline dl-preview" data-dl-replace="${this.escape(resource.id)}" aria-label="Replace file for ${this.escape(resource.title)}"><i data-lucide="refresh-cw"></i> Replace file</button>`}
      <button type="button" class="btn btn-outline dl-preview" data-dl-delete="${this.escape(resource.id)}" aria-label="Delete ${this.escape(resource.title)}"><i data-lucide="trash-2"></i> Delete</button>`;
    const dosActions = resource.status === 'submitted' || resource.status === 'returned'
      ? `<button class="btn btn-outline btn-sm" data-dl-review="${this.escape(resource.id)}" data-dl-action="approved">Approve</button>
         <button class="btn btn-primary btn-sm" data-dl-review="${this.escape(resource.id)}" data-dl-action="published">Publish</button>
         <button class="btn btn-outline btn-sm" data-dl-review="${this.escape(resource.id)}" data-dl-action="returned">Return</button>`
      : resource.status === 'published'
        ? `<button class="btn btn-outline btn-sm" data-dl-review="${this.escape(resource.id)}" data-dl-action="returned">Return</button>
           <button class="btn btn-outline btn-sm" data-dl-review="${this.escape(resource.id)}" data-dl-action="archived">Unpublish</button>`
        : resource.status === 'approved'
          ? `<button class="btn btn-primary btn-sm" data-dl-review="${this.escape(resource.id)}" data-dl-action="published">Publish</button>
             <button class="btn btn-outline btn-sm" data-dl-review="${this.escape(resource.id)}" data-dl-action="returned">Return</button>`
          : `<button class="btn btn-primary btn-sm" data-dl-review="${this.escape(resource.id)}" data-dl-action="published">Publish</button>`;
    const actions = mode === 'teacher' ? teacherActions
      : `${dosActions}<button class="btn btn-outline btn-sm" data-dl-dos-delete="${this.escape(resource.id)}" aria-label="Delete resource"><i data-lucide="trash-2"></i> Delete</button>`;
    const aiControl = mode === 'dos'
      ? resource.resource_url
        ? '<p class="dl-description">External web links are not indexed by RMS AI.</p>'
        : `<label class="dl-ai-toggle"><input type="checkbox" data-dl-ai-resource="${this.escape(resource.id)}" ${resource.ai_enabled ? 'checked' : ''}><span>Allow RMS AI to use this resource</span></label>`
      : '';
    const isYoutubeVideo = Boolean(resource.resource_url && this.youtubeVideoId(resource.resource_url));
    return `<article class="dl-resource-card dl-managed-resource-card${isYoutubeVideo ? ' dl-resource-card-video' : ''}" data-resource-id="${this.escape(resource.id)}" style="cursor: pointer;" onclick="if(event && !event.target.closest('button, a, input, label')) DigitalLibrary.previewResource('${this.escape(resource.id)}')">
      ${this.resourceCardPreview(resource, url)}
      <div class="dl-card-body">
        <div class="dl-card-labels"><span>${this.escape(this.resourceTypeLabel(resource.resource_type))}</span><span>${this.escape(classes)}</span>${status}</div>
        <h2>${this.escape(resource.title)}</h2>
        ${resource.subject_name ? `<p class="dl-subject">${this.escape(resource.subject_name)}</p>` : ''}
        ${resource.description ? `<p class="dl-description">${this.escape(resource.description)}</p>` : ''}
        ${detail ? `<p class="dl-description">${this.escape(detail)}</p>` : ''}
        ${mode === 'dos' ? `<p class="dl-description">Uploaded by ${this.escape(resource.uploader_name || 'Teacher')}</p>` : ''}
        ${resource.return_comment ? `<p class="dl-return-comment">${this.escape(resource.return_comment)}</p>` : ''}
        <div class="dl-file-meta">${resource.resource_url && url ? `<span>${this.escape(new URL(url).hostname)}</span>` : `<span>${this.escape(resource.file_name)}</span><span>${this.formatSize(resource.file_size)}</span>`}${date ? `<span>${this.escape(date)}</span>` : ''}</div>
        <div class="dl-stats"><span>${Number(resource.view_count) || 0} views</span><span>${Number(resource.download_count) || 0} downloads</span></div>
        ${aiControl}
      </div>
      <div class="dl-card-actions">${actions}</div>
    </article>`;
  },

  youtubeVideoId(value) {
    const safeUrl = this.safeExternalUrl(value);
    if (!safeUrl) return '';
    try {
      const url = new URL(safeUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      let id = '';
      if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
      else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
        else id = url.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{6,20})(?:\/|$)/)?.[1] || '';
      }
      return /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : '';
    } catch {
      return '';
    }
  },

  resourceCardPreview(resource, url) {
    const label = this.escape(resource.title || 'Resource preview');
    const youtubeId = resource.resource_url ? this.youtubeVideoId(resource.resource_url) : '';
    if (youtubeId) {
      const videoUrl = this.escape(this.safeExternalUrl(resource.resource_url));
      return `<a class="dl-card-preview dl-card-preview-video" href="${videoUrl}" target="_blank" rel="noopener noreferrer" aria-label="Watch ${label} on YouTube"><img data-dl-youtube-thumbnail src="https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg" alt="${label} video thumbnail" loading="lazy"><span class="dl-youtube-fallback" hidden>Video thumbnail unavailable</span><span class="dl-youtube-play" aria-hidden="true"><i data-lucide="play"></i></span><span class="dl-youtube-mark" aria-hidden="true">YouTube</span></a>`;
    }
    if (resource.resource_url || !url) {
      return `<div class="dl-card-preview dl-card-preview-placeholder" aria-hidden="true"><i data-lucide="${this.iconFor(resource)}"></i><span>${this.escape(this.resourceTypeLabel(resource.resource_type))}</span></div>`;
    }
    const safeUrl = this.escape(url);
    if (resource.mime_type === 'application/pdf') {
      return `<div class="dl-card-preview dl-card-preview-document"><iframe src="${safeUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH" title="${label} preview" loading="lazy" tabindex="-1" aria-hidden="true"></iframe><span class="dl-card-preview-badge"><i data-lucide="file-text"></i> PDF preview</span></div>`;
    }
    if (String(resource.mime_type || '').startsWith('image/')) {
      return `<div class="dl-card-preview"><img src="${safeUrl}" alt="${label}" loading="lazy"></div>`;
    }
    return `<div class="dl-card-preview dl-card-preview-placeholder" aria-hidden="true"><i data-lucide="${this.iconFor(resource)}"></i><span>${this.escape(this.resourceTypeLabel(resource.resource_type))}</span></div>`;
  },

  async previewResource(resourceId) {
    const resource = this.state.resources?.find(item => String(item.id) === String(resourceId))
      || this.state.teacherContext?.resources.find(item => String(item.id) === String(resourceId))
      || this.state.dosData?.resources.find(item => String(item.id) === String(resourceId));
    if (!resource) return;
    try {
      const url = resource.resource_url
        ? this.safeExternalUrl(resource.resource_url)
        : this.state.signedUrls.get(resource.storage_path) || await this.signResourceUrl(resource.storage_path);
      if (!url) throw new Error('This resource link is invalid or unsupported.');
      if (!resource.resource_url) this.state.signedUrls.set(resource.storage_path, url);
      const dialog = this.ensurePreviewDialog();
      const content = dialog.querySelector('#dl-preview-content');
      const title = dialog.querySelector('#dl-preview-title');
      if (!content || !title) throw new Error('The preview window is unavailable.');
      title.textContent = resource.title;
      content.innerHTML = this.previewMarkup(resource, url);
      const link = content.querySelector('[data-dl-preview-download]');
      if (link) link.addEventListener('click', event => {
        event.preventDefault();
        this.downloadResource(resource.id);
      });
      dialog.showModal();
      const grouped = this.state.publicResourceGroups?.get(String(resourceId)) || [resource];
      if (this.state.resources?.some(item => String(item.id) === String(resourceId))) {
        await Promise.all(grouped.map(item => this.track(item.id, 'view')));
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
      if (resource.mime_type === 'text/plain') {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load text preview (${response.status}).`);
        const text = await response.text();
        const target = content.querySelector('.dl-text-preview');
        if (target) target.textContent = text.slice(0, 100000);
      }
    } catch (error) {
      console.error('[DigitalLibrary] Preview failed:', error);
      Utils.toast(`Could not preview this resource: ${error.message || 'Please download it instead.'}`, 'error');
    }
  },

  previewMarkup(resource, url) {
    const safeUrl = this.escape(url);
    if (resource.resource_url) {
      return `<div class="dl-preview-fallback"><i data-lucide="external-link"></i><p>This resource is hosted on an external website.</p><a class="btn btn-primary" href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open external resource</a></div>`;
    }
    let preview = '';
    if (resource.mime_type === 'application/pdf') preview = `<iframe class="dl-file-preview" src="${safeUrl}" title="${this.escape(resource.title)}"></iframe>`;
    else if (String(resource.mime_type).startsWith('image/')) preview = `<img class="dl-image-preview" src="${safeUrl}" alt="${this.escape(resource.title)}">`;
    else if (String(resource.mime_type).startsWith('video/')) preview = `<video class="dl-file-preview" controls src="${safeUrl}">Video preview is not supported by this browser.</video>`;
    else if (String(resource.mime_type).startsWith('audio/')) preview = `<audio class="dl-audio-preview" controls src="${safeUrl}">Audio preview is not supported by this browser.</audio>`;
    else if (resource.mime_type === 'text/plain') preview = '<pre class="dl-text-preview">Loading text preview...</pre>';
    else preview = `<div class="dl-preview-fallback"><i data-lucide="${this.iconFor(resource)}"></i><p>This file type cannot be previewed in the browser.</p></div>`;
    return `${preview}<div class="dl-preview-meta"><span>${this.escape(resource.file_name)}</span><span>${this.formatSize(resource.file_size)}</span><a class="btn btn-primary" data-dl-preview-download href="#">Download file</a></div>`;
  },

  async downloadResource(resourceId) {
    const resource = this.state.resources?.find(item => String(item.id) === String(resourceId))
      || this.state.teacherContext?.resources.find(item => String(item.id) === String(resourceId))
      || this.state.dosData?.resources.find(item => String(item.id) === String(resourceId));
    if (!resource) return;
    try {
      if (resource.resource_url) {
        const url = this.safeExternalUrl(resource.resource_url);
        if (!url) throw new Error('This resource link is invalid or unsupported.');
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      const url = await this.signResourceUrl(resource.storage_path, resource.file_name);
      const grouped = this.state.publicResourceGroups?.get(String(resourceId)) || [resource];
      if (this.state.resources?.some(item => String(item.id) === String(resourceId))) {
        await Promise.all(grouped.map(item => this.track(item.id, 'download')));
      }
      window.location.assign(url);
    } catch (error) {
      console.error('[DigitalLibrary] Download failed:', error);
      Utils.toast(`Could not download this resource: ${error.message || 'Please try again.'}`, 'error');
    }
  },

  toggleAIResource(resourceId, selected) {
    const resource = this.state.resources.find(item => String(item.id) === String(resourceId));
    if (!resource) return;
    if (selected) {
      const room = 3 - this.state.aiSelectedResources.size;
      if (room <= 0) {
        Utils.toast('Select up to three resources for one RMS AI question.', 'error');
        this.updateAISelectionUI();
        return;
      }
      if (resource.ai_enabled !== false && this.isAIResourceSupported(resource)) {
        this.state.aiSelectedResources.set(String(resource.id), resource);
      }
    } else {
      this.state.aiSelectedResources.delete(String(resource.id));
    }
    this.updateAISelectionUI();
  },

  openAI(resourceId = null) {
    if (!this.state.aiEnabled) {
      Utils.toast('The RMS AI Learning Assistant is currently unavailable.', 'warning');
      return;
    }
    if (resourceId) {
      const resource = this.state.resources.find(item => String(item.id) === String(resourceId));
      this.state.aiSelectedResources.clear();
      if (resource && resource.ai_enabled !== false && this.isAIResourceSupported(resource)) {
        this.state.aiSelectedResources.set(String(resource.id), resource);
      }
    }
    const dialog = document.getElementById('dl-ai-dialog');
    if (!dialog) return;
    dialog.classList.toggle('dl-ai-high-contrast', this.state.aiHighContrast);
    const contrast = dialog.querySelector('.dl-ai-contrast input');
    if (contrast) contrast.checked = this.state.aiHighContrast;
    this.updateAISelectionUI();
    this.renderAIMessages();
    if (!dialog.open) dialog.showModal();
    document.getElementById('dl-ai-question')?.focus();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  closeAI() {
    const dialog = document.getElementById('dl-ai-dialog');
    if (dialog?.open) dialog.close();
  },

  setAIContrast(enabled) {
    this.state.aiHighContrast = enabled === true;
    document.getElementById('dl-ai-dialog')?.classList.toggle('dl-ai-high-contrast', this.state.aiHighContrast);
  },

  toggleAIQuickActions(button) {
    const panel = document.getElementById('dl-ai-quick-actions');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (button) button.setAttribute('aria-expanded', String(!panel.hidden));
  },

  updateAISelectionUI() {
    const container = document.getElementById('dl-ai-selected');
    if (!container) return;
    const resources = [...this.state.aiSelectedResources.values()];
    const progress = document.getElementById('dl-ai-progress');
    if (progress) progress.textContent = `${resources.length} of 3 resources selected`;
    container.innerHTML = resources.length
      ? `<strong>${resources.length === 1 ? 'You are asking RMS AI about:' : 'Selected resources'}</strong><div class="dl-ai-resource-list">${resources.map((resource, index) =>
        `<article class="dl-ai-resource-item"><span class="dl-ai-resource-number">${index + 1}</span><div><strong>${this.escape(resource.title)}</strong><small>${this.escape(resource.class_name || 'Class')}${resource.subject_name ? ` · ${this.escape(resource.subject_name)}` : ''}</small></div><button type="button" data-dl-ai-remove="${this.escape(resource.id)}" aria-label="Remove ${this.escape(resource.title)}">×</button></article>`).join('')}</div>`
      : '<div class="dl-ai-empty-selection"><i data-lucide="library-big"></i><strong>No resource selected</strong><span>Close this window and add a supported PDF, text, or image resource from the library.</span></div>';
    container.querySelectorAll('[data-dl-ai-remove]').forEach(button => {
      button.addEventListener('click', () => {
        this.state.aiSelectedResources.delete(button.dataset.dlAiRemove);
        this.updateAISelectionUI();
        this.updatePublicAISelectionUI();
      });
    });
    this.updatePublicAISelectionUI();
  },

  updatePublicAISelectionUI() {
    document.querySelectorAll('[data-dl-select-ai]').forEach(input => {
      const group = this.state.publicResourceGroups.get(input.dataset.dlSelectAi) || [];
      input.checked = group.some(resource => this.state.aiSelectedResources.has(String(resource.id)));
    });
  },

  useAIAction(prompt) {
    if (!this.state.aiSelectedResources.size) {
      Utils.toast('Select at least one public resource first.', 'error');
      return;
    }
    const question = document.getElementById('dl-ai-question');
    if (question) question.value = prompt;
    this.sendAIMessage();
  },

  renderAIMessages() {
    const container = document.getElementById('dl-ai-messages');
    if (!container) return;
    if (!this.state.aiMessages.length) {
      container.innerHTML = '<div class="dl-ai-welcome"><span class="dl-ai-welcome-icon"><i data-lucide="graduation-cap"></i></span><strong>Muraho! I’m your RMS AI tutor.</strong><p>Select a resource from the library, then ask a question. I’ll help you understand it step by step.</p></div>';
    } else {
      container.innerHTML = this.state.aiMessages.map(message => `
        <article class="dl-ai-message dl-ai-message-${message.role}">
          <strong>${message.role === 'user' ? 'You' : 'RMS AI'}</strong>
          <p>${this.escape(message.text).replace(/\n/g, '<br>')}</p>
          ${message.sources?.length ? `<div class="dl-ai-source-list"><strong>Sources</strong>${message.sources.map(source =>
            `<button type="button" class="dl-ai-source-link" data-dl-ai-source="${this.escape(source.id)}"><i data-lucide="book-open"></i>View source: ${this.escape(source.title)}${source.sections?.length ? ` · ${this.escape(source.sections.join(', '))}` : ''}</button>`).join('')}</div>` : ''}
        </article>`).join('');
    }
    if (this.state.aiSending) container.insertAdjacentHTML('beforeend', '<div class="dl-ai-thinking" role="status">RMS AI is reading the selected resources...</div>');
    if (this.state.aiMessages.length || this.state.aiSending) container.scrollTop = container.scrollHeight;
    container.querySelectorAll('[data-dl-ai-source]').forEach(button => button.addEventListener('click', () => {
      this.closeAI();
      this.previewResource(button.dataset.dlAiSource);
    }));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async sendAIMessage(event) {
    if (event) event.preventDefault();
    if (this.state.aiSending) return;
    const questionInput = document.getElementById('dl-ai-question');
    const question = (questionInput?.value || '').trim();
    const selected = [...this.state.aiSelectedResources.values()];
    if (!selected.length) {
      Utils.toast('Select at least one public resource first.', 'error');
      return;
    }
    if (!question) return;
    if (question.length > 1200) return Utils.toast('Keep your question under 1,200 characters.', 'error');
    const previousMessages = this.state.aiMessages
      .filter(message => message.role === 'user')
      .slice(-2)
      .map(message => `Learner's earlier question: ${message.text}`);
    const groundedQuestion = previousMessages.length
      ? `${previousMessages.join('\n').slice(-800)}\nLearner's current question: ${question}`
      : question;
    this.state.aiMessages.push({ role: 'user', text: question });
    this.state.aiSending = true;
    if (questionInput) questionInput.value = '';
    this.renderAIMessages();
    const submit = document.querySelector('.dl-ai-composer [type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const classNames = [...new Set(selected.map(resource => resource.class_name).filter(Boolean))];
      const subjects = [...new Set(selected.map(resource => resource.subject_name).filter(Boolean))];
      const levels = [...new Set(selected.map(resource => resource.education_level).filter(Boolean))];
      const { data, error } = await sbClient.functions.invoke('digital-library-ai', {
        body: {
          resourceIds: selected.map(resource => resource.id),
          question: groundedQuestion,
          level: levels.join(', '),
          className: classNames.join(', '),
          subject: subjects.join(', ')
        }
      });
      if (error) throw new Error(error.message || 'The RMS AI service is unavailable.');
      if (!data?.answer) throw new Error(data?.error || 'RMS AI could not create an answer.');
      this.state.aiMessages.push({
        role: 'assistant',
        text: data.answer,
        sources: Array.isArray(data.sources) ? data.sources : []
      });
    } catch (error) {
      console.error('[DigitalLibrary] RMS AI request failed:', error);
      this.state.aiMessages.push({
        role: 'assistant',
        text: error.message || 'RMS AI could not answer right now. Please try again.',
        sources: []
      });
    } finally {
      this.state.aiSending = false;
      if (submit) submit.disabled = false;
      this.renderAIMessages();
      questionInput?.focus();
    }
  },

  closePreview() {
    const dialog = document.getElementById('dl-preview-dialog');
    if (dialog?.open) dialog.close();
    const content = document.getElementById('dl-preview-content');
    if (content) content.replaceChildren();
  },

  ensurePreviewDialog() {
    let dialog = document.getElementById('dl-preview-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'dl-preview-dialog';
      dialog.className = 'dl-preview-dialog';
      dialog.innerHTML = `
        <div class="dl-preview-head">
          <strong id="dl-preview-title"></strong>
          <button type="button" class="btn btn-outline btn-sm" data-dl-preview-close aria-label="Close preview"><i data-lucide="x"></i> Close</button>
        </div>
        <div id="dl-preview-content" class="dl-preview-content"></div>`;
      dialog.querySelector('[data-dl-preview-close]').addEventListener('click', () => this.closePreview());
      document.body.append(dialog);
    }
    return dialog;
  },

  async loadTeacherContext(teacherId) {
    const [classesResult, assignmentsResult, subjectsResult, yearsResult, termsResult, typesResult, resourcesResult, statsResult] = await Promise.all([
      sbClient.from('classes').select('id,name,level,stream,education_level,class_teacher_id').eq('status', 'active').order('name'),
      sbClient.from('teacher_assignments').select('class_id,subject_id,academic_year_id,term_id').eq('teacher_id', teacherId),
      sbClient.from('subjects').select('id,name,level,education_level,grades').eq('status', 'active').order('name'),
      sbClient.from('academic_years').select('id,name,status,is_current').order('name', { ascending: false }),
      sbClient.from('terms').select('id,name,academic_year_id,term_no,is_active').order('term_no'),
      sbClient.from('assessment_types').select('id,name,status').eq('status', 'active').order('display_order'),
      sbClient.from('digital_library_resources').select('id,title,description,resource_type,class_id,subject_id,class_name,subject_name,file_name,storage_path,resource_url,mime_type,file_size,status,return_comment,view_count,download_count,created_at,topic,unit,academic_year_id,academic_year_name,term_id,term_name,assessment_type_id,assessment_type_name').eq('uploaded_by', Auth.currentUser.id).order('created_at', { ascending: false }).limit(100),
      sbClient.rpc('rms_library_teacher_stats')
    ]);
    for (const result of [classesResult, assignmentsResult, subjectsResult, yearsResult, termsResult, typesResult, resourcesResult, statsResult]) {
      if (result.error) throw result.error;
    }
    const classes = classesResult.data || [];
    const assignments = assignmentsResult.data || [];
    const classTeacherClasses = new Set(classes
      .filter(item => String(item.class_teacher_id || '') === String(teacherId))
      .map(item => String(item.id)));
    const assignedClasses = new Set(assignments.map(item => String(item.class_id)).filter(Boolean));
    const allClassAssignment = assignments.some(item => !item.class_id);
    return {
      classes,
      assignments,
      subjects: subjectsResult.data || [],
      years: yearsResult.data || [],
      terms: termsResult.data || [],
      assessmentTypes: typesResult.data || [],
      resources: resourcesResult.data || [],
      stats: statsResult.data || {},
      allowedClasses: classes.filter(item => classTeacherClasses.has(String(item.id))
        || allClassAssignment || assignedClasses.has(String(item.id))),
      classTeacherClasses
    };
  },

  async renderTeacher() {
    setHeader('Digital Library', 'Upload and manage your teaching resources');
    setContent(Utils.loading());
    if (!Auth.isTeacher() || !Auth.getTeacherId()) {
      setContent(`${Utils.errorCard('Teacher access required', 'Only signed-in teachers can upload resources. Public resources can be browsed without signing in.')}<p class="text-center"><a class="btn btn-outline" href="digital-library.html">Open public library</a></p>`);
      return;
    }
    try {
      this.state.teacherId = Auth.getTeacherId();
      this.state.teacherContext = await this.loadTeacherContext(this.state.teacherId);
      await this.prepareResourceUrls(this.state.teacherContext.resources);
      this.renderTeacherPage();
    } catch (error) {
      console.error('[DigitalLibrary] Teacher library failed to load:', error);
      setContent(Utils.errorCard('Could not load the Digital Library', this.escape(error.message || 'Please try again.')));
    }
  },

  toggleResourceSource(source) {
    const isLink = source === 'link';
    const fileField = document.getElementById('dl-file-source');
    const linkField = document.getElementById('dl-link-source');
    const fileInput = fileField?.querySelector('input[type="file"]');
    const urlInput = linkField?.querySelector('input[type="url"]');
    if (fileField) fileField.hidden = isLink;
    if (linkField) linkField.hidden = !isLink;
    if (fileInput) {
      fileInput.disabled = isLink;
      fileInput.required = !isLink;
      if (isLink) fileInput.value = '';
    }
    if (urlInput) {
      urlInput.disabled = !isLink;
      urlInput.required = isLink;
      if (!isLink) urlInput.value = '';
    }
  },

  renderTeacherPage() {
    const context = this.state.teacherContext;
    const classes = context.allowedClasses;
    const years = context.years;
    const currentYear = years.find(item => item.is_current || item.status === 'active') || years[0];
    const terms = context.terms.filter(item => !currentYear || String(item.academic_year_id) === String(currentYear.id));
    const currentTerm = terms.find(item => item.is_active) || terms[0];
    const resourceOptions = this.resourceTypes.map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
    setContent(`
      <section class="dl-teacher-page">
        <div class="dl-teacher-heading">
          <div><span class="dl-eyebrow"><i data-lucide="library-big"></i> Digital Library</span><h2>Share learning resources</h2>
          <p>Uploaded resources are published immediately and become available in the public library.</p></div>
          <a class="btn btn-outline" href="digital-library.html" target="_blank" rel="noopener"><i data-lucide="external-link"></i> View public library</a>
        </div>
        <div class="dl-stat-grid">
          ${this.teacherStat('My resources', context.stats.total_resources || 0, 'library-big')}
          ${this.teacherStat('Published', context.stats.published_resources || 0, 'globe-2')}
          ${this.teacherStat('Pending review', context.stats.pending_reviews || 0, 'clock-3')}
          ${this.teacherStat('Returned', context.stats.returned_resources || 0, 'undo-2')}
          ${this.teacherStat('Downloads', context.stats.total_downloads || 0, 'download')}
        </div>
        <div class="dl-teacher-grid">
          <form class="card dl-upload-form" id="dl-upload-form" onsubmit="DigitalLibrary.upload(event)">
            <h3><i data-lucide="file-up"></i> Share a resource</h3>
            <label class="form-group"><span>Title *</span><input class="input-field" name="title" maxlength="180" required placeholder="e.g. P6 Mathematics: Fractions"></label>
            <div class="dl-form-row">
              <label class="form-group"><span>Category *</span><select class="select-field" name="resource_type" required>${resourceOptions}</select></label>
              <div class="form-group"><span>Classes * <small>Select one or more assigned classes. The same file will be added to each selected class.</small></span>
                <div class="dl-class-options" id="dl-teacher-classes" role="group" aria-label="Classes for this resource">
                  ${classes.map(item => `<label class="dl-class-option"><input type="checkbox" name="class_ids" value="${this.escape(item.id)}" onchange="DigitalLibrary.updateTeacherSubjects()"><span>${this.escape(this.classLabel(item))}</span></label>`).join('')}
                </div>
              </div>
              <label class="form-group"><span>Resource source *</span>
                <select class="select-field" name="resource_source" onchange="DigitalLibrary.toggleResourceSource(this.value)">
                  <option value="file">Upload a file</option><option value="link">Share a web link</option>
                </select>
              </label>
            </div>
            <div class="dl-form-row">
              <label class="form-group"><span>Subject</span><select class="select-field" name="subject_id" id="dl-teacher-subject"><option value="">Choose a class first</option></select></label>
              <label class="form-group"><span>Academic year</span><select class="select-field" name="academic_year_id" id="dl-teacher-year" onchange="DigitalLibrary.updateTeacherTerms(this.value)">
                <option value="">Not applicable</option>${years.map(item => `<option value="${this.escape(item.id)}" ${String(item.id) === String(currentYear?.id || '') ? 'selected' : ''}>${this.escape(item.name)}</option>`).join('')}
              </select></label>
            </div>
            <div class="dl-form-row">
              <label class="form-group"><span>Term</span><select class="select-field" name="term_id" id="dl-teacher-term">
                <option value="">Not applicable</option>${terms.map(item => `<option value="${this.escape(item.id)}" ${String(item.id) === String(currentTerm?.id || '') ? 'selected' : ''}>${this.escape(item.name)}</option>`).join('')}
              </select></label>
              <label class="form-group"><span>Assessment type (optional)</span><select class="select-field" name="assessment_type_id">
                <option value="">Not applicable</option>${context.assessmentTypes.map(item => `<option value="${this.escape(item.id)}">${this.escape(item.name)}</option>`).join('')}
              </select></label>
            </div>
            <div class="dl-form-row">
              <label class="form-group"><span>Unit (optional)</span><input class="input-field" name="unit" maxlength="160" placeholder="Unit or chapter"></label>
              <label class="form-group"><span>Topic (optional)</span><input class="input-field" name="topic" maxlength="160" placeholder="Topic covered"></label>
            </div>
            <label class="form-group"><span>Description (optional)</span><textarea class="input-field" name="description" maxlength="2000" rows="3" placeholder="Briefly describe this resource"></textarea></label>
            <label class="form-group dl-file-picker dl-source-field" id="dl-file-source"><span>File * <small>PDF, Office, text, image, audio, video, or ZIP · up to 25 MB</small></span>
              <input type="file" name="file" required accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp,.mp3,.wav,.mp4,.webm,.zip">
            </label>
            <label class="form-group dl-source-field" id="dl-link-source" hidden><span>Web link * <small>Use a secure HTTPS link, for example a YouTube video or shared Google Drive resource.</small></span>
              <input class="input-field" type="url" name="resource_url" placeholder="https://example.com/learning-resource" maxlength="2048" disabled>
            </label>
            <p class="dl-public-notice"><i data-lucide="globe-2"></i> Published resources are public. Share only approved learning links that students are allowed to access. Do not upload answer keys or confidential student information as public resources.</p>
            <button class="btn btn-primary" type="submit"><i data-lucide="upload"></i> Share resource</button>
            ${classes.length ? '' : '<p class="dl-error">No classes are assigned to your teacher account. Ask the DOS to assign your class or subject first.</p>'}
          </form>
          <section class="card dl-my-resources">
            <div class="dl-my-resources-heading"><div><h3>My uploads</h3><p>Latest 100 resources you uploaded</p></div><span>${context.resources.length}</span></div>
            ${context.resources.length ? `<div class="dl-resource-grid dl-managed-resource-grid">${context.resources.map(item =>
              this.managedResourceCard(item, item.resource_url ? this.safeExternalUrl(item.resource_url) : this.state.signedUrls.get(item.storage_path), 'teacher')
            ).join('')}</div>` : '<div class="dl-empty">You have not uploaded any resources yet.</div>'}
          </section>
        </div>
      </section>`);
    this.toggleResourceSource(document.querySelector('#dl-upload-form [name="resource_source"]')?.value || 'file');
    document.querySelectorAll('[data-dl-edit]').forEach(button => button.addEventListener('click', () => {
      const resource = context.resources.find(item => String(item.id) === button.dataset.dlEdit);
      if (resource) this.editResource(resource);
    }));
    document.querySelectorAll('[data-dl-replace]').forEach(button => button.addEventListener('click', () => {
      const resource = context.resources.find(item => String(item.id) === button.dataset.dlReplace);
      if (resource) this.pickReplacement(resource);
    }));
    document.querySelectorAll('[data-dl-delete]').forEach(button => button.addEventListener('click', () => {
      const resource = context.resources.find(item => String(item.id) === button.dataset.dlDelete);
      if (resource) this.deleteResource(resource);
    }));
    const more = document.getElementById('dl-dos-more');
    if (more) more.innerHTML = data.hasMore
      ? `<button type="button" class="btn btn-outline" onclick="DigitalLibrary.loadMoreDosResources()" ${data.loadingMore ? 'disabled' : ''}>${data.loadingMore ? 'Loading...' : 'Load more resources'}</button>`
      : '';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async loadMoreDosResources() {
    const data = this.state.dosData;
    if (!data || data.loadingMore || !data.hasMore) return;
    data.loadingMore = true;
    this.filterDosResources();
    try {
      const { data: page, error } = await sbClient.from('digital_library_resources')
        .select('id,title,description,resource_type,class_id,subject_id,class_name,subject_name,education_level,academic_year_id,academic_year_name,term_id,term_name,assessment_type_id,assessment_type_name,topic,unit,file_name,mime_type,file_size,uploader_name,teacher_id,status,return_comment,created_at,view_count,download_count,storage_path,resource_url,ai_enabled')
        .order('created_at', { ascending: false })
        .range(data.offset, data.offset + this.pageSize - 1);
      if (error) throw error;
      data.resources.push(...(page || []));
      await this.prepareResourceUrls(page || []);
      data.offset += (page || []).length;
      data.hasMore = (page || []).length === this.pageSize;
      const teacherSelect = document.getElementById('dl-dos-teacher');
      const selectedTeacher = teacherSelect?.value || '';
      if (teacherSelect) {
        const teachers = [...new Map(data.resources.map(item => [String(item.teacher_id), item.uploader_name])).entries()];
        teacherSelect.innerHTML = '<option value="">All teachers</option>' + teachers.map(([id, name]) =>
          `<option value="${this.escape(id)}">${this.escape(name || 'Teacher')}</option>`).join('');
        teacherSelect.value = selectedTeacher;
      }
      this.filterDosResources();
    } catch (error) {
      console.error('[DigitalLibrary] More DOS resources failed to load:', error);
      Utils.toast(`Could not load more resources: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      data.loadingMore = false;
      this.filterDosResources();
    }
  },

  teacherStat(label, value, icon) {
    return `<div class="dl-stat"><span><i data-lucide="${icon}"></i></span><strong>${this.escape(value)}</strong><small>${this.escape(label)}</small></div>`;
  },

  classLabel(item) {
    return item.stream && !String(item.name).toLowerCase().includes(String(item.stream).toLowerCase())
      ? `${item.name} - ${item.stream}` : item.name;
  },

  updateTeacherSubjects(classIds) {
    const select = document.getElementById('dl-teacher-subject');
    if (!select) return;
    const previousSubjectId = select.value;
    const context = this.state.teacherContext;
    const selectedValues = classIds === undefined
      ? [...document.querySelectorAll('#dl-teacher-classes input[name="class_ids"]:checked')].map(input => input.value)
      : (Array.isArray(classIds) ? classIds : [classIds]);
    const selectedClassIds = selectedValues.filter(Boolean).map(String);
    if (!selectedClassIds.length) {
      select.innerHTML = '<option value="">Choose a class first</option>';
      select.required = false;
      return;
    }
    const classes = selectedClassIds.map(classId => context.allowedClasses.find(item => String(item.id) === classId));
    if (classes.some(item => !item)) {
      select.innerHTML = '<option value="">Choose assigned classes</option>';
      select.required = true;
      return;
    }
    const subjectSets = classes.map((cls, index) => {
      const classId = selectedClassIds[index];
      const isClassTeacher = context.classTeacherClasses.has(classId);
      const assignments = context.assignments.filter(item =>
        !item.class_id || String(item.class_id) === classId);
      const classWideAllowed = isClassTeacher || assignments.some(item => !item.subject_id);
      const assignedSubjectIds = new Set(assignments.map(item => String(item.subject_id)).filter(Boolean));
      return {
        classWideAllowed,
        subjects: context.subjects.filter(subject =>
          EducationLevels.subjectMatchesClass(subject, cls)
          && (classWideAllowed || assignedSubjectIds.has(String(subject.id))))
      };
    });
    const classWideAllowed = subjectSets.every(item => item.classWideAllowed);
    const commonSubjects = subjectSets[0].subjects.filter(subject =>
      subjectSets.every(item => item.subjects.some(candidate => String(candidate.id) === String(subject.id))));
    select.innerHTML = `${classWideAllowed ? '<option value="">All subjects / class resource</option>' : '<option value="">Select assigned subject</option>'}`
      + commonSubjects.map(item => `<option value="${this.escape(item.id)}">${this.escape(item.name)}</option>`).join('');
    if (commonSubjects.some(item => String(item.id) === previousSubjectId)) {
      select.value = previousSubjectId;
    }
    select.required = !classWideAllowed;
  },

  updateTeacherTerms(yearId) {
    const select = document.getElementById('dl-teacher-term');
    if (!select) return;
    const terms = this.state.teacherContext.terms.filter(item =>
      !yearId || String(item.academic_year_id) === String(yearId));
    select.innerHTML = '<option value="">Not applicable</option>' + terms.map(item =>
      `<option value="${this.escape(item.id)}">${this.escape(item.name)}</option>`).join('');
  },

  mimeType(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const byExtension = ({
      pdf: 'application/pdf', doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', zip: 'application/zip'
    })[extension];
    return byExtension || file.type || '';
  },

  allowedMimeTypes() {
    return new Set([
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip', 'text/plain', 'image/jpeg', 'image/png', 'image/webp',
      'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/mp4', 'video/webm'
    ]);
  },

  async upload(event) {
    event.preventDefault();
    if (!Auth.isTeacher() || !Auth.getTeacherId()) {
      Utils.toast('Sign in with an active teacher account to upload resources.', 'error');
      return;
    }
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get('file');
    const isLink = values.get('resource_source') === 'link';
    const resourceUrl = isLink ? this.safeExternalUrl(values.get('resource_url')) : '';
    const classIds = [...new Set(values.getAll('class_ids').map(value => String(value)).filter(Boolean))];
    const context = this.state.teacherContext;
    const selectedClasses = classIds.map(classId =>
      context.allowedClasses.find(item => String(item.id) === classId));
    const mimeType = file instanceof File ? this.mimeType(file) : '';
    if (isLink && !resourceUrl) return Utils.toast('Enter a valid HTTPS link to share.', 'error');
    if (!isLink && (!(file instanceof File) || !file.size)) return Utils.toast('Choose a resource file to upload.', 'error');
    if (!isLink && file.size > this.maxFileBytes) return Utils.toast('The maximum file size is 25 MB.', 'error');
    if (!isLink && !this.allowedMimeTypes().has(mimeType)) return Utils.toast('Choose a supported educational file type.', 'error');
    if (!classIds.length || selectedClasses.some(item => !item)) {
      return Utils.toast('Choose one or more classes assigned to you.', 'error');
    }
    const title = String(values.get('title') || '').trim();
    if (!title) return Utils.toast('Enter a title for this resource.', 'error');
    const subjectId = String(values.get('subject_id') || '') || null;
    const subject = subjectId ? context.subjects.find(item => String(item.id) === subjectId) : null;
    if (subjectId && !subject) return Utils.toast('Choose a valid subject.', 'error');
    for (let index = 0; index < selectedClasses.length; index += 1) {
      const cls = selectedClasses[index];
      const classId = classIds[index];
      const assignments = context.assignments.filter(item =>
        !item.class_id || String(item.class_id) === classId);
      const classTeacher = context.classTeacherClasses.has(classId);
      const canUploadClassWide = classTeacher || assignments.some(item => !item.subject_id);
      if (!subjectId && !canUploadClassWide) {
        return Utils.toast(`Choose a subject assigned in ${this.classLabel(cls)}.`, 'error');
      }
      if (subjectId && (!EducationLevels.subjectMatchesClass(subject, cls)
        || (!classTeacher && !assignments.some(item =>
          !item.subject_id || String(item.subject_id) === subjectId)))) {
        return Utils.toast(`${subject.name} is not assigned or available in ${this.classLabel(cls)}.`, 'error');
      }
    }
    const submit = form.querySelector('[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = isLink ? 'Sharing...' : 'Uploading...'; }
    const userId = Auth.currentUser.id;
    const uploadGroupId = this.uuid();
    const safeName = isLink
      ? new URL(resourceUrl).hostname
      : file.name.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'resource';
    const uploadedPaths = [];
    let recordsInserted = false;
    try {
      const resources = [];
      for (const cls of selectedClasses) {
        const id = this.uuid();
        const level = String(cls.education_level || cls.level || cls.name).toLowerCase().includes('primary')
          || /(^|[^a-z0-9])p[1-6]/i.test(`${cls.level || ''} ${cls.name || ''}`)
          ? 'primary' : 'secondary';
        let path = null;
        if (!isLink) {
          path = `${level}/${cls.id}/${userId}/${id}/${safeName}`;
          const uploadResult = await sbClient.storage.from(this.bucket).upload(path, file, {
            cacheControl: '3600', contentType: mimeType, upsert: false
          });
          if (uploadResult.error) throw uploadResult.error;
          uploadedPaths.push(path);
        }
        resources.push({
          id,
          title,
          description: String(values.get('description') || '').trim(),
          resource_type: String(values.get('resource_type') || 'resource'),
          class_id: cls.id,
          subject_id: subject?.id || null,
          academic_year_id: String(values.get('academic_year_id') || '') || null,
          term_id: String(values.get('term_id') || '') || null,
          assessment_type_id: String(values.get('assessment_type_id') || '') || null,
          unit: String(values.get('unit') || '').trim() || null,
          topic: String(values.get('topic') || '').trim() || null,
          file_name: safeName,
          storage_path: path,
          resource_url: isLink ? resourceUrl : null,
          mime_type: isLink ? 'text/uri-list' : mimeType,
          file_size: isLink ? new TextEncoder().encode(resourceUrl).byteLength : file.size,
          uploaded_by: userId,
          teacher_id: Auth.getTeacherId(),
          upload_group_id: uploadGroupId
        });
      }
      const insertResult = await sbClient.from('digital_library_resources')
        .insert(resources)
        .select('id,status,visibility,is_published');
      if (insertResult.error) throw insertResult.error;
      recordsInserted = true;
      const publishedResources = insertResult.data || [];
      if (publishedResources.length !== resources.length
        || publishedResources.some(resource =>
          resource.status !== 'published' || resource.visibility !== 'public' || !resource.is_published)) {
        throw new Error('The upload was saved, but the database did not confirm public publication. Contact the DOS before sharing the resource.');
      }
      let indexingFailed = false;
      if (!isLink && this.isAIResourceSupported({ mime_type: mimeType })) {
        const { error } = await sbClient.functions.invoke('digital-library-index', {
          body: { resourceIds: [resources.slice().sort((left, right) =>
            String(left.id).localeCompare(String(right.id)))[0].id] }
        });
        if (error) {
          indexingFailed = true;
          console.error('[DigitalLibrary] Resource uploaded but RMS AI indexing failed:', error);
        }
      }
      Utils.toast(`${isLink ? 'Link shared' : 'Resource uploaded'} and published to the Digital Library for ${selectedClasses.length} class${selectedClasses.length === 1 ? '' : 'es'}.`, 'success');
      if (indexingFailed) {
        Utils.toast('The resource was uploaded, but it could not be indexed for RMS AI yet. The assistant can retry when a learner asks about it.', 'warning');
      }
      await this.renderTeacher();
    } catch (error) {
      if (uploadedPaths.length && !recordsInserted) {
        const cleanup = await sbClient.storage.from(this.bucket).remove(uploadedPaths);
        if (cleanup.error) {
          console.error('[DigitalLibrary] Upload failed and storage cleanup failed:', cleanup.error);
          Utils.toast(`Could not publish the resource: ${error.message}. The uploaded file could not be removed; contact the administrator.`, 'error');
        } else Utils.toast(`Could not publish the resource: ${error.message || 'Please try again.'}`, 'error');
      } else {
        console.error('[DigitalLibrary] Upload failed:', error);
        Utils.toast(recordsInserted
          ? `Resource saved, but public visibility could not be confirmed: ${error.message || 'Unknown error'}`
          : `Could not upload the resource: ${error.message || 'Unknown error'}`, 'error');
      }
      if (submit) { submit.disabled = false; submit.innerHTML = '<i data-lucide="share-2"></i> Share resource'; }
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  },

  async editResource(resource) {
    const context = this.state.teacherContext;
    const classId = String(resource.class_id);
    const assignments = context.assignments.filter(item => !item.class_id || String(item.class_id) === classId);
    const classWideAllowed = context.classTeacherClasses.has(classId) || assignments.some(item => !item.subject_id);
    const allowedSubjects = context.subjects.filter(subject =>
      EducationLevels.subjectMatchesClass(subject, context.classes.find(item => String(item.id) === classId))
      && (classWideAllowed || assignments.some(item => String(item.subject_id) === String(subject.id))));
    let dialog = document.getElementById('dl-edit-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'dl-edit-dialog';
      dialog.className = 'dl-preview-dialog dl-edit-dialog';
      document.body.append(dialog);
    }
    const terms = context.terms.filter(item =>
      !resource.academic_year_id || String(item.academic_year_id) === String(resource.academic_year_id));
    dialog.innerHTML = `
      <form class="dl-edit-form" id="dl-edit-form">
        <div class="dl-preview-head"><strong>Edit resource details</strong><button type="button" class="btn btn-outline btn-sm" data-dl-edit-close>Close</button></div>
        <label class="form-group"><span>Title *</span><input class="input-field" name="title" maxlength="180" required value="${this.escape(resource.title)}"></label>
        <div class="dl-form-row">
          <label class="form-group"><span>Category *</span><select class="select-field" name="resource_type" required>${this.resourceTypes.map(([key, label]) => `<option value="${key}" ${key === resource.resource_type ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <label class="form-group"><span>Subject</span><select class="select-field" name="subject_id" ${classWideAllowed ? '' : 'required'}>
            ${classWideAllowed ? '<option value="">Class resource</option>' : '<option value="">Select assigned subject</option>'}
            ${allowedSubjects.map(item => `<option value="${this.escape(item.id)}" ${String(item.id) === String(resource.subject_id || '') ? 'selected' : ''}>${this.escape(item.name)}</option>`).join('')}
          </select></label>
        </div>
        <div class="dl-form-row">
          <label class="form-group"><span>Academic year</span><select class="select-field" name="academic_year_id" id="dl-edit-year">
            <option value="">Not applicable</option>${context.years.map(item => `<option value="${this.escape(item.id)}" ${String(item.id) === String(resource.academic_year_id || '') ? 'selected' : ''}>${this.escape(item.name)}</option>`).join('')}
          </select></label>
          <label class="form-group"><span>Term</span><select class="select-field" name="term_id" id="dl-edit-term">
            <option value="">Not applicable</option>${terms.map(item => `<option value="${this.escape(item.id)}" ${String(item.id) === String(resource.term_id || '') ? 'selected' : ''}>${this.escape(item.name)}</option>`).join('')}
          </select></label>
        </div>
        <label class="form-group"><span>Assessment type</span><select class="select-field" name="assessment_type_id">
          <option value="">Not applicable</option>${context.assessmentTypes.map(item => `<option value="${this.escape(item.id)}" ${String(item.id) === String(resource.assessment_type_id || '') ? 'selected' : ''}>${this.escape(item.name)}</option>`).join('')}
        </select></label>
        <div class="dl-form-row">
          <label class="form-group"><span>Unit</span><input class="input-field" name="unit" maxlength="160" value="${this.escape(resource.unit || '')}"></label>
          <label class="form-group"><span>Topic</span><input class="input-field" name="topic" maxlength="160" value="${this.escape(resource.topic || '')}"></label>
        </div>
        <label class="form-group"><span>Description</span><textarea class="input-field" name="description" maxlength="2000" rows="3">${this.escape(resource.description || '')}</textarea></label>
        <div class="dl-edit-actions"><button class="btn btn-primary" type="submit">Save changes</button><button class="btn btn-outline" type="button" data-dl-edit-close>Cancel</button></div>
      </form>`;
    const form = dialog.querySelector('#dl-edit-form');
    const yearSelect = dialog.querySelector('#dl-edit-year');
    const termSelect = dialog.querySelector('#dl-edit-term');
    yearSelect.addEventListener('change', () => {
      const yearId = yearSelect.value;
      const nextTerms = context.terms.filter(item => !yearId || String(item.academic_year_id) === yearId);
      termSelect.innerHTML = '<option value="">Not applicable</option>' + nextTerms.map(item =>
        `<option value="${this.escape(item.id)}">${this.escape(item.name)}</option>`).join('');
    });
    dialog.querySelectorAll('[data-dl-edit-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const values = new FormData(form);
      const save = form.querySelector('[type="submit"]');
      save.disabled = true;
      try {
        const { error } = await sbClient.from('digital_library_resources').update({
          title: String(values.get('title') || '').trim(),
          description: String(values.get('description') || '').trim(),
          resource_type: values.get('resource_type'),
          subject_id: String(values.get('subject_id') || '') || null,
          academic_year_id: String(values.get('academic_year_id') || '') || null,
          term_id: String(values.get('term_id') || '') || null,
          assessment_type_id: String(values.get('assessment_type_id') || '') || null,
          unit: String(values.get('unit') || '').trim() || null,
          topic: String(values.get('topic') || '').trim() || null
        }).eq('id', resource.id);
        if (error) throw error;
        dialog.close();
        Utils.toast('Resource details updated.', 'success');
        await this.renderTeacher();
      } catch (error) {
        console.error('[DigitalLibrary] Resource update failed:', error);
        Utils.toast(`Could not update the resource: ${error.message || 'Unknown error'}`, 'error');
        save.disabled = false;
      }
    });
    dialog.showModal();
  },

  pickReplacement(resource) {
    if (!resource.storage_path) {
      return Utils.toast('This resource has no uploaded file to replace. Edit its details to update the link.', 'error');
    }
    if (!window.confirm(`Choose a new file to replace "${resource.file_name}"?`)) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp,.mp3,.wav,.mp4,.webm,.zip';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.replaceFile(resource, file);
    }, { once: true });
    input.click();
  },

  async replaceFile(resource, file) {
    const mimeType = this.mimeType(file);
    if (!file.size) return Utils.toast('Choose a non-empty file to replace this resource.', 'error');
    if (file.size > this.maxFileBytes) return Utils.toast('The maximum file size is 25 MB.', 'error');
    if (!this.allowedMimeTypes().has(mimeType)) return Utils.toast('Choose a supported educational file type.', 'error');
    const safeName = file.name.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'resource';
    const pathParts = String(resource.storage_path).split('/');
    if (pathParts.length < 4) return Utils.toast('This resource uses an old file path. Delete and re-upload it to replace the file.', 'error');
    const replacementName = `${this.uuid()}_${safeName}`;
    const path = `${pathParts[0]}/${pathParts[1]}/${Auth.currentUser.id}/${resource.id}/${replacementName}`;
    try {
      const uploadResult = await sbClient.storage.from(this.bucket).upload(path, file, {
        cacheControl: '3600', contentType: mimeType, upsert: false
      });
      if (uploadResult.error) throw uploadResult.error;
      const updateResult = await sbClient.from('digital_library_resources').update({
        storage_path: path, file_name: safeName, mime_type: mimeType, file_size: file.size
      }).eq('id', resource.id);
      if (updateResult.error) {
        const cleanup = await sbClient.storage.from(this.bucket).remove([path]);
        if (cleanup.error) console.error('[DigitalLibrary] Replacement cleanup failed:', cleanup.error);
        throw updateResult.error;
      }
      const removeOld = await sbClient.storage.from(this.bucket).remove([resource.storage_path]);
      if (removeOld.error) {
        console.error('[DigitalLibrary] New file saved, but old file cleanup failed:', removeOld.error);
        Utils.toast(`File replaced, but the old file could not be removed: ${removeOld.error.message}`, 'warning');
      } else Utils.toast('Resource file replaced.', 'success');
      await this.renderTeacher();
    } catch (error) {
      console.error('[DigitalLibrary] File replacement failed:', error);
      Utils.toast(`Could not replace the file: ${error.message || 'Unknown error'}`, 'error');
    }
  },

  async deleteResource(resource) {
    if (!window.confirm(`Delete "${resource.title}" from the public library?`)) return;
    try {
      if (resource.storage_path) {
        const removed = await sbClient.storage.from(this.bucket).remove([resource.storage_path]);
        if (removed.error) throw removed.error;
      }
      const deleted = await sbClient.from('digital_library_resources')
        .delete().eq('id', resource.id).eq('uploaded_by', Auth.currentUser.id);
      if (deleted.error) throw deleted.error;
      Utils.toast('Resource deleted.', 'success');
      await this.renderTeacher();
    } catch (error) {
      console.error('[DigitalLibrary] Delete failed:', error);
      Utils.toast(`Could not delete the resource: ${error.message || 'Unknown error'}`, 'error');
    }
  },

  async renderDos() {
    setHeader('Digital Library', 'Review and manage resources in your DOS education-level scope');
    setContent(Utils.loading());
    if (!Auth.isAdmin()) {
      setContent(Utils.errorCard('DOS access required', 'Resource review and library management are restricted to DOS accounts.'));
      return;
    }
    try {
      const [statsResult, aiStatsResult, settingsResult, resourcesResult, classesResult, yearsResult, termsResult] = await Promise.all([
        sbClient.rpc('rms_library_dos_stats'),
        sbClient.rpc('rms_library_ai_stats'),
        sbClient.from('digital_library_settings').select('ai_enabled').eq('id', true).single(),
        sbClient.from('digital_library_resources').select('id,title,description,resource_type,class_id,subject_id,class_name,subject_name,education_level,academic_year_id,academic_year_name,term_id,term_name,assessment_type_id,assessment_type_name,topic,unit,file_name,mime_type,file_size,uploader_name,teacher_id,status,return_comment,created_at,view_count,download_count,storage_path,resource_url,ai_enabled').order('created_at', { ascending: false }).range(0, this.pageSize - 1),
        sbClient.from('classes').select('id,name,level,education_level').eq('status', 'active').order('name'),
        sbClient.from('academic_years').select('id,name').order('name', { ascending: false }),
        sbClient.from('terms').select('id,name,academic_year_id,term_no').order('term_no')
      ]);
      for (const result of [statsResult, aiStatsResult, settingsResult, resourcesResult, classesResult, yearsResult, termsResult]) {
        if (result.error) throw result.error;
      }
      this.state.dosData = {
        stats: statsResult.data || {},
        aiStats: aiStatsResult.data || {},
        aiEnabled: settingsResult.data?.ai_enabled === true,
        resources: resourcesResult.data || [],
        classes: classesResult.data || [],
        years: yearsResult.data || [],
        terms: termsResult.data || [],
        offset: (resourcesResult.data || []).length,
        hasMore: (resourcesResult.data || []).length === this.pageSize,
        loadingMore: false
      };
      await this.prepareResourceUrls(this.state.dosData.resources);
      this.renderDosPage();
    } catch (error) {
      console.error('[DigitalLibrary] DOS library failed to load:', error);
      setContent(Utils.errorCard('Could not load resource management', this.escape(error.message || 'Please try again.')));
    }
  },

  renderDosPage() {
    const data = this.state.dosData;
    const resources = data.resources;
    const teachers = [...new Map(resources.map(item => [String(item.teacher_id), item.uploader_name])).entries()];
    const years = data.years.map(item => [String(item.id), item.name]);
    const terms = data.terms.map(item => [String(item.id), item.name]);
    setContent(`
      <section class="dl-teacher-page">
        <div class="dl-teacher-heading"><div><span class="dl-eyebrow"><i data-lucide="shield-check"></i> DOS Resource Management</span><h2>Library review and reporting</h2><p>Teacher uploads are immediately public. You can review, return, or archive resources within your education-level scope.</p></div></div>
        <div class="dl-stat-grid dl-dos-stat-grid">
          ${this.teacherStat('Total resources', data.stats.total_resources || 0, 'library-big')}
          ${this.teacherStat('Lesson plans', data.stats.lesson_plans || 0, 'notebook-tabs')}
          ${this.teacherStat('Pending reviews', data.stats.pending_reviews || 0, 'clock-3')}
          ${this.teacherStat('Published', data.stats.published_resources || 0, 'globe-2')}
          ${this.teacherStat('Contributing teachers', data.stats.teachers_contributing || 0, 'users')}
          ${this.teacherStat('Downloads', data.stats.total_downloads || 0, 'download')}
        </div>
        <section class="card dl-ai-dos-panel">
          <div><span class="dl-eyebrow"><i data-lucide="sparkles"></i> AI Learning Assistant</span><h3>AI access and usage</h3><p>AI only uses resources each learner is authorized to access and never stores the learner's question.</p></div>
          <label class="dl-ai-toggle"><input id="dl-ai-enabled" type="checkbox" ${data.aiEnabled ? 'checked' : ''}><span>Enable RMS AI for the public library</span></label>
          <div class="dl-ai-usage-stats">
            ${this.teacherStat('Questions today', data.aiStats.questions_today || 0, 'message-square')}
            ${this.teacherStat('Questions this month', data.aiStats.questions_this_month || 0, 'messages-square')}
            ${this.teacherStat('Most asked subject', data.aiStats.most_asked_subject || '—', 'book-open')}
            ${this.teacherStat('Most asked class', data.aiStats.most_asked_class || '—', 'graduation-cap')}
            ${this.teacherStat('Most used resource', data.aiStats.most_used_resource || '—', 'file-text')}
          </div>
        </section>
        <section class="card dl-dos-panel">
          <div class="dl-toolbar dl-dos-filters">
            <label class="dl-search"><i data-lucide="search"></i><span class="sr-only">Search loaded resources</span><input id="dl-dos-search" type="search" placeholder="Search loaded resources..." oninput="DigitalLibrary.filterDosResources()"></label>
            <select id="dl-dos-class" onchange="DigitalLibrary.filterDosResources()"><option value="">All classes</option>${data.classes.map(item => `<option value="${this.escape(item.id)}">${this.escape(this.classLabel(item))}</option>`).join('')}</select>
            <select id="dl-dos-teacher" onchange="DigitalLibrary.filterDosResources()"><option value="">All teachers</option>${teachers.map(([id, name]) => `<option value="${this.escape(id)}">${this.escape(name || 'Teacher')}</option>`).join('')}</select>
            <select id="dl-dos-year" onchange="DigitalLibrary.filterDosResources()"><option value="">All years</option>${years.map(([id, name]) => `<option value="${this.escape(id)}">${this.escape(name)}</option>`).join('')}</select>
            <select id="dl-dos-term" onchange="DigitalLibrary.filterDosResources()"><option value="">All terms</option>${terms.map(([id, name]) => `<option value="${this.escape(id)}">${this.escape(name)}</option>`).join('')}</select>
            <select id="dl-dos-type" onchange="DigitalLibrary.filterDosResources()"><option value="">All categories</option>${this.resourceTypes.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select>
            <select id="dl-dos-status" onchange="DigitalLibrary.filterDosResources()"><option value="">All statuses</option><option value="submitted">Pending review</option><option value="returned">Returned</option><option value="published">Published</option><option value="approved">Approved</option><option value="archived">Archived</option></select>
          </div>
          <div id="dl-dos-list" class="dl-resource-grid dl-managed-resource-grid"></div>
          <div id="dl-dos-more" class="dl-load-more"></div>
        </section>
      </section>`);
    document.getElementById('dl-ai-enabled')?.addEventListener('change', event => {
      this.setAIAvailability(event.currentTarget.checked);
    });
    this.filterDosResources();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async setAIAvailability(enabled) {
    const toggle = document.getElementById('dl-ai-enabled');
    if (toggle) toggle.disabled = true;
    try {
      const { error } = await sbClient.from('digital_library_settings')
        .update({ ai_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', true);
      if (error) throw error;
      this.state.dosData.aiEnabled = enabled;
      Utils.toast(`RMS AI ${enabled ? 'enabled' : 'disabled'}.`, 'success');
    } catch (error) {
      console.error('[DigitalLibrary] Could not update RMS AI availability:', error);
      if (toggle) toggle.checked = this.state.dosData.aiEnabled;
      Utils.toast(`Could not update RMS AI availability: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      if (toggle) toggle.disabled = false;
    }
  },

  filterDosResources() {
    const data = this.state.dosData;
    if (!data) return;
    const search = (document.getElementById('dl-dos-search')?.value || '').trim().toLowerCase();
    const classId = document.getElementById('dl-dos-class')?.value || '';
    const teacherId = document.getElementById('dl-dos-teacher')?.value || '';
    const yearId = document.getElementById('dl-dos-year')?.value || '';
    const termId = document.getElementById('dl-dos-term')?.value || '';
    const resourceType = document.getElementById('dl-dos-type')?.value || '';
    const status = document.getElementById('dl-dos-status')?.value || '';
    const rows = data.resources.filter(item => {
      const text = `${item.title} ${item.description} ${item.topic || ''} ${item.unit || ''} ${item.class_name} ${item.subject_name} ${item.uploader_name} ${item.file_name}`.toLowerCase();
      return (!search || text.includes(search))
        && (!classId || String(item.class_id) === classId)
        && (!teacherId || String(item.teacher_id) === teacherId)
        && (!yearId || String(item.academic_year_id) === yearId)
        && (!termId || String(item.term_id) === termId)
        && (!resourceType || item.resource_type === resourceType)
        && (!status || item.status === status);
    });
    const list = document.getElementById('dl-dos-list');
    if (!list) return;
    list.innerHTML = rows.length ? rows.map(item => this.dosResourceCard(item)).join('')
      : '<div class="dl-empty">No loaded resources match these filters. Load more to include older resources.</div>';
    list.querySelectorAll('[data-dl-ai-resource]').forEach(input => {
      input.addEventListener('change', () => this.setResourceAIAvailability(input.dataset.dlAiResource, input.checked));
    });
    list.querySelectorAll('[data-dl-review]').forEach(button => button.addEventListener('click', () => {
      const resource = rows.find(item => String(item.id) === button.dataset.dlReview);
      if (resource) this.changeResourceStatus(resource, button.dataset.dlAction);
    }));
    list.querySelectorAll('[data-dl-dos-delete]').forEach(button => button.addEventListener('click', () => {
      const resource = rows.find(item => String(item.id) === button.dataset.dlDosDelete);
      if (resource) this.deleteDosResource(resource);
    }));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  dosResourceCard(item) {
    const url = item.resource_url
      ? this.safeExternalUrl(item.resource_url)
      : this.state.signedUrls.get(item.storage_path);
    return this.managedResourceCard(item, url, 'dos');
  },

  async setResourceAIAvailability(resourceId, enabled) {
    const resource = this.state.dosData.resources.find(item => String(item.id) === String(resourceId));
    if (!resource) return;
    try {
      const { error } = await sbClient.from('digital_library_resources')
        .update({ ai_enabled: enabled })
        .eq('id', resourceId);
      if (error) throw error;
      resource.ai_enabled = enabled;
      Utils.toast(`RMS AI access ${enabled ? 'enabled' : 'disabled'} for this resource.`, 'success');
    } catch (error) {
      console.error('[DigitalLibrary] Could not update resource AI access:', error);
      this.filterDosResources();
      Utils.toast(`Could not update resource AI access: ${error.message || 'Unknown error'}`, 'error');
    }
  },

  async changeResourceStatus(resource, status) {
    let returnComment = null;
    if (status === 'returned') {
      returnComment = window.prompt('Explain what the teacher should correct:');
      if (returnComment == null) return;
      if (!returnComment.trim()) return Utils.toast('A short return comment is required.', 'error');
    }
    try {
      const { error } = await sbClient.from('digital_library_resources').update({
        status,
        ...(status === 'returned' ? { return_comment: returnComment.trim() } : {})
      }).eq('id', resource.id);
      if (error) throw error;
      Utils.toast(`Resource ${this.statusLabel(status).toLowerCase()}.`, 'success');
      await this.renderDos();
    } catch (error) {
      console.error('[DigitalLibrary] Resource review action failed:', error);
      Utils.toast(`Could not update resource status: ${error.message || 'Unknown error'}`, 'error');
    }
  },

  async deleteDosResource(resource) {
    if (!window.confirm(`Delete "${resource.title}" from the library?`)) return;
    try {
      if (resource.storage_path) {
        const removed = await sbClient.storage.from(this.bucket).remove([resource.storage_path]);
        if (removed.error) throw removed.error;
      }
      const { error } = await sbClient.from('digital_library_resources').delete().eq('id', resource.id);
      if (error) throw error;
      Utils.toast('Resource deleted.', 'success');
      await this.renderDos();
    } catch (error) {
      console.error('[DigitalLibrary] DOS delete failed:', error);
      Utils.toast(`Could not delete resource: ${error.message || 'Unknown error'}`, 'error');
    }
  },

};

if (typeof document !== 'undefined' && document.body?.dataset.page === 'digital-library') {
  DigitalLibrary.initPublic();
}
