'use strict';
(() => {
  const BASE='https://ozoulexfbrygiuawwhqn.supabase.co', $=id=>document.getElementById(id), storageKey='mobile-tasks-public-key-v1';
  let key='',pending=null,busy=false,catalog=null;
  const show=(text,error=false)=>{$('message').textContent=text;$('message').dataset.error=String(error);};
  const validKey=value=>/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(value);
  async function request(path,options={},token) {
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(BASE+path,{...options,signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...options.headers}});
      const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{throw new Error('response');}
      if(!response.ok){const error=new Error('http');error.status=response.status;error.code=data?.code;throw error;}
      return data;
    }finally{clearTimeout(timeout);}
  }
  const auth=new MobileSession({request,storage:localStorage,locks:navigator.locks});
  function loginView(){catalog=null;$('login').hidden=false;$('tasks').hidden=true;$('password').value='';$('identity').textContent='';}
  async function api(path,options={}){
    try{return await request(path,options,await auth.token());}
    catch(error){if([401,403].includes(error.status)||error.code==='42501'){auth.clear();loginView();}throw error;}
  }
  function options(element,rows,prompt){
    element.replaceChildren(); const p=document.createElement('option');p.value='';p.textContent=prompt;element.append(p);
    for(const row of rows){const o=document.createElement('option');o.value=String(row.id);o.textContent=row.name;element.append(o);}
  }
  function branches(){options($('branch'),catalog?.branches.filter(b=>String(b.company_id)===$('company').value)||[],'مهمة للشركة عمومًا');$('branch').disabled=!$('company').value;}
  $('company').addEventListener('change',branches);
  async function loadCatalog(){
    const rows=await api('/rest/v1/mobile_catalog?select=source_id,companies,branches,updated_at&owner_id=eq.'+encodeURIComponent(auth.value.user.id));
    if(!Array.isArray(rows)||rows.length!==1)throw new Error('catalog');
    catalog=rows[0];if(!Array.isArray(catalog.companies)||!Array.isArray(catalog.branches))throw new Error('catalog');
    options($('company'),catalog.companies,'اختر الشركة');branches();
    $('catalogStatus').textContent='آخر تحديث للقوائم: '+new Date(catalog.updated_at).toLocaleString('ar-SA');
  }
  async function enter(){
    await api('/rest/v1/rpc/register_mobile_device',{method:'POST',body:JSON.stringify({device_label:$('deviceName').value.trim()||'جهاز جوال'})});
    await loadCatalog();$('identity').textContent='متصل بحساب: '+(auth.value.user.email||'المستخدم الحالي');
    $('login').hidden=true;$('tasks').hidden=false;show(catalog.companies.length?'جاهز لإضافة مهمة.':'شغّل مزامنة الكمبيوتر أولًا لتحميل الشركات.');
  }
  function connected(){$('connection').hidden=true;$('login').hidden=false;$('reset').hidden=false;}
  $('configForm').addEventListener('submit',event=>{
    event.preventDefault();const value=$('publicKey').value.trim();if(!validKey(value))return show('أدخل مفتاح Publishable العام فقط.',true);
    if(key&&key!==value)auth.clear();key=value;
    try{if($('remember').checked)localStorage.setItem(storageKey,key);else localStorage.removeItem(storageKey);}catch{show('تعذر تذكّر إعداد الاتصال.',true);}
    $('publicKey').value='';connected();show('سجّل الدخول بحسابك الحالي.');
  });
  $('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;event.submitter.disabled=true;
    try{
      const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:$('email').value.trim(),password:$('password').value})});
      $('password').value='';auth.clear();if($('trust').checked)localStorage.setItem(storageKey,key);
      auth.accept(data,$('trust').checked);await enter();
    }catch(error){loginView();show([400,401].includes(error.status)?'تحقق من بيانات الدخول.':'تعذر تحميل قوائمك؛ تحقق من الاتصال ومزامنة الكمبيوتر ثم أعد المحاولة.',true);}
    finally{$('password').value='';busy=false;event.submitter.disabled=false;}
  });
  $('reloadCatalog').addEventListener('click',async()=>{if(busy||pending)return;try{await loadCatalog();show('تم تحديث القوائم.');}catch{show('تعذر تحديث القوائم.',true);}});
  function clearDraft(){pending=null;$('taskForm').reset();for(const e of $('taskFields').elements)e.disabled=false;branches();$('newTask').hidden=true;$('save').textContent='إضافة المهمة';}
  $('taskForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!auth.value)return;
    if(pending&&pending.owner_id!==auth.value.user.id)return show('المحاولة مرتبطة بحساب آخر. استخدم الحساب الأصلي.',true);
    if(!pending){
      const company=catalog?.companies.find(c=>String(c.id)===$('company').value);
      const branch=$('branch').value?catalog?.branches.find(b=>String(b.id)===$('branch').value&&String(b.company_id)===$('company').value):null;
      if(!company||!$('title').value.trim()||($('branch').value&&!branch))return show('اختر الشركة والفرع الصحيح وأدخل عنوان المهمة.',true);
      pending={id:crypto.randomUUID(),owner_id:auth.value.user.id,source_id:catalog.source_id,company_id:company.id,branch_id:branch?.id??null,company_name:company.name,branch_name:branch?.name??null,title:$('title').value.trim(),description:$('description').value.trim()||null,priority:$('priority').value,due_date:$('due').value||null};
    }
    busy=true;$('taskFields').disabled=true;$('logout').disabled=true;$('reset').disabled=true;$('reloadCatalog').disabled=true;show('جارٍ حفظ المهمة…');
    try{
      try{await api('/rest/v1/mobile_tasks',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(pending)});}
      catch(error){
        if(error.code!=='23505')throw error;
        const rows=await api('/rest/v1/mobile_tasks?select=*&id=eq.'+encodeURIComponent(pending.id)+'&owner_id=eq.'+encodeURIComponent(pending.owner_id));
        if(rows?.length!==1||Object.keys(pending).filter(k=>!['company_name','branch_name'].includes(k)).some(k=>rows[0][k]!==pending[k]))throw error;
      }
      clearDraft();show('تم حفظ المهمة بنجاح. ستظهر على الكمبيوتر عند المزامنة أثناء تشغيله.');
    }catch(error){
      $('save').textContent='التحقق وإعادة محاولة نفس المهمة';$('newTask').hidden=false;
      for(const e of $('taskFields').elements)e.disabled=e.id!=='save';
      show('لم يتأكد الحفظ؛ أعد محاولة المهمة نفسها دون تغيير بياناتها. عند انتهاء الجلسة سجّل الدخول بالحساب نفسه.',true);
    }finally{busy=false;$('taskFields').disabled=false;$('logout').disabled=false;$('reset').disabled=false;$('reloadCatalog').disabled=false;}
  });
  $('newTask').addEventListener('click',()=>{if(confirm('قد تكون المهمة السابقة حُفظت. هل تريد بدء مهمة جديدة؟')){clearDraft();show('يمكنك إدخال مهمة جديدة.');}});
  function sessionId(token){return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id;}
  async function logout(){
    if(busy)return;busy=true;
    try{
      if(auth.value){const token=await auth.token();await api('/rest/v1/rpc/revoke_mobile_device',{method:'POST',body:JSON.stringify({target_session:sessionId(token)})});try{await request('/auth/v1/logout?scope=local',{method:'POST'},token);}catch{}}
      auth.clear();clearDraft();loginView();show('تم إلغاء ثقة هذا الجهاز وتسجيل الخروج.');
    }catch{auth.clear();clearDraft();loginView();show('انتهت الجلسة محليًا؛ تعذر تأكيد إلغاء الثقة. ألغها من الكمبيوتر عند توفر الاتصال.',true);}
    finally{busy=false;}
  }
  $('logout').addEventListener('click',logout);
  $('reset').addEventListener('click',async()=>{if(busy)return;await logout();key='';try{localStorage.removeItem(storageKey);}catch{}$('login').hidden=true;$('connection').hidden=false;$('reset').hidden=true;});
  window.addEventListener('pagehide',()=>{$('password').value='';});
  window.addEventListener('storage',event=>{if(event.key===auth.name&&event.newValue===null){auth.value=null;loginView();show('أُغلقت الجلسة من نافذة أخرى.');}});
  async function resume(){if(!auth.value||busy)return;busy=true;try{await enter();}catch{loginView();show('تعذر استعادة الاتصال؛ أعد المحاولة أو سجّل الدخول. لن تُحذف الجلسة بسبب انقطاع الشبكة.',true);}finally{busy=false;}}
  window.addEventListener('pageshow',event=>{if(event.persisted)resume();});$('resume').addEventListener('click',resume);
  window.addEventListener('beforeunload',event=>{if(busy||pending||$('title').value){event.preventDefault();event.returnValue='';}});
  try{const saved=localStorage.getItem(storageKey);if(saved&&validKey(saved)){key=saved;connected();if(auth.restore())resume();}}
  catch{show('التخزين غير متاح؛ استخدم الدخول لهذه الزيارة.',true);}
})();
