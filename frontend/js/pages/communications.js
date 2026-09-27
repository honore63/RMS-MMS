const Communications = {
  announcementFilter: 'all',
  announcementSearch: '',
  messageFilter: 'all',
  messageSearch: '',
  selectedThread: null,
  announcementDraftId: null,
  teacherCompose: false,
  _eventsBound: false,

  uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const value = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
      return (char === 'x' ? value : (value & 3) | 8).toString(16);
    });
  },

  async query(table, select = '*', filters = {}, order = null) {
    let request = sbClient.from(table).select(select);
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) request = Array.isArray(value) ? request.in(key, value) : request.eq(key, value);
    });
    if (order) request = request.order(order.column, { ascending: order.ascending ?? false });
    const { data, error } = await request;
    if (error) throw error;
    return data || [];
  },

  async refreshBadges() {
    const userId = Auth.currentUser?.id;
    if (!userId || !Auth.isAdmin()) return;
    try {
      const [inboxCount, unreadAnnouncements] = await Promise.all([
        DB.count('messages', { recipient_user_id: userId, is_read: false }),
        DB.count('notifications', { sender_user_id: userId, entity_type: 'announcement', is_read: false })
      ]);
      this.setBadge('communication-inbox-badge', inboxCount);
      this.setBadge('communication-announcement-badge', unreadAnnouncements);
    } catch (error) {
      console.warn('[Communications] badge refresh failed:', error);
    }
  },

  setBadge(id, count) {
    const ids = id === 'communication-announcement-badge' ? [id, 'announcement-badge']
      : id === 'communication-inbox-badge' ? [id, 'message-badge'] : [id];
    ids.forEach(badgeId => {
      const badge = document.getElementById(badgeId);
      if (!badge) return;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = count ? 'inline-flex' : 'none';
    });
  },

  scopedLevel() {
    if (!Scope?.isScoped?.()) throw new Error('This communication action requires a level-scoped DOS account.');
    return Scope.isPrimary() ? 'primary' : 'secondary';
  },

  formatDate(value) {
    if (!value) return 'Unscheduled';
    return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  },

  localDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  },

  statusForAnnouncement(row) {
    if (row.status !== 'active') return row.status;
    if (row.expires_at && new Date(row.expires_at) <= new Date()) return 'expired';
    if (row.published_at && new Date(row.published_at) > new Date()) return 'scheduled';
    return 'published';
  },

  async renderAnnouncements() {
    setHeader('Announcements', 'Create and manage level-specific teacher communications');
    setContent(Utils.loading());
    try {
      this.scopedLevel();
      const [rows, teachers] = await Promise.all([
        this.query('announcements', '*', {}, { column: 'created_at' }),
        this.loadScopedTeachers()
      ]);
      const scopedRows = rows.filter(row => row.sender_user_id === Auth.currentUser.id);
      const filtered = scopedRows.filter(row => {
        const status = this.statusForAnnouncement(row);
        const matchesStatus = this.announcementFilter === 'all'
          || (this.announcementFilter === 'published' && status === 'published')
          || (this.announcementFilter === 'scheduled' && status === 'scheduled')
          || (this.announcementFilter === 'archived' && ['archived', 'expired'].includes(status));
        const text = `${row.title} ${row.message} ${row.category}`.toLowerCase();
        return matchesStatus && text.includes(this.announcementSearch.toLowerCase());
      });
      const draft = this.announcementDraftId ? scopedRows.find(row => row.id === this.announcementDraftId) : null;
      const teacherOptions = teachers.map(teacher =>
        `<option value="${Utils.escapeHtml(teacher.user_id)}" ${draft?.target_user_ids?.includes(teacher.user_id) ? 'selected' : ''}>${Utils.escapeHtml(teacher.full_name || teacher.email || 'Teacher')}</option>`
      ).join('');
      setContent(`
        <section class="communication-page">
          <div class="communication-toolbar">
            <input id="announcement-search" class="input-field communication-search" type="search" placeholder="Search announcements" value="${Utils.escapeHtml(this.announcementSearch)}">
            <div class="communication-filters" role="group" aria-label="Filter announcements">
              ${[['all','All'],['published','Published'],['scheduled','Scheduled'],['archived','Archived']].map(([key,label]) => `<button class="communication-filter ${this.announcementFilter === key ? 'active' : ''}" type="button" data-announcement-filter="${key}">${label}</button>`).join('')}
            </div>
            <button class="btn btn-primary" type="button" id="announcement-new"><i data-lucide="plus"></i> New announcement</button>
          </div>
          ${this.announcementDraftId !== null ? this.announcementForm(draft, teacherOptions) : ''}
          <div class="communication-page" id="announcement-list">
            ${filtered.map(row => this.announcementCard(row)).join('') || Utils.empty('No announcements match this view.', 'megaphone')}
          </div>
        </section>`);
      this.bindAnnouncementControls();
      if (typeof lucide !== 'undefined') lucide.createIcons();
      this.refreshBadges();
    } catch (error) {
      this.renderError(error);
    }
  },

  async loadScopedTeachers() {
    const [teachers, assignments, classes] = await Promise.all([
      this.query('teachers', 'id,user_id,full_name,email,status'),
      this.query('teacher_assignments', 'teacher_id,class_id'),
      this.query('classes', 'id,education_level')
    ]);
    const classMap = new Map(classes.map(row => [String(row.id), row]));
    const inScope = teachers.filter(teacher => {
      const own = assignments.filter(row => String(row.teacher_id) === String(teacher.id) && row.class_id);
      return !own.length || own.some(row => Scope.matchesClass(classMap.get(String(row.class_id))));
    });
    return inScope.filter(row => row.status !== 'inactive' && row.user_id);
  },

  announcementForm(row, teacherOptions) {
    const audience = row?.audience_type === 'specific_teacher' ? 'specific_teacher' : 'all';
    return `<form class="communication-form" id="announcement-form">
      <h3>${row ? 'Edit announcement' : 'New announcement'}</h3>
      <div class="communication-form-grid">
        <div class="form-group wide"><label for="announcement-title">Title</label><input id="announcement-title" class="input-field" maxlength="180" required value="${Utils.escapeHtml(row?.title || '')}"></div>
        <div class="form-group"><label for="announcement-category">Category</label><select id="announcement-category" class="select-field">
          ${['general','timetable','meeting','examination','assessment','academic','urgent','training','cpd','administrative','other'].map(value => `<option value="${value}" ${row?.category === value ? 'selected' : ''}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label for="announcement-priority">Priority</label><select id="announcement-priority" class="select-field">
          ${['normal','important','urgent'].map(value => `<option value="${value}" ${row?.priority === value ? 'selected' : ''}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label for="announcement-audience">Audience</label><select id="announcement-audience" class="select-field">
          <option value="all" ${audience === 'all' ? 'selected' : ''}>All teachers in my level</option>
          <option value="specific_teacher" ${audience === 'specific_teacher' ? 'selected' : ''}>One teacher</option>
        </select></div>
        <div class="form-group" id="announcement-teacher-group" style="display:${audience === 'specific_teacher' ? 'block' : 'none'}"><label for="announcement-teacher">Teacher</label><select id="announcement-teacher" class="select-field"><option value="">Select teacher</option>${teacherOptions}</select></div>
        <div class="form-group"><label for="announcement-publish-at">Publish time</label><input id="announcement-publish-at" class="input-field" type="datetime-local" value="${this.localDateTime(row?.published_at)}"><small class="text-muted">Leave empty to publish now.</small></div>
        <div class="form-group"><label for="announcement-expires-at">Expiry (optional)</label><input id="announcement-expires-at" class="input-field" type="datetime-local" value="${this.localDateTime(row?.expires_at)}"></div>
        <div class="form-group wide"><label for="announcement-message">Announcement</label><textarea id="announcement-message" class="input-field" maxlength="10000" required>${Utils.escapeHtml(row?.message || '')}</textarea></div>
      </div>
      <div class="communication-actions"><button class="btn btn-primary" type="submit"><i data-lucide="send"></i> Save announcement</button><button class="btn btn-outline" type="button" id="announcement-cancel">Cancel</button></div>
    </form>`;
  },

  announcementCard(row) {
    const status = this.statusForAnnouncement(row);
    const target = row.audience_type === 'specific_teacher' ? 'One teacher' : 'All teachers in level';
    return `<article class="communication-card">
      <div class="communication-card-head"><div><h3 class="communication-card-title">${Utils.escapeHtml(row.title)}</h3><div class="communication-meta"><span>${Utils.escapeHtml(row.category)}</span><span>${target}</span><span>${status === 'scheduled' ? 'Publishes' : 'Published'} ${this.formatDate(row.published_at)}</span></div></div>
        <div class="communication-actions"><span class="communication-status ${status} ${row.priority}">${status}</span><span class="communication-status ${row.priority}">${row.priority}</span></div></div>
      <div class="communication-copy">${Utils.escapeHtml(row.message)}</div>
      ${row.status !== 'archived' ? `<div class="communication-actions"><button class="btn btn-sm btn-outline" type="button" data-announcement-edit="${row.id}"><i data-lucide="pencil"></i> Edit</button><button class="btn btn-sm btn-outline" type="button" data-announcement-archive="${row.id}"><i data-lucide="archive"></i> Archive</button></div>` : ''}
    </article>`;
  },

  bindAnnouncementControls() {
    document.getElementById('announcement-new')?.addEventListener('click', () => {
      this.announcementDraftId = '';
      this.renderAnnouncements();
    });
    document.querySelectorAll('[data-announcement-filter]').forEach(button => button.addEventListener('click', () => {
      this.announcementFilter = button.dataset.announcementFilter;
      this.renderAnnouncements();
    }));
    document.getElementById('announcement-search')?.addEventListener('input', event => {
      this.announcementSearch = event.target.value;
      this.updateAnnouncementList();
    });
    document.getElementById('announcement-audience')?.addEventListener('change', event => {
      document.getElementById('announcement-teacher-group').style.display = event.target.value === 'specific_teacher' ? 'block' : 'none';
    });
    document.getElementById('announcement-form')?.addEventListener('submit', event => this.saveAnnouncement(event));
    document.getElementById('announcement-cancel')?.addEventListener('click', () => {
      this.announcementDraftId = null;
      this.renderAnnouncements();
    });
    document.querySelectorAll('[data-announcement-edit]').forEach(button => button.addEventListener('click', () => {
      this.announcementDraftId = button.dataset.announcementEdit;
      this.renderAnnouncements();
    }));
    document.querySelectorAll('[data-announcement-archive]').forEach(button => button.addEventListener('click', () => this.archiveAnnouncement(button.dataset.announcementArchive)));
  },

  async updateAnnouncementList() {
    const host = document.getElementById('announcement-list');
    if (!host) return;
    const rows = await this.query('announcements', '*', {}, { column: 'created_at' });
    const visible = rows.filter(row => row.sender_user_id === Auth.currentUser.id).filter(row => {
      const status = this.statusForAnnouncement(row);
      const matchFilter = this.announcementFilter === 'all'
        || (this.announcementFilter === 'published' && status === 'published')
        || (this.announcementFilter === 'scheduled' && status === 'scheduled')
        || (this.announcementFilter === 'archived' && ['archived','expired'].includes(status));
      return matchFilter && `${row.title} ${row.message} ${row.category}`.toLowerCase().includes(this.announcementSearch.toLowerCase());
    });
    host.innerHTML = visible.map(row => this.announcementCard(row)).join('') || Utils.empty('No announcements match this view.', 'megaphone');
    host.querySelectorAll('[data-announcement-edit]').forEach(button => button.addEventListener('click', () => {
      this.announcementDraftId = button.dataset.announcementEdit;
      this.renderAnnouncements();
    }));
    host.querySelectorAll('[data-announcement-archive]').forEach(button => button.addEventListener('click', () => this.archiveAnnouncement(button.dataset.announcementArchive)));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async saveAnnouncement(event) {
    event.preventDefault();
    try {
      const level = this.scopedLevel();
      const audience = document.getElementById('announcement-audience').value;
      const selectedTeacher = document.getElementById('announcement-teacher').value;
      if (audience === 'specific_teacher' && !selectedTeacher) throw new Error('Choose a teacher for this announcement.');
      const publishInput = document.getElementById('announcement-publish-at').value;
      const expiryInput = document.getElementById('announcement-expires-at').value;
      const row = {
        sender_user_id: Auth.currentUser.id,
        title: document.getElementById('announcement-title').value.trim(),
        message: document.getElementById('announcement-message').value.trim(),
        category: document.getElementById('announcement-category').value,
        priority: document.getElementById('announcement-priority').value,
        audience_type: audience,
        education_level: level,
        target_user_ids: audience === 'specific_teacher' ? [selectedTeacher] : [],
        published_at: publishInput ? new Date(publishInput).toISOString() : new Date().toISOString(),
        expires_at: expiryInput ? new Date(expiryInput).toISOString() : null,
        status: 'active',
        updated_at: new Date().toISOString()
      };
      if (!row.title || !row.message) throw new Error('A title and announcement are required.');
      if (row.expires_at && new Date(row.expires_at) <= new Date(row.published_at)) {
        throw new Error('Expiry must be later than the publish time.');
      }
      const id = this.announcementDraftId;
      const { error } = id
        ? await sbClient.from('announcements').update(row).eq('id', id)
        : await sbClient.from('announcements').insert(row);
      if (error) throw error;
      DB.invalidate('announcements');
      DB.invalidate('notifications');
      this.announcementDraftId = null;
      Utils.toast(id ? 'Announcement updated.' : 'Announcement saved.', 'success');
      await this.renderAnnouncements();
    } catch (error) {
      Utils.toast(error.message || 'Could not save announcement.', 'error');
    }
  },

  async archiveAnnouncement(id) {
    if (!window.confirm('Archive this announcement?')) return;
    try {
      const { error } = await sbClient.from('announcements').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      DB.invalidate('announcements');
      await this.renderAnnouncements();
    } catch (error) {
      Utils.toast(error.message || 'Could not archive announcement.', 'error');
    }
  },

  async renderDosInbox() {
    setHeader('Teacher Inbox', 'Read and reply to messages from teachers');
    setContent(Utils.loading());
    try {
      this.scopedLevel();
      const [rows, classes] = await Promise.all([
        this.loadMyMessages(),
        this.query('classes', 'id,name,level,education_level')
      ]);
      this.classMap = new Map(classes.map(row => [String(row.id), row]));
      this.renderThreadLayout(rows, 'dos');
      this.refreshBadges();
    } catch (error) {
      this.renderError(error);
    }
  },

  async loadMyMessages() {
    const userId = Auth.currentUser.id;
    const { data, error } = await sbClient.from('messages').select('*')
      .or(`sender_user_id.eq.${userId},recipient_user_id.eq.${userId}`)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  makeThreads(rows) {
    const map = new Map();
    rows.forEach(row => {
      if (!map.has(row.thread_id)) map.set(row.thread_id, []);
      map.get(row.thread_id).push(row);
    });
    return [...map.entries()].map(([id, messages]) => ({ id, messages, latest: messages[messages.length - 1] }))
      .sort((a, b) => String(b.latest.created_at).localeCompare(String(a.latest.created_at)));
  },

  renderThreadLayout(rows, mode) {
    this._rows = rows;
    const threads = this.makeThreads(rows);
    if (this.selectedThread && !threads.some(thread => thread.id === this.selectedThread)) this.selectedThread = null;
    const query = this.messageSearch.toLowerCase();
    const visible = threads.filter(thread => {
      const unread = thread.messages.some(message => message.recipient_user_id === Auth.currentUser.id && !message.is_read);
      const text = thread.messages.map(message => `${message.subject} ${message.body} ${message.sender_name} ${message.sender_email}`).join(' ').toLowerCase();
      const statusMatch = this.messageFilter === 'all' || (this.messageFilter === 'unread' && unread) || (this.messageFilter === 'read' && !unread);
      return statusMatch && text.includes(query);
    });
    const selected = threads.find(thread => thread.id === this.selectedThread);
    const filterControls = `<div class="communication-toolbar"><input class="input-field communication-search" id="message-search" type="search" placeholder="Search sender, subject, or message" value="${Utils.escapeHtml(this.messageSearch)}"><select class="select-field" id="message-filter" style="width:auto"><option value="all" ${this.messageFilter === 'all' ? 'selected' : ''}>All messages</option><option value="unread" ${this.messageFilter === 'unread' ? 'selected' : ''}>Unread</option><option value="read" ${this.messageFilter === 'read' ? 'selected' : ''}>Read</option></select>${mode === 'teacher' ? '<button class="btn btn-primary" type="button" id="teacher-new-message"><i data-lucide="square-pen"></i> New message</button>' : ''}</div>`;
    const list = visible.map(thread => {
      const incoming = thread.messages.find(message => message.sender_user_id !== Auth.currentUser.id) || thread.messages[0];
      const unread = thread.messages.some(message => message.recipient_user_id === Auth.currentUser.id && !message.is_read);
      return `<button class="communication-thread-item ${thread.id === this.selectedThread ? 'active' : ''} ${unread ? 'unread' : ''}" type="button" data-thread-id="${Utils.escapeHtml(thread.id)}">
        <span class="communication-thread-top"><span class="communication-thread-subject">${Utils.escapeHtml(thread.latest.subject)}</span>${unread ? '<span class="communication-unread-dot" aria-label="Unread"></span>' : ''}</span>
        <span class="communication-meta">${Utils.escapeHtml(incoming.sender_name || 'Teacher')} · ${this.formatDate(thread.latest.created_at)}</span>
        <span class="communication-thread-preview">${Utils.escapeHtml(thread.latest.body)}</span>
      </button>`;
    }).join('') || '<div class="communication-empty">No messages found.</div>';
    const threadContent = selected ? this.renderSelectedThread(selected, mode) : '<div class="communication-empty">Select a conversation to view its messages.</div>';
    setContent(`<section class="communication-page">${filterControls}<div class="communication-layout"><div class="communication-thread-list">${list}</div><div class="communication-thread-main">${threadContent}</div></div></section>`);
    document.getElementById('message-search')?.addEventListener('input', event => {
      this.messageSearch = event.target.value;
      this.renderThreadLayout(this._rows, mode);
      const input = document.getElementById('message-search');
      input?.focus();
      input?.setSelectionRange(this.messageSearch.length, this.messageSearch.length);
    });
    document.getElementById('message-filter')?.addEventListener('change', event => {
      this.messageFilter = event.target.value;
      this.renderThreadLayout(this._rows, mode);
    });
    document.getElementById('teacher-new-message')?.addEventListener('click', () => {
      this.selectedThread = null;
      this.showTeacherComposer(this._rows);
    });
    document.querySelectorAll('[data-thread-id]').forEach(button => button.addEventListener('click', () => this.openThread(button.dataset.threadId, mode)));
    document.getElementById('thread-mark-unread')?.addEventListener('click', () => this.markThreadUnread(selected, mode));
    document.getElementById('message-reply-form')?.addEventListener('submit', event => this.reply(event, selected));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  renderSelectedThread(thread, mode) {
    const firstInbound = thread.messages.find(message => message.sender_user_id !== Auth.currentUser.id) || thread.messages[0];
    const className = this.className(firstInbound.class_id);
    const messageBubbles = thread.messages.map(message => `<article class="communication-message ${message.sender_user_id === Auth.currentUser.id ? 'mine' : ''}">
      <div class="communication-message-meta"><span>${Utils.escapeHtml(message.sender_name || (message.sender_user_id === Auth.currentUser.id ? 'You' : 'Teacher'))}${message.sender_email ? ` · ${Utils.escapeHtml(message.sender_email)}` : ''}</span><time>${this.formatDate(message.created_at)}</time></div>
      <div class="communication-message-body">${Utils.escapeHtml(message.body)}</div>
    </article>`).join('');
    const canReply = mode === 'dos' || mode === 'teacher';
    return `<header class="communication-thread-header"><h3>${Utils.escapeHtml(thread.latest.subject)}</h3><div class="communication-meta"><span>${Utils.escapeHtml(firstInbound.sender_name || 'Teacher')}</span><span>${Utils.escapeHtml(firstInbound.sender_email || '')}</span><span>${Utils.escapeHtml(className)}</span></div><div class="communication-actions" style="margin-top:10px"><button class="btn btn-sm btn-outline" type="button" id="thread-mark-unread"><i data-lucide="mail"></i> Mark unread</button></div></header>
      <div class="communication-thread-messages">${messageBubbles}</div>
      ${canReply ? `<form class="communication-reply" id="message-reply-form"><label for="message-reply">Reply</label><textarea id="message-reply" class="input-field" maxlength="10000" required placeholder="Write a reply"></textarea><div class="communication-actions"><button class="btn btn-primary" type="submit"><i data-lucide="send"></i> Send reply</button></div></form>` : ''}`;
  },

  className(classId) {
    return this.classMap?.get(String(classId))?.name || this.classMap?.get(String(classId))?.level || 'Class';
  },

  async openThread(threadId, mode) {
    this.selectedThread = threadId;
    const unread = this._rows.filter(row => row.thread_id === threadId && row.recipient_user_id === Auth.currentUser.id && !row.is_read);
    if (unread.length) {
      const ids = unread.map(row => row.id);
      const { error } = await sbClient.from('messages').update({ is_read: true, read_at: new Date().toISOString() }).in('id', ids);
      if (error) Utils.toast(error.message || 'Could not mark message read.', 'error');
      else unread.forEach(row => { row.is_read = true; });
    }
    this.renderThreadLayout(this._rows, mode);
    this.refreshBadges();
  },

  async markThreadUnread(thread, mode) {
    if (!thread) return;
    const incoming = [...thread.messages].reverse().find(message => message.recipient_user_id === Auth.currentUser.id);
    if (!incoming) return;
    const { error } = await sbClient.from('messages').update({ is_read: false, read_at: null }).eq('id', incoming.id);
    if (error) {
      Utils.toast(error.message || 'Could not mark message unread.', 'error');
      return;
    }
    incoming.is_read = false;
    incoming.read_at = null;
    this.renderThreadLayout(this._rows, mode);
    this.refreshBadges();
  },

  async reply(event, thread) {
    event.preventDefault();
    if (!thread) return;
    const latest = thread.latest;
    const recipientId = latest.sender_user_id === Auth.currentUser.id ? latest.recipient_user_id : latest.sender_user_id;
    try {
      const { error } = await sbClient.from('messages').insert({
        thread_id: thread.id,
        parent_message_id: latest.id,
        sender_user_id: Auth.currentUser.id,
        recipient_user_id: recipientId,
        class_id: latest.class_id,
        subject: latest.subject,
        body: document.getElementById('message-reply').value.trim()
      });
      if (error) throw error;
      DB.invalidateMany(['messages', 'notifications']);
      Utils.toast('Reply sent.', 'success');
      await this.refreshCurrentMessages();
    } catch (error) {
      Utils.toast(error.message || 'Could not send reply.', 'error');
    }
  },

  async refreshCurrentMessages() {
    const route = Router.current;
    const rows = await this.loadMyMessages();
    if (route === 'admin/messages') this.renderThreadLayout(rows, 'dos');
    else if (route === 'teacher/messages') this.renderThreadLayout(rows, 'teacher');
    this.refreshBadges();
  },

  async renderTeacherMessages() {
    setHeader('Messages to DOS', 'Send a private message to the Director of Studies');
    setContent(Utils.loading());
    try {
      const profileId = Auth.getTeacherId();
      if (!profileId) throw new Error('Your account is not linked to a teacher profile. Contact the DOS.');
      const [assignments, classes, dosUsers, rows] = await Promise.all([
        this.query('teacher_assignments', 'teacher_id,class_id', { teacher_id: profileId }),
        this.query('classes', 'id,name,level,education_level'),
        this.query('users', 'id,full_name,email,education_level', { role: 'dos', status: 'active' }),
        this.loadMyMessages()
      ]);
      this.classMap = new Map(classes.map(row => [String(row.id), row]));
      this.teacherClasses = [...new Set(assignments.map(row => String(row.class_id)).filter(id => this.classMap.has(id)))].map(id => this.classMap.get(id));
      this.dosUsers = dosUsers;
      this.renderThreadLayout(rows, 'teacher');
      if (!this.selectedThread || !this.makeThreads(rows).some(thread => thread.id === this.selectedThread)) {
        this.showTeacherComposer(rows);
      }
    } catch (error) {
      this.renderError(error);
    }
  },

  showTeacherComposer(rows) {
    const layout = document.querySelector('.communication-layout');
    if (!layout) return;
    const existing = layout.querySelector('.communication-thread-main');
    const classes = this.teacherClasses || [];
    const dos = this.dosUsers || [];
    existing.innerHTML = `<form class="communication-form" id="teacher-message-form">
      <h3>New message to DOS</h3>
      <div class="form-group"><label for="teacher-message-class">Class context</label><select id="teacher-message-class" class="select-field" required><option value="">Choose an assigned class</option>${classes.map(cls => `<option value="${cls.id}">${Utils.escapeHtml(cls.name || cls.level)} · ${Utils.escapeHtml(EducationLevels.getCategory(cls))}</option>`).join('')}</select></div>
      <div class="form-group"><label for="teacher-message-recipient">Recipient</label><select id="teacher-message-recipient" class="select-field" required><option value="">Choose class first</option></select></div>
      <div class="form-group"><label for="teacher-message-subject">Subject</label><input id="teacher-message-subject" class="input-field" maxlength="180" required></div>
      <div class="form-group"><label for="teacher-message-body">Message</label><textarea id="teacher-message-body" class="input-field" maxlength="10000" required></textarea></div>
      <div class="communication-actions"><button class="btn btn-primary" type="submit"><i data-lucide="send"></i> Send message</button><button class="btn btn-outline" type="button" id="teacher-message-cancel">Cancel</button></div>
    </form>`;
    document.getElementById('teacher-message-class').addEventListener('change', event => this.populateDosRecipients(event.target.value));
    document.getElementById('teacher-message-form').addEventListener('submit', event => this.sendTeacherMessage(event));
    document.getElementById('teacher-message-cancel').addEventListener('click', () => {
      this.selectedThread = null;
      this.renderThreadLayout(rows, 'teacher');
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  populateDosRecipients(classId) {
    const cls = this.classMap?.get(String(classId));
    const level = cls ? EducationLevels.getCategory(cls) : '';
    const wantsPrimary = level === 'Primary';
    const recipients = (this.dosUsers || []).filter(user => wantsPrimary
      ? user.education_level === 'PRIMARY'
      : ['Lower Secondary', 'Upper Secondary'].includes(level) && user.education_level === 'SECONDARY');
    document.getElementById('teacher-message-recipient').innerHTML = `<option value="">Select DOS</option>${recipients.map(user => `<option value="${user.id}">${Utils.escapeHtml(user.full_name)}${user.email ? ` · ${Utils.escapeHtml(user.email)}` : ''}</option>`).join('')}`;
  },

  async sendTeacherMessage(event) {
    event.preventDefault();
    try {
      const classId = document.getElementById('teacher-message-class').value;
      const recipient = document.getElementById('teacher-message-recipient').value;
      const subject = document.getElementById('teacher-message-subject').value.trim();
      const body = document.getElementById('teacher-message-body').value.trim();
      if (!classId || !recipient || !subject || !body) throw new Error('Complete all message fields.');
      const { error } = await sbClient.from('messages').insert({
        thread_id: this.uuid(), sender_user_id: Auth.currentUser.id, recipient_user_id: recipient,
        class_id: classId, subject, body
      });
      if (error) throw error;
      this.selectedThread = null;
      DB.invalidateMany(['messages', 'notifications']);
      Utils.toast('Message sent to the DOS.', 'success');
      await this.renderTeacherMessages();
    } catch (error) {
      Utils.toast(error.message || 'Could not send message.', 'error');
    }
  },

  renderError(error) {
    console.error('[Communications]', error);
    const text = Utils.escapeHtml(error.message || 'Could not load communications.');
    setContent(`<div class="alert alert-danger"><strong>Communication data could not be loaded.</strong><br>${text}<p class="text-sm">Run <code>backend/sql/migration-communication-center.sql</code> in Supabase SQL Editor if this feature has not been installed.</p></div>`);
  },

  bindRealtime() {
    if (this._eventsBound || typeof Realtime === 'undefined') return;
    this._eventsBound = true;
    Realtime.on('messages', () => {
      this.refreshBadges();
      if (['admin/messages', 'teacher/messages'].includes(Router.current)) this.refreshCurrentMessages();
    });
    Realtime.on('announcements', () => {
      this.refreshBadges();
      if (Router.current === 'admin/announcements') this.renderAnnouncements();
    });
    Realtime.on('notifications', () => this.refreshBadges());
  }
};

Communications.bindRealtime();