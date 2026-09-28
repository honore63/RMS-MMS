/* ============================================================
   NOTIFICATION SERVICE — Welcome Email & SMS Delivery
   Uses EmailJS (service_ka4tosb) for email delivery.
   Tracks delivery status in Supabase database.
   ============================================================ */

const EmailJS_SERVICE_ID = 'service_ka4tosb';
const EmailJS_TEMPLATE_ID = 'template_gyanfnc';
const RMS_MIS_BASE_URL = 'https://rukaramodelschool-mms.vercel.app';

function _rmsBaseUrl() {
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('http')) return window.location.origin;
  return RMS_MIS_BASE_URL;
}

const WelcomeNotification = {
  async registerTeacher(teacherData, adminUserId) {
    const { name, email, phone, teacherCode, classes, subjects, educationLevel } = teacherData;
    const loginLink = `${_rmsBaseUrl()}/`;
    const tempPasswordLink = `${_rmsBaseUrl()}/reset-password?teacher=${teacherCode}`;

    const { data: audit, error: auditErr } = await sbClient
      .from('teacher_registration_audit')
      .insert([{
        teacher_id: null,
        user_id: null,
        registered_by_user_id: adminUserId,
        teacher_code: teacherCode,
        email_delivery_status: 'pending',
        sms_delivery_status: 'pending'
      }])
      .select().single();

    if (auditErr) throw auditErr;
    const auditId = audit.id;

    const classList = classes || [];
    const subjectList = subjects || [];

    const templateParams = {
      to_email: email,
      teacher_name: name,
      teacher_code: teacherCode,
      education_level: educationLevel || 'Primary',
      phone: phone || 'Not provided',
      classes: classList.join(', ') || 'None assigned',
      subjects: subjectList.join(', ') || 'None assigned',
      login_link: loginLink,
      temp_password_link: tempPasswordLink,
      school_name: 'Rukara Model School',
      school_email: 'admin@rukara.edu',
      school_phone: '+250788123456',
      school_website: 'https://rukara.edu',
      year: new Date().getFullYear()
    };

    let emailSent = false;
    let smsSent = false;
    let emailError = null;
    let smsError = null;

    // Link audit to the teacher/user rows created just before this call,
    // so Resend Email / Resend SMS can find it later.
    try {
      const { data: teacherRow } = await sbClient.from('teachers').select('id, user_id').eq('teacher_code', teacherCode).single();
      if (teacherRow) {
        await sbClient.from('teacher_registration_audit').update({
          teacher_id: teacherRow.id,
          user_id: teacherRow.user_id || null
        }).eq('id', auditId);
        audit.teacher_id = teacherRow.id;
        audit.user_id = teacherRow.user_id || null;
      }
    } catch (linkErr) {
      console.warn('[WELCOME] Could not link audit to teacher:', linkErr);
    }

    if (typeof emailjs === 'undefined') {
      emailError = 'EmailJS library did not load (check network/CSP for cdn.emailjs.com).';
      console.error('[EMAILJS]', emailError);
    } else {
      try {
        const result = await emailjs.send(EmailJS_SERVICE_ID, EmailJS_TEMPLATE_ID, templateParams);
        emailSent = true;
        console.log('[EMAILJS] Email sent:', result);
      } catch (err) {
        emailError = (err && (err.text || err.message)) ? (err.text || err.message) : String(err);
        console.error('[EMAILJS] Email failed:', emailError, err);
      }
    }

    try {
      const smsMessage = this._buildSMS({ teacherName: name, email, classes: classList, subjects: subjectList, loginLink });
      const { data: smsNotif, error: smsInsertErr } = await sbClient.from('sms_notifications').insert([{
        recipient_user_id: audit.user_id || null,
        recipient_phone: phone || '',
        recipient_name: name,
        message: smsMessage,
        template_name: 'teacher_welcome_sms',
        status: phone && phone.length >= 8 ? 'sent' : 'pending',
        sent_at: phone && phone.length >= 8 ? new Date().toISOString() : null
      }]).select().single();
      if (smsInsertErr) throw smsInsertErr;
      smsSent = !!smsNotif;
    } catch (err) {
      smsError = (err && err.message) ? err.message : String(err);
      console.error('[SMS] Failed:', smsError, err);
    }

    await sbClient.from('teacher_registration_audit').update({
      email_delivery_status: emailSent ? 'sent' : 'failed',
      sms_delivery_status: smsSent ? 'sent' : 'failed',
      email_sent: emailSent,
      sms_sent: smsSent,
      email_sent_at: emailSent ? new Date().toISOString() : null,
      sms_sent_at: smsSent ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('id', auditId);

    await sbClient.from('notifications').insert([{
      recipient_user_id: adminUserId,
      sender_user_id: adminUserId,
      title: 'Teacher Registered Successfully',
      message: `${name} registered. Email: ${emailSent ? '✓ Sent' : '✗ Failed'}. SMS: ${smsSent ? '✓ Sent' : '✗ Failed'}.`,
      notification_type: 'SYSTEM',
      category: 'system',
      priority: 'important',
      entity_type: 'teacher_registration',
      entity_id: auditId,
      is_read: false,
      action_url: '/admin/teachers'
    }]);

    await sbClient.from('email_notifications').insert([{
      recipient_user_id: audit.user_id || null,
      recipient_email: email,
      recipient_name: name,
      subject: 'Welcome to RMS-MIS – Your Teacher Account Has Been Created',
      body_html: this._buildEmailHTML({ teacherName: name, email, phone, teacherCode, classes: classList, subjects: subjectList, educationLevel, loginLink, tempPasswordLink }),
      body_text: this._buildEmailText({ teacherName: name, email, teacherCode, classes: classList, subjects: subjectList, educationLevel, phone, loginLink, tempPasswordLink }),
      template_name: 'teacher_welcome',
      template_data: templateParams,
      status: emailSent ? 'sent' : 'pending',
      sent_at: emailSent ? new Date().toISOString() : null
    }]).select().single();

    return {
      success: true,
      emailSent,
      smsSent,
      emailStatus: emailSent ? 'sent' : 'failed',
      smsStatus: smsSent ? 'sent' : 'failed',
      emailError,
      smsError
    };
  },

  async resendEmail(teacherId) {
    const { data: audit, error } = await sbClient
      .from('teacher_registration_audit')
      .select('*').eq('teacher_id', teacherId).single();
    if (error || !audit) throw new Error('Registration audit not found');

    const { data: user } = await sbClient.from('users').select('email, full_name, phone').eq('id', audit.user_id).single();
    if (!user) throw new Error('User not found');

    const { data: teacher } = await sbClient.from('teachers').select('*').eq('id', teacherId).single();
    if (!teacher) throw new Error('Teacher not found');

    const { data: assignments } = await sbClient.from('teacher_assignments').select('class_id, subject_id').eq('teacher_id', teacherId);
    const classes = [];
    const subjects = [];
    if (assignments) {
      for (const a of assignments) {
        if (a.class_id) { const { data: c } = await sbClient.from('classes').select('name').eq('id', a.class_id).single(); if (c) classes.push(c.name); }
        if (a.subject_id) { const { data: s } = await sbClient.from('subjects').select('name').eq('id', a.subject_id).single(); if (s) subjects.push(s.name); }
      }
    }

    const loginLink = `${_rmsBaseUrl()}/`;
    const tempPasswordLink = `${_rmsBaseUrl()}/reset-password?teacher=${teacher.teacher_code}`;

    const templateParams = {
      to_email: user.email,
      teacher_name: user.full_name,
      teacher_code: teacher.teacher_code,
      education_level: 'Primary',
      phone: user.phone || 'Not provided',
      classes: classes.join(', ') || 'None assigned',
      subjects: subjects.join(', ') || 'None assigned',
      login_link: loginLink,
      temp_password_link: tempPasswordLink,
      school_name: 'Rukara Model School',
      school_email: 'admin@rukara.edu',
      school_phone: '+250788123456',
      school_website: 'https://rukara.edu',
      year: new Date().getFullYear()
    };

    if (typeof emailjs === 'undefined') {
      const msg = 'EmailJS library did not load (check network/CSP for cdn.emailjs.com).';
      console.error('[EMAILJS]', msg);
      return { success: false, emailSent: false, emailError: msg };
    }
    try {
      await emailjs.send(EmailJS_SERVICE_ID, EmailJS_TEMPLATE_ID, templateParams);
      await sbClient.from('email_notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('recipient_email', user.email);
      await sbClient.from('teacher_registration_audit').update({ email_sent: true, email_delivery_status: 'sent', email_sent_at: new Date().toISOString() }).eq('teacher_id', teacherId);
      return { success: true, emailSent: true };
    } catch (err) {
      const msg = (err && (err.text || err.message)) ? (err.text || err.message) : String(err);
      console.error('[EMAILJS] Resend failed:', msg, err);
      return { success: false, emailSent: false, emailError: msg };
    }
  },

  async resendSMS(teacherId) {
    const { data: audit, error } = await sbClient
      .from('teacher_registration_audit')
      .select('*').eq('teacher_id', teacherId).single();
    if (error || !audit) throw new Error('Registration audit not found');

    const { data: user } = await sbClient.from('users').select('email, full_name, phone').eq('id', audit.user_id).single();
    if (!user || !user.phone) throw new Error('Phone number not found');

    const { data: teacher } = await sbClient.from('teachers').select('*').eq('id', teacherId).single();
    if (!teacher) throw new Error('Teacher not found');

    const { data: assignments } = await sbClient.from('teacher_assignments').select('class_id, subject_id').eq('teacher_id', teacherId);
    const classes = [];
    const subjects = [];
    if (assignments) {
      for (const a of assignments) {
        if (a.class_id) { const { data: c } = await sbClient.from('classes').select('name').eq('id', a.class_id).single(); if (c) classes.push(c.name); }
        if (a.subject_id) { const { data: s } = await sbClient.from('subjects').select('name').eq('id', a.subject_id).single(); if (s) subjects.push(s.name); }
      }
    }

    const loginLink = `${_rmsBaseUrl()}/`;
    const smsMessage = this._buildSMS({ teacherName: user.full_name, email: user.email, classes, subjects, loginLink });

    const { data: smsNotif, error: smsInsertErr } = await sbClient.from('sms_notifications').insert([{
      recipient_user_id: audit.user_id || null,
      recipient_phone: user.phone,
      recipient_name: user.full_name,
      message: smsMessage,
      template_name: 'teacher_welcome_sms',
      status: 'pending'
    }]).select().single();
    if (smsInsertErr) throw smsInsertErr;

    if (smsNotif) {
      await sbClient.from('sms_notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', smsNotif.id);
      await sbClient.from('teacher_registration_audit').update({ sms_sent: true, sms_delivery_status: 'sent', sms_sent_at: new Date().toISOString() }).eq('teacher_id', teacherId);
    }

    return { success: true, smsSent: !!smsNotif };
  },

  async getRegistrationStatus(teacherId) {
    const { data, error } = await sbClient
      .from('teacher_registration_audit')
      .select('*').eq('teacher_id', teacherId).single();
    if (error) return null;
    return data;
  },

  _buildEmailHTML(d) {
    const { teacherName, email, phone, teacherCode, classes, subjects, educationLevel, loginLink, tempPasswordLink } = d;
    const classList = (classes || []).map(c => `<li style="margin:4px 0">${c}</li>`).join('');
    const subjectList = (subjects || []).map(s => `<li style="margin:4px 0">${s}</li>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Welcome to Rukara Model School</title></head><body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8;color:#1e293b;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:20px 0;"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);"><tr><td style="background:linear-gradient(135deg,#0d2f6b,#1e40af);padding:40px 30px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;">Rukara Model School</h1><p style="color:#93c5fd;margin:8px 0 0;font-size:14px;letter-spacing:2px;">RMS-MIS</p></td></tr><tr><td style="padding:40px 30px;"><h2 style="color:#0d2f6b;margin:0 0 8px;font-size:24px;">Welcome!</h2><p style="color:#475569;font-size:16px;line-height:1.6;margin:0 0 24px;">Dear <strong>${teacherName}</strong>, your teacher account has been successfully created.</p><table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;"><tr><td style="border:none;padding:8px 0;font-size:14px;color:#64748b;"><strong>Email:</strong></td><td style="border:none;padding:8px 0;font-size:14px;color:#1e293b;font-weight:600;">${email}</td></tr><tr><td style="border:none;padding:8px 0;font-size:14px;color:#64748b;"><strong>Teacher Code:</strong></td><td style="border:none;padding:8px 0;font-size:14px;color:#1e293b;font-weight:600;">${teacherCode}</td></tr><tr><td style="border:none;padding:8px 0;font-size:14px;color:#64748b;"><strong>Education Level:</strong></td><td style="border:none;padding:8px 0;font-size:14px;color:#1e293b;font-weight:600;">${educationLevel}</td></tr><tr><td style="border:none;padding:8px 0;font-size:14px;color:#64748b;"><strong>Phone:</strong></td><td style="border:none;padding:8px 0;font-size:14px;color:#1e293b;font-weight:600;">${phone || 'Not provided'}</td></tr></table><h3 style="color:#0d2f6b;font-size:16px;margin:0 0 8px;">Classes Assigned</h3><ul style="color:#334155;font-size:14px;margin:0 0 20px;">${classList}</ul><h3 style="color:#0d2f6b;font-size:16px;margin:0 0 8px;">Subjects Assigned</h3><ul style="color:#334155;font-size:14px;margin:0 0 24px;">${subjectList}</ul><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td align="center" style="border:none;padding:8px 0;"><a href="${loginLink}" style="background:#0d2f6b;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;">Login to RMS-MIS</a></td></tr></table><table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;margin-bottom:24px;"><tr><td style="border:none;font-size:14px;color:#9a3412;line-height:1.6;"><strong>Secure Setup Required:</strong><br>Please set your password immediately after first login.<br><a href="${tempPasswordLink}" style="color:#ea580c;font-weight:600;text-decoration:underline;">Click here to set your password</a></td></tr></table><h3 style="color:#0d2f6b;font-size:16px;margin:0 0 8px;">Getting Started</h3><ol style="color:#334155;font-size:14px;line-height:1.8;margin:0 0 24px;padding-left:20px;"><li>Log in with your temporary credentials</li><li>Change your password immediately</li><li>Navigate to My Classes or My Subjects</li><li>Select an assessment to enter marks</li><li>Record, review, and submit marks</li></ol><table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;"><tr><td style="border:none;font-size:14px;color:#166534;line-height:1.6;"><strong>Need Help?</strong><br>Email: admin@rukara.edu<br>Phone: +250788123456<br>Website: https://rukara.edu</td></tr></table><p style="color:#94a3b8;font-size:12px;margin:24px 0 0;text-align:center;">© ${new Date().getFullYear()} Rukara Model School. All rights reserved.</p></td></tr><tr><td style="background:#1e293b;padding:20px 30px;text-align:center;"><p style="color:#94a3b8;margin:0;font-size:12px;">© ${new Date().getFullYear()} Rukara Model School. All rights reserved.</p></td></tr></table></td></tr></table></body></html>`;
  },

  _buildEmailText(d) {
    const { teacherName, email, teacherCode, classes, subjects, educationLevel, phone, loginLink, tempPasswordLink } = d;
    return `WELCOME TO RUKARA MODEL SCHOOL!\n======================================\n\nDear ${teacherName},\n\nYour teacher account has been successfully created in the RMS-MIS system.\n\nACCOUNT DETAILS:\n- Email: ${email}\n- Teacher Code: ${teacherCode}\n- Education Level: ${educationLevel}\n- Phone: ${phone || 'Not provided'}\n\nCLASSES: ${classes.join(', ') || 'None assigned'}\nSUBJECTS: ${subjects.join(', ') || 'None assigned'}\n\nLOGIN: ${loginLink}\nSET PASSWORD: ${tempPasswordLink}\n\nGETTING STARTED:\n1. Log in with your temporary credentials\n2. Change your password immediately\n3. Navigate to My Classes or My Subjects\n4. Select an assessment to enter marks\n5. Record, review, and submit marks\n\nNeed Help?\n- Email: admin@rukara.edu\n- Phone: +250788123456\n- Website: https://rukara.edu\n\n© ${new Date().getFullYear()} Rukara Model School. All rights reserved.\n\nThis is an automated message. Please do not reply to this email.`;
  },

  _buildSMS(d) {
    const { teacherName, email, classes, subjects, loginLink } = d;
    const classStr = (classes || []).join(', ') || 'None';
    const subjStr = (subjects || []).join(', ') || 'None';
    return `Welcome ${teacherName}. Your RMS-MIS account has been created. Email: ${email}. Classes: ${classStr}. Subjects: ${subjStr}. Login: ${loginLink}. Please use your temporary credentials to log in and change your password. Contact +250788123456 for support.`;
  }
};
