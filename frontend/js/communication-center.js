const CommunicationCenter = {
  bucket: 'message-attachments',
  maxFileBytes: 50 * 1024 * 1024,
  state: {
    role: '',
    contacts: [],
    threads: [],
    selectedThreadId: '',
    recipientFilter: '',
    selectedRecipients: new Set(),
    selectedClassId: ''
  },

  escape(value) {
    return Utils.escapeHtml(value == null ? '' : String(value));
  },

  uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  async render() {
    this.state.role = Auth.getRole();
    if (!['dos', 'teacher'].includes(this.state.role)) {
      setHeader('Messages', 'Private school communication');
      setContent('<div class="alert alert-error">Messaging is available to DOS and teacher accounts.</div>');
      return;
    }
    setHeader('Messages', this.state.role === 'dos' ? 'Messages with teachers' : 'Messages with your DOS');
    setContent(Utils.loading());
    try {
      await this.loadContacts();
      await this.loadThreads();
      const hashQuery = window.location.hash.split('?')[1] || '';
      const messageId = new URLSearchParams(hashQuery).get('message');
      if (messageId) {
        const targetThread = this.state.threads.find(thread => thread.messages.some(message => String(message.id) === String(messageId)));
        if (targetThread) this.state.selectedThreadId = targetThread.id;
      }
      this.renderPage();
    } catch (error) {
      console.error('[CommunicationCenter] load error:', error);
      setContent(`<div class="alert alert-error">Could not load messages: ${this.escape(error.message)}</div>`);
    }
  },

  async loadContacts() {
    const [allClasses, assignments] = await Promise.all([
      DB.get('classes'),
      DB.get('teacher_assignments')
    ]);
    const classes = this.state.role === 'dos' && Scope.isScoped()
      ? Scope.filterClasses(allClasses)
      : allClasses;
    const classById = new Map(classes.map(item => [String(item.id), item]));

    if (this.state.role === 'dos') {
      const [teachers, users] = await Promise.all([DB.get('teachers'), DB.get('users')]);
      const usersById = new Map(users.map(user => [String(user.id), user]));
      const classByTeacher = new Map();
      assignments.forEach(assignment => {
        const cls = classById.get(String(assignment.class_id));
        if (cls && !classByTeacher.has(String(assignment.teacher_id))) {
          classByTeacher.set(String(assignment.teacher_id), cls);
        }
      });
      this.state.contacts = teachers
        .filter(teacher => teacher.status === 'active' && classByTeacher.has(String(teacher.id)))
        .map(teacher => {
          const user = usersById.get(String(teacher.user_id));
          const cls = classByTeacher.get(String(teacher.id));
          return user && user.status === 'active' ? {
            userId: user.id,
            name: teacher.full_name || user.full_name || 'Teacher',
            classId: cls.id,
            className: cls.name
          } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      return;
    }

    const teacherId = Auth.getTeacherId();
    const assignedClasses = [...new Map(assignments
      .filter(assignment => String(assignment.teacher_id) === String(teacherId))
      .map(assignment => classById.get(String(assignment.class_id)))
      .filter(Boolean)
      .map(cls => [String(cls.id), cls])).values()];
    const contacts = [];
    for (const cls of assignedClasses) {
      const { data, error } = await sbClient.rpc('rms_communication_dos_for_class', { p_class_id: cls.id });
      if (error) throw error;
      const dos = Array.isArray(data) ? data[0] : data;
      if (dos) contacts.push({
        userId: dos.user_id,
        name: dos.full_name || (cls.education_level === 'Primary' ? 'DOS Primary' : 'DOS Secondary'),
        classId: cls.id,
        className: cls.name
      });
    }
    this.state.contacts = contacts;
    this.state.selectedClassId = contacts[0]?.classId || '';
  },

  async loadThreads() {
    const userId = Auth.currentUser?.id;
    const [sent, received] = await Promise.all([
      sbClient.from('messages').select('*').eq('sender_user_id', userId).order('created_at', { ascending: false }).limit(500),
      sbClient.from('messages').select('*').eq('recipient_user_id', userId).order('created_at', { ascending: false }).limit(500)
    ]);
    if (sent.error) throw sent.error;
    if (received.error) throw received.error;
    const rows = new Map();
    [...(sent.data || []), ...(received.data || [])].forEach(message => rows.set(message.id, message));
    const grouped = new Map();
    rows.forEach(message => {
      const threadId = message.thread_id || message.id;
      if (!grouped.has(threadId)) grouped.set(threadId, []);
      grouped.get(threadId).push(message);
    });
    const currentUserId = String(userId);
    this.state.threads = [...grouped.entries()].map(([id, messages]) => {
      messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const latest = messages[messages.length - 1];
      const otherId = String(latest.sender_user_id) === currentUserId ? latest.recipient_user_id : latest.sender_user_id;
      const contact = this.state.contacts.find(item => String(item.userId) === String(otherId));
      const otherMessage = [...messages].reverse().find(message => String(message.sender_user_id) !== currentUserId);
      return {
        id,
        messages,
        latest,
        otherId,
        contactName: contact?.name || otherMessage?.sender_name || 'Conversation',
        classId: messages.find(message => message.class_id)?.class_id || contact?.classId || null,
        unread: messages.filter(message => String(message.recipient_user_id) === currentUserId && !message.is_read).length
      };
    }).sort((a, b) => new Date(b.latest.created_at) - new Date(a.latest.created_at));
    if (!this.state.threads.some(thread => thread.id === this.state.selectedThreadId)) {
      this.state.selectedThreadId = this.state.threads[0]?.id || '';
    }
  },

  renderPage() {
    const selected = this.state.threads.find(thread => thread.id === this.state.selectedThreadId);
    const threadButtons = this.state.threads.map(thread => `
      <button type="button" class="cc-thread ${thread.id === this.state.selectedThreadId ? 'active' : ''}" onclick="CommunicationCenter.selectThread('${this.escape(thread.id)}')">
        <span class="cc-thread-top"><strong>${this.escape(thread.contactName)}</strong>${thread.unread ? `<span class="cc-unread">${thread.unread}</span>` : ''}</span>
        <span class="cc-thread-subject">${this.escape(thread.latest.subject)}</span>
        <span class="cc-thread-preview">${this.escape(thread.latest.body || 'Attachment')}</span>
        <time>${this.escape(Utils.dateTimeStr(thread.latest.created_at))}</time>
      </button>`).join('');

    setContent(`
      <section class="cc-layout" aria-label="Private messages">
        <aside class="cc-inbox">
          <div class="cc-inbox-head">
            <div><h3>Inbox</h3><p>${this.state.threads.length} conversation${this.state.threads.length === 1 ? '' : 's'}</p></div>
            <button type="button" class="btn btn-primary btn-sm" onclick="CommunicationCenter.openCompose()"><i data-lucide="square-pen"></i> New message</button>
          </div>
          <label class="cc-search-label" for="cc-search">Search conversations</label>
          <input id="cc-search" class="input-field" type="search" placeholder="Name or subject" oninput="CommunicationCenter.filterThreads(this.value)">
          <div id="cc-thread-list" class="cc-thread-list">${threadButtons || '<p class="cc-empty">No conversations yet.</p>'}</div>
        </aside>
        <section id="cc-conversation" class="cc-conversation" aria-live="polite">
          ${selected ? '<div class="cc-empty">Loading conversation...</div>' : '<div class="cc-empty"><i data-lucide="messages-square"></i><p>Select a conversation or start a new message.</p></div>'}
        </section>
      </section>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (selected) this.renderConversation(selected);
  },

  filterThreads(value) {
    const query = String(value || '').trim().toLowerCase();
    const list = document.getElementById('cc-thread-list');
    if (!list) return;
    const matches = this.state.threads.filter(thread =>
      (thread.contactName + ' ' + thread.latest.subject + ' ' + thread.latest.body).toLowerCase().includes(query));
    list.innerHTML = matches.map(thread => `
      <button type="button" class="cc-thread ${thread.id === this.state.selectedThreadId ? 'active' : ''}" onclick="CommunicationCenter.selectThread('${this.escape(thread.id)}')">
        <span class="cc-thread-top"><strong>${this.escape(thread.contactName)}</strong>${thread.unread ? `<span class="cc-unread">${thread.unread}</span>` : ''}</span>
        <span class="cc-thread-subject">${this.escape(thread.latest.subject)}</span>
        <span class="cc-thread-preview">${this.escape(thread.latest.body || 'Attachment')}</span>
        <time>${this.escape(Utils.dateTimeStr(thread.latest.created_at))}</time>
      </button>`).join('') || '<p class="cc-empty">No matching conversations.</p>';
  },

  async selectThread(threadId) {
    this.state.selectedThreadId = threadId;
    const thread = this.state.threads.find(item => item.id === threadId);
    const userId = Auth.currentUser?.id;
    if (thread && thread.unread) {
      const unreadIds = thread.messages.filter(message => String(message.recipient_user_id) === String(userId) && !message.is_read).map(message => message.id);
      if (unreadIds.length) {
        const { error } = await sbClient.from('messages').update({ is_read: true, read_at: new Date().toISOString() }).in('id', unreadIds).eq('recipient_user_id', userId);
        if (!error) thread.messages.forEach(message => { if (unreadIds.includes(message.id)) message.is_read = true; });
        thread.unread = 0;
      }
    }
    this.renderPage();
  },

  async renderConversation(thread) {
    const container = document.getElementById('cc-conversation');
    if (!container) return;
    const { data, error } = await sbClient.from('messages').select('*').eq('thread_id', thread.id).order('created_at', { ascending: true });
    if (error) {
      container.innerHTML = `<div class="alert alert-error">Could not load this conversation: ${this.escape(error.message)}</div>`;
      return;
    }
    const messages = data || [];
    const messageIds = messages.map(message => message.id);
    let attachments = [];
    if (messageIds.length) {
      const result = await sbClient.from('message_attachments').select('*').in('message_id', messageIds).order('created_at', { ascending: true });
      if (!result.error) attachments = result.data || [];
    }
    const attachmentsByMessage = new Map();
    attachments.forEach(file => {
      if (!attachmentsByMessage.has(file.message_id)) attachmentsByMessage.set(file.message_id, []);
      attachmentsByMessage.get(file.message_id).push(file);
    });
    const currentUserId = String(Auth.currentUser?.id);
    const messageCards = await Promise.all(messages.map(async message => {
      const isMine = String(message.sender_user_id) === currentUserId;
      const name = isMine ? 'You' : (message.sender_name || thread.contactName);
      const files = await this.renderAttachments(attachmentsByMessage.get(message.id) || []);
      return `<article class="cc-message ${isMine ? 'mine' : ''}">
        <header><strong>${this.escape(name)}</strong><time>${this.escape(Utils.dateTimeStr(message.created_at))}</time></header>
        ${message.body ? `<div class="cc-message-body">${this.escape(message.body)}</div>` : ''}
        ${files ? `<div class="cc-attachments">${files}</div>` : ''}
      </article>`;
    }));
    const latest = messages[messages.length - 1];
    const recipientId = latest && String(latest.sender_user_id) === currentUserId ? latest.recipient_user_id : latest?.sender_user_id;
    container.innerHTML = `
      <header class="cc-conversation-head">
        <div><h3>${this.escape(thread.contactName)}</h3><p>${this.escape(latest?.subject || '')}</p></div>
        <button type="button" class="btn btn-outline btn-sm" onclick="CommunicationCenter.refresh()" aria-label="Refresh conversations"><i data-lucide="refresh-cw"></i></button>
      </header>
      <div class="cc-message-list">${messageCards.join('') || '<p class="cc-empty">No messages in this conversation.</p>'}</div>
      <form class="cc-reply" onsubmit="event.preventDefault();CommunicationCenter.sendReply('${this.escape(thread.id)}','${this.escape(recipientId || '')}','${this.escape(thread.classId || '')}')">
        <label for="cc-reply-body">Reply</label>
        <textarea id="cc-reply-body" class="input-field" rows="3" placeholder="Write a message..." maxlength="10000"></textarea>
        <div class="cc-reply-actions">
          <label class="btn btn-outline btn-sm" for="cc-reply-files"><i data-lucide="paperclip"></i> Attach files</label>
          <input id="cc-reply-files" class="cc-file-input" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip">
          <button type="submit" class="btn btn-primary"><i data-lucide="send"></i> Send reply</button>
        </div>
      </form>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    const list = container.querySelector('.cc-message-list');
    if (list) list.scrollTop = list.scrollHeight;
  },

  async renderAttachments(files) {
    const rendered = await Promise.all(files.map(async file => {
      const { data, error } = await sbClient.storage.from(this.bucket).createSignedUrl(file.file_path, 3600);
      if (error || !data?.signedUrl) return `<div class="cc-file-missing">${this.escape(file.file_name)} (unavailable)</div>`;
      const url = this.escape(data.signedUrl);
      const type = String(file.file_type || '').toLowerCase();
      if (type.startsWith('image/')) return `<a class="cc-image-file" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${this.escape(file.file_name)}"><span>${this.escape(file.file_name)}</span></a>`;
      if (type.startsWith('video/')) return `<div class="cc-media-file"><video controls preload="metadata" src="${url}"></video><a href="${url}" target="_blank" rel="noopener">${this.escape(file.file_name)}</a></div>`;
      if (type.startsWith('audio/')) return `<div class="cc-media-file"><audio controls preload="metadata" src="${url}"></audio><a href="${url}" target="_blank" rel="noopener">${this.escape(file.file_name)}</a></div>`;
      return `<a class="cc-document-file" href="${url}" target="_blank" rel="noopener" download><i data-lucide="file-text"></i><span>${this.escape(file.file_name)}</span></a>`;
    }));
    return rendered.join('');
  },

  async refresh() {
    await this.render();
  },

  async openCompose() {
    this.state.selectedRecipients.clear();
    this.state.recipientFilter = '';
    const recipientPicker = this.state.role === 'dos'
      ? `<div class="form-group"><label for="cc-recipient-search">Teachers <span class="required">*</span></label>
          <input id="cc-recipient-search" class="input-field" type="search" placeholder="Search teachers" oninput="CommunicationCenter.filterRecipients(this.value)">
          <div class="cc-picker-actions"><button type="button" class="btn btn-ghost btn-sm" onclick="CommunicationCenter.selectVisibleRecipients(true)">Select visible</button><button type="button" class="btn btn-ghost btn-sm" onclick="CommunicationCenter.selectVisibleRecipients(false)">Clear visible</button></div>
          <div id="cc-recipient-list" class="cc-recipient-list">${this.renderRecipientOptions()}</div></div>`
      : `<div class="form-group"><label for="cc-class">Send to DOS for class <span class="required">*</span></label>
          <select id="cc-class" class="select-field" onchange="CommunicationCenter.setTeacherClass(this.value)">
            ${this.state.contacts.map(contact => `<option value="${this.escape(contact.classId)}" ${String(contact.classId) === String(this.state.selectedClassId) ? 'selected' : ''}>${this.escape(contact.name)} - ${this.escape(contact.className)}</option>`).join('') || '<option value="">No assigned class has a matching DOS contact</option>'}
          </select></div>`;
    Modal.show('New Message', `
      ${recipientPicker}
      <div class="form-group"><label for="cc-subject">Subject <span class="required">*</span></label><input id="cc-subject" class="input-field" maxlength="200" required placeholder="Message subject"></div>
      <div class="form-group"><label for="cc-body">Message</label><textarea id="cc-body" class="input-field" rows="5" maxlength="10000" placeholder="Write your message..."></textarea></div>
      <div class="form-group"><label for="cc-files">Attachments</label><input id="cc-files" class="input-field" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"><p class="form-hint">Photos, videos, audio, and documents; up to 8 files, 50 MB each.</p></div>`,
      `<button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button type="button" class="btn btn-primary" onclick="CommunicationCenter.sendNewMessage()"><i data-lucide="send"></i> Send</button>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  renderRecipientOptions() {
    const query = this.state.recipientFilter.toLowerCase();
    const contacts = this.state.contacts.filter(contact => (contact.name + ' ' + contact.className).toLowerCase().includes(query));
    return contacts.map(contact => `
      <label class="cc-recipient" data-recipient-row="${this.escape(contact.userId)}">
        <input type="checkbox" value="${this.escape(contact.userId)}" ${this.state.selectedRecipients.has(String(contact.userId)) ? 'checked' : ''} onchange="CommunicationCenter.setRecipient('${this.escape(contact.userId)}',this.checked)">
        <span><strong>${this.escape(contact.name)}</strong><small>${this.escape(contact.className)}</small></span>
      </label>`).join('') || '<p class="cc-empty">No assigned teachers found.</p>';
  },

  filterRecipients(value) {
    this.state.recipientFilter = String(value || '').trim();
    const list = document.getElementById('cc-recipient-list');
    if (list) list.innerHTML = this.renderRecipientOptions();
  },

  setRecipient(userId, checked) {
    if (checked) this.state.selectedRecipients.add(String(userId));
    else this.state.selectedRecipients.delete(String(userId));
  },

  selectVisibleRecipients(checked) {
    this.state.contacts
      .filter(contact => (contact.name + ' ' + contact.className).toLowerCase().includes(this.state.recipientFilter.toLowerCase()))
      .forEach(contact => this.setRecipient(contact.userId, checked));
    const list = document.getElementById('cc-recipient-list');
    if (list) list.innerHTML = this.renderRecipientOptions();
  },

  setTeacherClass(classId) {
    this.state.selectedClassId = classId;
  },

  async sendNewMessage() {
    const subject = document.getElementById('cc-subject')?.value.trim();
    const body = document.getElementById('cc-body')?.value.trim();
    const files = [...(document.getElementById('cc-files')?.files || [])];
    if (!subject) return Utils.toast('Enter a subject', 'error');
    if (!body && !files.length) return Utils.toast('Write a message or attach a file', 'error');
    let recipients;
    if (this.state.role === 'dos') {
      recipients = this.state.contacts.filter(contact => this.state.selectedRecipients.has(String(contact.userId)));
    } else {
      recipients = this.state.contacts.filter(contact => String(contact.classId) === String(this.state.selectedClassId)).slice(0, 1);
    }
    if (!recipients.length) return Utils.toast(this.state.role === 'dos' ? 'Select one or more teachers' : 'Choose a class with an available DOS contact', 'error');
    await this.sendMessages(recipients.map(contact => ({
      recipientId: contact.userId,
      classId: contact.classId,
      threadId: this.uuid(),
      parentMessageId: null,
      subject,
      body: body || 'Attachment sent'
    })), files);
  },

  async sendReply(threadId, recipientId, classId) {
    const body = document.getElementById('cc-reply-body')?.value.trim();
    const files = [...(document.getElementById('cc-reply-files')?.files || [])];
    if (!body && !files.length) return Utils.toast('Write a reply or attach a file', 'error');
    const thread = this.state.threads.find(item => item.id === threadId);
    if (!thread || !recipientId) return Utils.toast('Could not find the message recipient', 'error');
    const latest = thread.messages[thread.messages.length - 1];
    await this.sendMessages([{
      recipientId,
      classId: classId || thread.classId,
      threadId,
      parentMessageId: latest.id,
      subject: latest.subject,
      body: body || 'Attachment sent'
    }], files);
  },

  async sendMessages(recipients, files) {
    if (files.length > 8) return Utils.toast('Choose no more than 8 files', 'error');
    if (files.some(file => file.size > this.maxFileBytes)) return Utils.toast('Each attachment must be 50 MB or smaller', 'error');
    const userId = Auth.currentUser?.id;
    const uploaded = [];
    try {
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'attachment';
        const path = `${userId}/${this.uuid()}/${safeName}`;
        const { error } = await sbClient.storage.from(this.bucket).upload(path, file, {
          cacheControl: '3600',
          contentType: file.type || 'application/octet-stream',
          upsert: false
        });
        if (error) throw error;
        uploaded.push({ file, path });
      }
      const rows = recipients.map(recipient => ({
        sender_user_id: userId,
        recipient_user_id: recipient.recipientId,
        subject: recipient.subject,
        body: recipient.body,
        message_type: 'direct',
        thread_id: recipient.threadId,
        parent_message_id: recipient.parentMessageId,
        class_id: recipient.classId || null
      }));
      const inserted = await sbClient.from('messages').insert(rows).select('id,recipient_user_id');
      if (inserted.error) throw inserted.error;
      if (uploaded.length) {
        const attachmentRows = inserted.data.flatMap(message => uploaded.map(item => ({
          message_id: message.id,
          file_name: item.file.name,
          file_path: item.path,
          file_size: item.file.size,
          file_type: item.file.type || 'application/octet-stream',
          uploaded_by: userId
        })));
        const attached = await sbClient.from('message_attachments').insert(attachmentRows);
        if (attached.error) throw attached.error;
      }
      Modal.close();
      Utils.toast(`Message sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`, 'success');
      this.state.selectedThreadId = '';
      await this.render();
    } catch (error) {
      if (uploaded.length) await sbClient.storage.from(this.bucket).remove(uploaded.map(item => item.path)).catch(() => {});
      console.error('[CommunicationCenter] send error:', error);
      Utils.toast('Could not send message: ' + (error.message || 'Unknown error'), 'error');
    }
  }
};