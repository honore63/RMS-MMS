(function () {
  'use strict';

  const strings = RMS_PUBLIC_SETTINGS.strings;
  const school = RMS_PUBLIC_SETTINGS.school;
  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);

  function setText(id, text) {
    const element = byId(id);
    if (element) element.textContent = text || '';
  }

  function renderAction(link, action) {
    if (link.status === 'maintenance') {
      return `<span class="rph-button rph-disabled" aria-disabled="true">${escapeHtml(action.label)} · ${strings.maintenance}</span>`;
    }
    return `<a class="rph-button ${action.id === 'marks' ? 'rph-button-outline' : 'rph-button-primary'}" href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a>`;
  }

  function renderCards(query = '') {
    const normalized = query.trim().toLocaleLowerCase();
    const links = RMS_PUBLIC_LINKS.filter(link => [
      link.title, link.description, link.category, ...(link.audience || [])
    ].join(' ').toLocaleLowerCase().includes(normalized));
    byId('rph-platform-grid').innerHTML = links.map(link => {
      const actions = link.actions || [{ label: strings.open, url: link.url }];
      const privacy = actions.filter(action => action.note)
        .map(action => `<p class="rph-privacy-note"><i data-lucide="shield-check"></i>${escapeHtml(action.note)}</p>`).join('');
      const destination = link.status === 'maintenance' ? '' : `data-rph-destination="${escapeHtml(link.url)}"`;
      return `<article class="rph-card" ${destination}>
        <div class="rph-card-top"><span class="rph-card-icon"><i data-lucide="${escapeHtml(link.icon)}"></i></span><span class="rph-status${link.status === 'maintenance' ? ' is-maintenance' : ''}">${link.status === 'maintenance' ? strings.maintenance : strings.online}</span></div>
        <p class="rph-category">${escapeHtml(link.category)}</p>
        <h3><a class="rph-card-main-link" href="${escapeHtml(link.url)}">${escapeHtml(link.title)}</a></h3>
        <p class="rph-description">${escapeHtml(link.description)}</p>
        <div class="rph-audiences" aria-label="${strings.audience}">${(link.audience || []).map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>
        <div class="rph-actions">${actions.map(action => renderAction(link, action)).join('')}${privacy}</div>
      </article>`;
    }).join('');
    byId('rph-empty').hidden = links.length > 0;
    setText('rph-empty', links.length ? '' : strings.noResults);
    bindCardNavigation();
    renderQuickLinks();
    renderFooterLinks();
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  function bindCardNavigation() {
    byId('rph-platform-grid').querySelectorAll('[data-rph-destination]').forEach(card => {
      const navigate = event => {
        if (event.target.closest('a, button')) return;
        window.location.assign(card.dataset.rphDestination);
      };
      card.addEventListener('click', navigate);
    });
  }

  function renderQuickLinks() {
    const items = [
      { id: 'rms-mis', action: 'marks', icon: 'chart-no-axes-column-increasing', label: strings.checkMarks },
      { id: 'digital-library', icon: 'library-big', label: strings.openLibrary },
      { id: 'examination-centre', icon: 'clipboard-check', label: strings.takeExam }
    ];
    byId('rph-quick-links').innerHTML = items.map(item => {
      const platform = RMS_PUBLIC_LINKS.find(link => link.id === item.id);
      const action = item.action
        ? platform.actions.find(entry => entry.id === item.action)
        : { url: platform.url };
      return `<a href="${escapeHtml(action.url)}"><i data-lucide="${item.icon}"></i>${escapeHtml(item.label)}</a>`;
    }).join('');
  }

  function renderFooterLinks() {
    byId('rph-footer-platforms').innerHTML = RMS_PUBLIC_LINKS.map(link => {
      const action = link.actions?.[0] || { url: link.url };
      return `<a href="${escapeHtml(action.url)}">${escapeHtml(link.title)}</a>`;
    }).join('');
  }

  function renderDocumentSamples(resources) {
    const list = byId('rph-document-list');
    const grouped = new Map();
    resources.forEach(resource => {
      const groupId = `${resource.upload_group_id || resource.id}:${resource.title}`;
      if (!grouped.has(groupId)) grouped.set(groupId, { ...resource, classNames: [] });
      const sample = grouped.get(groupId);
      if (resource.class_name && !sample.classNames.includes(resource.class_name)) {
        sample.classNames.push(resource.class_name);
      }
    });
    const samples = [...grouped.values()].slice(0, 3);
    if (!samples.length) {
      list.innerHTML = `<p class="rph-preview-message">${escapeHtml(strings.documentsEmpty)}</p>`;
      return;
    }
    list.innerHTML = samples.map(resource => `
      <article class="rph-preview-item">
        <span class="rph-preview-icon"><i data-lucide="file-text" aria-hidden="true"></i></span>
        <div class="rph-preview-copy">
          <h3>${escapeHtml(resource.title)}</h3>
          <p>${escapeHtml([resource.subject_name, resource.classNames.join(', ')].filter(Boolean).join(' · ') || strings.publishedDocument)}</p>
          ${resource.description ? `<p class="rph-preview-description">${escapeHtml(resource.description)}</p>` : ''}
        </div>
      </article>`).join('');
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  async function loadDocumentSamples() {
    const list = byId('rph-document-list');
    list.innerHTML = `<p class="rph-preview-message">${escapeHtml(strings.documentsLoading)}</p>`;
    try {
      const { data, error } = await window.sbClient
        .from('digital_library_resources')
        .select('id,upload_group_id,title,description,class_name,subject_name,created_at')
        .eq('status', 'published')
        .eq('visibility', 'public')
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      renderDocumentSamples(data || []);
    } catch (error) {
      console.error('[PublicHome] Could not load published document samples:', error);
      list.innerHTML = `<p class="rph-preview-message" role="status">${escapeHtml(strings.documentsError)} <button type="button" class="rph-inline-retry" onclick="RMSPublicHome.loadDocumentSamples()">Try again</button></p>`;
    }
  }

  function renderExamSamples(exams) {
    const list = byId('rph-exam-list');
    if (!exams.length) {
      list.innerHTML = `<p class="rph-preview-message">${escapeHtml(strings.examEmpty)}</p>`;
      return;
    }
    list.innerHTML = exams.map(exam => {
      const availability = exam.available ? strings.examOpen : strings.examScheduled;
      const duration = exam.duration_minutes
        ? `${escapeHtml(exam.duration_minutes)} ${escapeHtml(strings.minutes)}`
        : strings.examNoTimer;
      const attemptCount = Number(exam.attempt_limit);
      const attemptLabel = attemptCount === 1 ? strings.attempt : strings.attempts;
      return `<article class="rph-preview-item">
        <span class="rph-preview-icon"><i data-lucide="clipboard-check" aria-hidden="true"></i></span>
        <div class="rph-preview-copy">
          <div class="rph-exam-title-row"><h3>${escapeHtml(exam.title)}</h3><span class="rph-exam-status${exam.available ? ' is-open' : ''}">${escapeHtml(availability)}</span></div>
          ${exam.description ? `<p class="rph-preview-description">${escapeHtml(exam.description)}</p>` : ''}
          <p>${duration} · ${escapeHtml(exam.attempt_limit)} ${escapeHtml(attemptLabel)}</p>
          ${exam.status === 'open' && exam.available
            ? `<button class="rph-button rph-button-primary rph-exam-start" type="button" data-rph-start-exam="${escapeHtml(exam.id)}">${escapeHtml(strings.examStartTest)}</button>`
            : `<span class="rph-button rph-disabled" aria-disabled="true">${escapeHtml(strings.examNotOpen)}</span>`}
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-rph-start-exam]').forEach(button => {
      button.addEventListener('click', () => {
        const exam = exams.find(item => String(item.id) === button.dataset.rphStartExam);
        if (exam && typeof ExaminationCentre !== 'undefined') {
          ExaminationCentre.startGuestFromPreview(exam, byId('rph-exam-class').value.trim());
        }
      });
    });
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  async function loadExamSamples(event) {
    event?.preventDefault();
    const className = byId('rph-exam-class').value.trim();
    if (!className) {
      byId('rph-exam-class').focus();
      return;
    }
    const list = byId('rph-exam-list');
    const button = byId('rph-exam-submit');
    button.disabled = true;
    list.innerHTML = `<p class="rph-preview-message">${escapeHtml(strings.examLoading)}</p>`;
    try {
      const { data, error } = await window.sbClient.rpc('rms_exam_guest_list', { p_class_name: className });
      if (error) throw error;
      renderExamSamples((Array.isArray(data) ? data : [])
        .filter(exam => exam.status === 'published' || exam.status === 'open')
        .slice(0, 3));
    } catch (error) {
      console.error('[PublicHome] Could not load examination samples:', error);
      list.innerHTML = `<p class="rph-preview-message" role="status">${escapeHtml(strings.examError)}</p>`;
    } finally {
      button.disabled = false;
    }
  }

  function applyTheme(dark) {
    byId('public-home').classList.toggle('rph-dark', dark);
    const button = byId('rph-theme-toggle');
    button.setAttribute('aria-label', dark ? strings.themeLight : strings.themeDark);
    button.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
    try {
      localStorage.setItem('rms-public-theme', dark ? 'dark' : 'light');
    } catch (error) {
      console.warn('[PublicHome] Theme preference could not be saved:', error);
    }
    if (window.lucide?.createIcons) window.lucide.createIcons();
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem('rms-public-theme');
    } catch (error) {
      console.warn('[PublicHome] Theme preference could not be read:', error);
    }
    applyTheme(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    byId('rph-theme-toggle').addEventListener('click', () => {
      applyTheme(!byId('public-home').classList.contains('rph-dark'));
    });
  }

  function init() {
    document.title = `${school.name} | ${strings.schoolPortal}`;
    setText('rph-school-name', school.name);
    setText('rph-motto', school.motto);
    setText('rph-footer-name', school.name);
    setText('rph-footer-motto', school.motto);
    setText('rph-copyright-name', school.name);
    setText('rph-copyright-text', strings.copyright);
    setText('rph-nav-home', strings.home);
    setText('rph-nav-academics', strings.academics);
    byId('rph-nav-home').setAttribute('aria-label', strings.returnHome);
    byId('rph-nav-academics').setAttribute('aria-label', strings.academics);
    byId('rph-nav-home').setAttribute('href', '#public-home');
    byId('rph-nav-academics').setAttribute('href', '#rph-academics');
    setText('rph-staff-login', strings.login);
    byId('rph-staff-login').setAttribute('aria-label', strings.login);
    setText('rph-return', strings.returnHomeShort);
    setText('rph-welcome', strings.welcome);
    setText('rph-hero-title', strings.heroTitle);
    setText('rph-hero-description', strings.heroDescription);
    setText('rph-progress-audience', strings.progressAudience);
    setText('rph-progress-title', strings.progressTitle);
    setText('rph-progress-description', strings.progressDescription);
    setText('rph-progress-action', strings.progressAction);
    setText('rph-progress-privacy', strings.progressPrivacy);
    setText('rph-search-label', strings.searchLabel);
    byId('rph-search').placeholder = strings.searchPlaceholder;
    setText('rph-platforms-eyebrow', strings.platformsEyebrow);
    setText('rph-platforms-title', strings.platformsTitle);
    setText('rph-platforms-description', strings.platformsDescription);
    setText('rph-quick-title', strings.quickLinks);
    setText('rph-documents-eyebrow', strings.previewEyebrow);
    setText('rph-documents-title', strings.documentsTitle);
    setText('rph-documents-explore', strings.documentsExplore);
    setText('rph-exams-eyebrow', strings.previewEyebrow);
    setText('rph-exams-title', strings.examsTitle);
    setText('rph-exams-explore', strings.exploreExaminations);
    setText('rph-exams-help', strings.examsHelp);
    setText('rph-exam-class-label', strings.examClassLabel);
    byId('rph-exam-class').placeholder = strings.examClassPlaceholder;
    setText('rph-exam-submit', strings.examSearch);
    byId('rph-exam-list').innerHTML = `<p class="rph-preview-message">${escapeHtml(strings.examEnterClass)}</p>`;
    setText('rph-about-eyebrow', strings.aboutEyebrow);
    setText('rph-about-title', strings.aboutTitle);
    setText('rph-about-copy', school.about);
    byId('rph-school-photo').alt = strings.aboutAlt;
    setText('rph-privacy', strings.privacy);
    setText('rph-contact-title', strings.contactTitle);
    setText('rph-address', school.address);
    byId('rph-phone').href = `tel:${school.phone.replace(/[^\d+]/g, '')}`;
    setText('rph-phone', `${strings.phone}: ${school.phone}`);
    byId('rph-email').href = `mailto:${school.email}`;
    setText('rph-email', `${strings.email}: ${school.email}`);
    setText('rph-footer-platform-title', strings.allPlatforms);
    setText('rph-year', String(new Date().getFullYear()));

    byId('rph-search').addEventListener('input', event => renderCards(event.currentTarget.value));
    byId('rph-exam-search').addEventListener('submit', loadExamSamples);
    initTheme();
    renderCards();
    loadDocumentSamples();
  }

  window.RMSPublicHome = {
    show() {
      byId('public-home').hidden = false;
      document.querySelector('.login-shell').hidden = true;
      byId('login-page').classList.add('rph-showing-home');
      document.documentElement.classList.add('rph-page-scroll');
      window.scrollTo(0, 0);
      if (window.lucide?.createIcons) window.lucide.createIcons();
    },
    showStaffLogin() {
      byId('public-home').hidden = true;
      document.querySelector('.login-shell').hidden = false;
      byId('login-page').classList.remove('rph-showing-home');
      document.documentElement.classList.remove('rph-page-scroll');
      window.scrollTo(0, 0);
    },
    loadDocumentSamples
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
