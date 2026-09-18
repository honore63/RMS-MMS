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

  async fetchOrCreateProfile(authUser) {
    let { data, error: selectError } = await sbClient.from('users').select('*').eq('id', authUser.id).single();

    if (selectError && selectError.code !== 'PGRST116') {
      this.currentUser = null;
      return null;
    }
    if (selectError && selectError.code === 'PGRST116') {
      data = null;
    }

    if (!data) {
      try {
        const isAdmin = authUser.email.includes('dos') || authUser.email.includes('admin');
        const role = isAdmin ? 'dos' : 'teacher';
        const name = authUser.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        await sbClient.from('users').insert([{
          id: authUser.id,
          email: authUser.email,
          full_name: name,
          role: role,
          status: 'active'
        }]);

        if (role === 'teacher') {
          const code = 'T' + String(Math.floor(Math.random() * 900) + 100);
          await sbClient.from('teachers').insert([{
            user_id: authUser.id,
            teacher_code: code,
            full_name: name,
            email: authUser.email,
            status: 'active'
          }]);
        }

        ({ data } = await sbClient.from('users').select('*').eq('id', authUser.id).single());
      } catch (err) {
        console.error('PROFILE SYNC ERROR:', err.message);
        data = null;
      }
    }

    this.currentUser = data;

    if (data && data.role === 'teacher') {
      const { data: t } = await sbClient.from('teachers').select('*').eq('user_id', authUser.id).single();
      this.teacherProfile = t;
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
