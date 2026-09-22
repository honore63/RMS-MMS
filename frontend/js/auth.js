const Auth = {
  currentUser: null,
  userProfile: null,
  teacherProfile: null,

  async signIn(email, password) {
    const { data, error } = await sbClient.auth.signInWithPassword({ email, password });

    if (error) {
      const msg = error.message || '';
      console.error('LOGIN ERROR:', msg);

      if (msg.includes('Email logins are disabled') || msg.includes('Email provider is disabled')) {
        throw new Error('EMAIL_PROVIDER_DISABLED');
      }
      if (msg.includes('Email not confirmed')) {
        throw new Error('EMAIL_NOT_CONFIRMED');
      }
      if (msg.includes('Invalid login') || msg.includes('invalid credentials') || msg.includes('User not found')) {
        throw new Error('INVALID_CREDENTIALS');
      }
      throw new Error(msg);
    }

    if (data?.user) {
      await this.fetchOrCreateProfile(data.user);
    }
    return data?.user;
  },

  async signOut() {
    await sbClient.auth.signOut();
    this.currentUser = null;
    this.userProfile = null;
    this.teacherProfile = null;
  },

  generateTeacherCode() {
    // 11-digit numeric code (must match teachers_teacher_code_format: ^[0-9]{11}$)
    return '541' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  },

  async ensureTeacherRow(data, authUser) {
    // Auto-create the teachers row for a logged-in teacher that has a users row
    // but no teachers row yet (unique 11-digit code, retries on collision).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.generateTeacherCode();
      const { error } = await sbClient.from('teachers').insert([{
        user_id: authUser.id,
        teacher_code: code,
        full_name: data.full_name,
        email: data.email || authUser.email,
        status: 'active'
      }]);
      if (!error) return code;
      if (!/duplicate|unique/i.test(error?.message || '')) break;
    }
    return null;
  },

  async fetchOrCreateProfile(authUser) {
    let { data, error: selectError } = await sbClient.from('users').select('*').eq('id', authUser.id).maybeSingle();

    if (selectError) {
      this.currentUser = null;
      return null;
    }

    if (!data) {
      try {
        const isAdmin = authUser.email.includes('dos') || authUser.email.includes('admin');
        const role = isAdmin ? 'dos' : 'teacher';
        const name = authUser.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        ({ data, error: selectError } = await sbClient.from('users').insert([{
          id: authUser.id,
          email: authUser.email,
          full_name: name,
          role: role,
          status: 'active'
        }]).select().single());

        if (selectError) {
          console.error('PROFILE CREATE ERROR:', selectError.message);
          data = null;
        }
      } catch (err) {
        console.error('PROFILE SYNC ERROR:', err.message);
        data = null;
      }
    }

    this.currentUser = data;

    if (data && data.role === 'teacher') {
      const { data: t, error: tErr } = await sbClient.from('teachers').select('*').eq('user_id', authUser.id).maybeSingle();
      if (!t && !tErr) {
        // users row exists but teachers row is missing — recover by creating it
        await this.ensureTeacherRow(data, authUser);
        const { data: t2 } = await sbClient.from('teachers').select('*').eq('user_id', authUser.id).maybeSingle();
        this.teacherProfile = t2 || null;
      } else {
        this.teacherProfile = t || null;
      }
    }
    return data;
  },

  async resetPassword(email) {
    const { error } = await sbClient.auth.resetPasswordForEmail(email);
    return error;
  },

  async init() {
    const { data: { session } } = await sbClient.auth.getSession();
    if (session?.user) {
      await this.fetchOrCreateProfile(session.user);
      return true;
    }
    return false;
  },

  getRole() { return this.currentUser?.role || null; },
  getTeacherId() { return this.teacherProfile?.id || null; },
  isAdmin() { return this.getRole() === 'dos'; },
  isTeacher() { return this.getRole() === 'teacher'; }
};
