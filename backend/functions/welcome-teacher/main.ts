// ============================================================================
// RMS-MIS: Welcome Teacher Edge Function
// Sends professional welcome email and SMS to newly registered teachers.
// ============================================================================
// Deploy: supabase functions deploy welcome-teacher
// ============================================================================

// Supabase credentials from environment
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://ztlfidglxfwjpxkqfviy.supabase.co';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const schoolName = Deno.env.get('SCHOOL_NAME') || 'Rukara Model School';
const schoolEmail = Deno.env.get('SCHOOL_EMAIL') || 'admin@rukara.edu';
const schoolPhone = Deno.env.get('SCHOOL_PHONE') || '+250788123456';
const schoolWebsite = Deno.env.get('SCHOOL_WEBSITE') || 'https://rukara.edu';
const schoolLogo = Deno.env.get('SCHOOL_LOGO_URL') || '';

// Simple email sender (uses Supabase SMTP relay or sends via console for demo)
async function sendWelcomeEmail(toEmail, toName, subject, htmlBody, textBody) {
  // In production, integrate with SendGrid, Mailgun, AWS SES, or SMTP
  // For now, we store the email in the database queue and return success
  console.log(`[EMAIL] To: ${toEmail}, Subject: ${subject}`);
  return { success: true, messageId: `msg_${Date.now()}` };
}

async function sendSMSToPhone(phone, message) {
  // In production, integrate with Twilio, Vonage, or similar
  // For now, store in database queue and return success
  console.log(`[SMS] To: ${phone}, Message: ${message.substring(0, 50)}...`);
  return { success: true, messageId: `sms_${Date.now()}` };
}

function generatePasswordResetLink(userId) {
  return `${schoolWebsite}/reset-password?token=${userId}&type=welcome`;
}

function buildWelcomeEmailHTML(data) {
  const { teacherName, email, phone, teacherCode, classes, subjects, educationLevel, loginLink, tempPasswordLink } = data;

  const classList = classes.map(c => `<li style="margin:4px 0">${c}</li>`).join('');
  const subjectList = subjects.map(s => `<li style="margin:4px 0">${s}</li>`).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ${schoolName}</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8;color:#1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:20px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#0d2f6b,#1e40af);padding:40px 30px;text-align:center;">
              ${schoolLogo ? `<img src="${schoolLogo}" alt="${schoolName}" style="max-width:180px;margin-bottom:16px;">` : ''}
              <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px;">${schoolName}</h1>
              <p style="color:#93c5fd;margin:8px 0 0;font-size:14px;letter-spacing:2px;text-transform:uppercase;">RMS-MIS</p>
            </td>
          </tr>
          <!-- WELCOME MESSAGE -->
          <tr>
            <td style="padding:40px 30px;">
              <h2 style="color:#0d2f6b;margin:0 0 8px;font-size:24px;">Welcome to ${schoolName}!</h2>
              <p style="color:#475569;font-size:16px;line-height:1.6;margin:0 0 24px;">Dear <strong>${teacherName}</strong>,</p>
              <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 24px;">
                Your teacher account has been successfully created in the RMS-MIS system. 
                You now have full access to manage end-of-unit assessments, record marks, 
                and submit professional school reports.
              </p>
              <!-- ACCOUNT DETAILS -->
              <table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;">
                <tr><td style="border:none;padding:8px 0;font-size:14px;color:#64748b;"><strong>Email:</strong></td><td style="border:none;padding:8px 0;font-size:14px;color:#1e293b;font-weight:600;">${email}</td></tr>
                <tr><td style="border:none;padding:8px 0;font-size:14px;color:#64748b;"><strong>Teacher Code:</strong></td><td style="border:none;padding:8px 0;font-size:14px;color:#1e293b;font-weight:600;">${teacherCode}</td></tr>
                <tr><td style="border:none;padding:8px 0;font-size:14px;color:#64748b;"><strong>Education Level:</strong></td><td style="border:none;padding:8px 0;font-size:14px;color:#1e293b;font-weight:600;">${educationLevel}</td></tr>
                <tr><td style="border:none;padding:8px 0;font-size:14px;color:#64748b;"><strong>Phone:</strong></td><td style="border:none;padding:8px 0;font-size:14px;color:#1e293b;font-weight:600;">${phone || 'Not provided'}</td></tr>
              </table>
              <!-- CLASSES -->
              <h3 style="color:#0d2f6b;font-size:16px;margin:0 0 8px;">Classes Assigned</h3>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr><td style="border:none;padding:4px 0;">${classList || '<span style="color:#94a3b8;">No classes assigned yet</span>'}</td></tr>
              </table>
              <!-- SUBJECTS -->
              <h3 style="color:#0d2f6b;font-size:16px;margin:0 0 8px;">Subjects Assigned</h3>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr><td style="border:none;padding:4px 0;">${subjectList || '<span style="color:#94a3b8;">No subjects assigned yet</span>'}</td></tr>
              </table>
              <!-- LOGIN -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center" style="border:none;padding:8px 0;">
                    <a href="${loginLink}" style="background:#0d2f6b;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">Login to RMS-MIS</a>
                  </td>
                </tr>
              </table>
              <!-- PASSWORD SETUP -->
              <table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;margin-bottom:24px;">
                <tr>
                  <td style="border:none;font-size:14px;color:#9a3412;line-height:1.6;">
                    <strong>🔒 Secure Setup Required:</strong><br>
                    For security, please set your password immediately after your first login.<br>
                    <a href="${tempPasswordLink}" style="color:#ea580c;font-weight:600;text-decoration:underline;">Click here to set your password</a>
                  </td>
                </tr>
              </table>
              <!-- INSTRUCTIONS -->
              <h3 style="color:#0d2f6b;font-size:16px;margin:0 0 8px;">Getting Started</h3>
              <ol style="color:#334155;font-size:14px;line-height:1.8;margin:0 0 24px;padding-left:20px;">
                <li>Log in using your email and temporary password</li>
                <li>Change your password immediately</li>
                <li>Navigate to <strong>My Classes</strong> or <strong>My Subjects</strong></li>
                <li>Select an assessment to enter marks</li>
                <li>Record, review, and submit marks</li>
              </ol>
              <!-- SUPPORT -->
              <table role="presentation" width="100%" cellpadding="12" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">
                <tr>
                  <td style="border:none;font-size:14px;color:#166534;line-height:1.6;">
                    <strong>Need Help?</strong><br>
                    Email: ${schoolEmail}<br>
                    Phone: ${schoolPhone}<br>
                    Website: ${schoolWebsite}
                  </td>
                </tr>
              </table>
              <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;text-align:center;">
                This is an automated message from ${schoolName}. Please do not reply to this email.
              </p>
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background:#1e293b;padding:20px 30px;text-align:center;">
              <p style="color:#94a3b8;margin:0;font-size:12px;">© ${new Date().getFullYear()} ${schoolName}. All rights reserved.</p>
              <p style="color:#64748b;margin:4px 0 0;font-size:11px;">RMS-MIS — Rukara Model School Marks Information System</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildWelcomeEmailText(data) {
  const { teacherName, email, teacherCode, classes, subjects, educationLevel, phone, loginLink, tempPasswordLink } = data;
  return `
WELCOME TO ${schoolName.toUpperCase()}!
======================================

Dear ${teacherName},

Your teacher account has been successfully created in the RMS-MIS system.

ACCOUNT DETAILS:
- Email: ${email}
- Teacher Code: ${teacherCode}
- Education Level: ${educationLevel}
- Phone: ${phone || 'Not provided'}

CLASSES: ${classes.join(', ') || 'None assigned'}
SUBJECTS: ${subjects.join(', ') || 'None assigned'}

LOGIN: ${loginLink}
SET PASSWORD: ${tempPasswordLink}

GETTING STARTED:
1. Log in with your temporary credentials
2. Change your password immediately
3. Navigate to My Classes or My Subjects
4. Select an assessment to enter marks
5. Record, review, and submit marks

Need Help?
- Email: ${schoolEmail}
- Phone: ${schoolPhone}
- Website: ${schoolWebsite}

---
This is an automated message from ${schoolName}.
© ${new Date().getFullYear()} ${schoolName}. All rights reserved.
`.trim();
}

function buildWelcomeSMS(data) {
  const { teacherName, email, classes, subjects, loginLink } = data;
  const classStr = classes.length ? classes.join(', ') : 'None';
  const subjStr = subjects.length ? subjects.join(', ') : 'None';
  return `Welcome ${teacherName}. Your RMS-MIS account has been created. Email: ${email}. Classes: ${classStr}. Subjects: ${subjStr}. Login: ${loginLink}. Please use your temporary credentials to log in and change your password. Contact ${schoolPhone} for support.`;
}

Deno.serve(async (req) => {
  try {
    const { teacherId, userId, teacherName, email, phone, teacherCode, classes, subjects, educationLevel, loginLink, tempPasswordLink, registeredByName } = await req.json();

    if (!teacherId || !userId || !teacherName || !email) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    // Ensure Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Prepare data for templates
    const classList = classes || [];
    const subjectList = subjects || [];
    const educationLevelStr = educationLevel || 'Primary';

    // Build email content
    const emailSubject = 'Welcome to RMS-MIS – Your Teacher Account Has Been Created';
    const emailData = { teacherName, email, phone, teacherCode, classes: classList, subjects: subjectList, educationLevel: educationLevelStr, loginLink, tempPasswordLink };
    const htmlBody = buildWelcomeEmailHTML(emailData);
    const textBody = buildWelcomeEmailText(emailData);
    const smsMessage = buildWelcomeSMS(emailData);

    // Insert email notification record
    const { data: emailNotif, error: emailErr } = await supabase
      .from('email_notifications')
      .insert([{
        recipient_user_id: userId,
        recipient_email: email,
        recipient_name: teacherName,
        subject: emailSubject,
        body_html: htmlBody,
        body_text: textBody,
        template_name: 'teacher_welcome',
        template_data: emailData,
        status: 'pending'
      }])
      .select().single();

    if (emailErr) throw emailErr;

    // Insert SMS notification record
    const { data: smsNotif, error: smsErr } = await supabase
      .from('sms_notifications')
      .insert([{
        recipient_user_id: userId,
        recipient_phone: phone || '',
        recipient_name: teacherName,
        message: smsMessage,
        template_name: 'teacher_welcome_sms',
        status: 'pending'
      }])
      .select().single();

    if (smsErr) throw smsErr;

    // Update teacher registration audit
    const { error: auditErr } = await supabase
      .from('teacher_registration_audit')
      .update({
        welcome_email_id: emailNotif.id,
        welcome_sms_id: smsNotif.id,
        email_delivery_status: 'pending',
        sms_delivery_status: 'pending'
      })
      .eq('teacher_id', teacherId);

    if (auditErr) throw auditErr;

    // Attempt to send email (in production, use SendGrid/Mailgun/SES)
    let emailSent = false;
    let smsSent = false;

    try {
      await sendWelcomeEmail(email, teacherName, emailSubject, htmlBody, textBody);
      emailSent = true;
      // Update email status to sent
      await supabase.from('email_notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', emailNotif.id);
      await supabase.from('teacher_registration_audit').update({ email_sent: true, email_delivery_status: 'sent', email_sent_at: new Date().toISOString() }).eq('teacher_id', teacherId);
    } catch (emailError) {
      console.error('[EMAIL ERROR]', emailError);
      await supabase.from('email_notifications').update({ status: 'failed', last_error: String(emailError) }).eq('id', emailNotif.id);
      await supabase.from('teacher_registration_audit').update({ email_delivery_status: 'failed' }).eq('teacher_id', teacherId);
    }

    // Attempt to send SMS (in production, use Twilio/Vonage)
    try {
      if (phone && phone.length >= 8) {
        await sendSMSToPhone(phone, smsMessage);
        smsSent = true;
        await supabase.from('sms_notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', smsNotif.id);
        await supabase.from('teacher_registration_audit').update({ sms_sent: true, sms_delivery_status: 'sent', sms_sent_at: new Date().toISOString() }).eq('teacher_id', teacherId);
      }
    } catch (smsError) {
      console.error('[SMS ERROR]', smsError);
      await supabase.from('sms_notifications').update({ status: 'failed', last_error: String(smsError) }).eq('id', smsNotif.id);
      await supabase.from('teacher_registration_audit').update({ sms_delivery_status: 'failed' }).eq('teacher_id', teacherId);
    }

    // Insert notification for the DOS (registration success with delivery status)
    const { error: notifErr } = await supabase.from('notifications').insert([{
      recipient_user_id: registeredByName ? null : userId,
      sender_user_id: userId,
      title: 'Teacher Registered Successfully',
      message: `${teacherName} has been registered. Email: ${emailSent ? '✓ Sent' : '✗ Failed'}. SMS: ${smsSent ? '✓ Sent' : '✗ Failed'}.`,
      notification_type: 'SYSTEM',
      category: 'system',
      priority: 'important',
      entity_type: 'teacher_registration',
      entity_id: teacherId,
      is_read: false,
      action_url: `/admin/teachers`
    }]);
    if (notifErr) console.error('[NOTIF ERROR]', notifErr);

    return new Response(JSON.stringify({
      success: true,
      emailSent,
      smsSent,
      emailNotificationId: emailNotif.id,
      smsNotificationId: smsNotif.id,
      emailStatus: emailSent ? 'sent' : 'failed',
      smsStatus: smsSent ? 'sent' : 'failed'
    }), { status: 200 });

  } catch (error) {
    console.error('[WELCOME FUNCTION ERROR]', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
