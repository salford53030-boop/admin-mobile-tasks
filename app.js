'use strict';
(() => {
  const BASE = 'https://ozoulexfbrygiuawwhqn.supabase.co';
  const $ = id => document.getElementById(id);
  let key = '', session = null, pending = null, busy = false;
  const storageKey = 'mobile-tasks-public-key-v1';
  const show = (text, error = false) => { $('message').textContent = text; $('message').dataset.error = String(error); };
  function validKey(value) { return /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(value); }
  async function request(path, options = {}, token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(BASE + path, { ...options, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { apikey: key, ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json', ...options.headers } });
      const text = await response.text();
      let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) { const error = new Error('http'); error.status = response.status; error.code = data?.code; throw error; }
      return data;
    } finally { clearTimeout(timeout); }
  }
  function endSession() { session = null; $('login').hidden = false; $('tasks').hidden = true; $('password').value = ''; $('identity').textContent = ''; }
  async function accessToken() {
    if (!session) throw new Error('session');
    if (Date.now() >= session.expiresAt - 60000) {
      try {
        const data = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) });
        session = { ...data, expiresAt: Date.now() + data.expires_in * 1000 };
      } catch (error) { endSession(); throw error; }
    }
    return session.access_token;
  }
  $('configForm').addEventListener('submit', event => {
    event.preventDefault(); const value = $('publicKey').value.trim();
    if (!validKey(value)) return show('المطلوب مفتاح يبدأ بـ sb_publishable_ فقط. لا تدخل أي مفتاح سري.', true);
    key = value;
    try { if ($('remember').checked) localStorage.setItem(storageKey, key); else localStorage.removeItem(storageKey); } catch { show('تعذر حفظ الإعداد؛ سيُستخدم لهذه الجلسة فقط.'); }
    $('publicKey').value = ''; $('connection').hidden = true; $('login').hidden = false; $('reset').hidden = false; show('الاتصال جاهز. سجّل الدخول بحسابك الحالي.');
  });
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; busy = true;
    const button = event.submitter; button.disabled = true; show('جارٍ تسجيل الدخول والتحقق من الجدول…');
    try {
      const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) });
      $('password').value = '';
      session = { ...data, expiresAt: Date.now() + data.expires_in * 1000 };
      const user = await request('/auth/v1/user', {}, session.access_token);
      if (!user?.id) throw new Error('session');
      session.user = user;
      await request('/rest/v1/mobile_tasks?select=id,owner_id,company_name,branch_name,title,description,priority,due_date&limit=0', {}, session.access_token);
      $('identity').textContent = 'متصل بحساب: ' + (user.email || 'المستخدم الحالي');
      $('login').hidden = true; $('tasks').hidden = false; show('تم تسجيل الدخول. يمكنك الآن إضافة مهمة.');
    } catch (error) { endSession(); show(error.status === 400 || error.status === 401 ? 'تعذر الدخول. تحقق من البريد وكلمة المرور والمفتاح العام.' : 'تعذر التحقق من الاتصال أو أعمدة الجدول وصلاحياته. راجع الإعدادات ثم أعد المحاولة.', true); }
    finally { $('password').value = ''; busy = false; button.disabled = false; }
  });
  $('taskForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !session) return;
    if (!$('company').value.trim() || !$('title').value.trim()) return show('أدخل الشركة وعنوان المهمة.', true);
    if (pending && pending.owner_id !== session.user.id) return show('هذه المحاولة مرتبطة بحساب آخر. سجّل الدخول بالحساب الأصلي أو ابدأ مهمة جديدة.', true);
    if (!pending) pending = { id: crypto.randomUUID(), owner_id: session.user.id, company_name: $('company').value.trim(), branch_name: $('branch').value.trim() || null, title: $('title').value.trim(), description: $('description').value.trim() || null, priority: $('priority').value, due_date: $('due').value || null };
    // Keep the same UUID and payload after an ambiguous response; never retry automatically.
    busy = true; $('taskFields').disabled = true; $('logout').disabled = true; $('reset').disabled = true; show('جارٍ حفظ المهمة…');
    try {
      const token = await accessToken();
      try { await request('/rest/v1/mobile_tasks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(pending) }, token); }
      catch (error) {
        if (error.code !== '23505') throw error;
        const rows = await request('/rest/v1/mobile_tasks?select=id,owner_id&id=eq.' + encodeURIComponent(pending.id) + '&owner_id=eq.' + encodeURIComponent(session.user.id), {}, token);
        if (rows?.length !== 1) throw error;
      }
      clearDraft(); $('taskFields').disabled = false; show('تم حفظ المهمة في Supabase بنجاح. المزامنة المحلية لم تُربط بعد.');
    } catch (error) {
      if (error.status === 401) endSession();
      $('save').disabled = false; $('save').textContent = 'التحقق وإعادة محاولة نفس المهمة'; $('newTask').hidden = false;
      // Only the retry button is re-enabled; keep the uncertain payload unchanged.
      $('taskFields').disabled = false;
      for (const element of $('taskFields').elements) if (element.id !== 'save') element.disabled = true;
      show('لم يتأكد الحفظ. احتُفظ بالمهمة في هذه الصفحة؛ أعد محاولة نفس المهمة. إذا انتهت الجلسة، سجّل الدخول بالحساب نفسه.', true);
    } finally { busy = false; $('logout').disabled = false; $('reset').disabled = false; }
  });
  function clearDraft() { pending = null; $('taskForm').reset(); for (const element of $('taskFields').elements) element.disabled = false; $('newTask').hidden = true; $('save').textContent = 'إضافة المهمة'; }
  $('newTask').addEventListener('click', () => { if (confirm('قد تكون المهمة السابقة حُفظت بالفعل. هل تريد تركها وبدء مهمة جديدة؟')) { clearDraft(); show('يمكنك إدخال مهمة جديدة.'); } });
  $('logout').addEventListener('click', async () => {
    if (busy) return; const token = session?.access_token; endSession(); clearDraft(); show('تم إنهاء الجلسة على هذه الصفحة.');
    if (token) { try { await request('/auth/v1/logout?scope=local', { method: 'POST' }, token); } catch { show('انتهت الجلسة محليًا؛ تعذر تأكيد إلغائها لدى الخادم.', true); } }
  });
  $('reset').addEventListener('click', () => { endSession(); clearDraft(); key = ''; try { localStorage.removeItem(storageKey); } catch {} $('login').hidden = true; $('connection').hidden = false; $('reset').hidden = true; show('أدخل المفتاح العام للمشروع.'); });
  window.addEventListener('beforeunload', event => { if (busy || pending || $('title').value || $('description').value || $('company').value) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { session = null; $('password').value = ''; });
  window.addEventListener('pageshow', event => { if (event.persisted) { endSession(); show('سجّل الدخول مجددًا للمتابعة.'); } });
  try { const saved = localStorage.getItem(storageKey); if (saved && validKey(saved)) { $('publicKey').value = saved; $('remember').checked = true; } } catch {}
})();