'use strict';
// First-party SPA session store: never persists a password or an access token.
// CSP and same-origin script hygiene are required; browser storage is not HttpOnly.
class MobileSession {
  constructor({request,storage,locks,now=Date.now}) {
    Object.assign(this,{request,storage,locks,now});
    this.name='abu-kinan-mobile-session-v2'; this.value=null; this.trusted=false; this.refreshing=null;
  }
  restore() {
    const saved=JSON.parse(this.storage.getItem(this.name)||'null');
    if (saved?.refresh_token && saved?.user?.id) {this.value={...saved,access_token:null,expiresAt:0};this.trusted=true;}
    return !!this.value;
  }
  accept(data, trusted=this.trusted) {
    if (!data?.access_token || !data.refresh_token || !data.user?.id || !(data.expires_in>0)) throw new Error('session');
    if(this.value && data.user.id!==this.value.user.id) throw new Error('owner');
    this.value={access_token:data.access_token,refresh_token:data.refresh_token,user:{id:data.user.id,email:data.user.email},expiresAt:this.now()+data.expires_in*1000};
    this.trusted=trusted;
    if(trusted) this.storage.setItem(this.name,JSON.stringify({refresh_token:this.value.refresh_token,user:this.value.user}));
    else this.storage.removeItem(this.name);
  }
  clear() {this.value=null;this.trusted=false;try{this.storage.removeItem(this.name);}catch{}}
  async token() {
    if (!this.value) throw new Error('session');
    if(this.value.access_token && this.value.expiresAt>this.now()+60000) return this.value.access_token;
    if(this.refreshing) return this.refreshing;
    const refresh=async()=>{
      if (!this.value) throw new Error('session');
      if(this.trusted) {
        const saved=JSON.parse(this.storage.getItem(this.name)||'null');
        if(!saved || saved.user.id!==this.value.user.id) {this.clear();throw new Error('session');}
        this.value.refresh_token=saved.refresh_token;
      }
      const previous=this.value;
      try {
        const data=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:previous.refresh_token})});
        if(this.value!==previous) throw new Error('session');
        this.accept(data); return this.value.access_token;
      } catch(error) {
        // Offline and server failures must not destroy a valid refresh token.
        if([400,401,403].includes(error.status)) this.clear();
        throw error;
      }
    };
    this.refreshing=(this.locks ? this.locks.request(this.name,refresh) : refresh()).finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }
}
if(typeof module!=='undefined') module.exports={MobileSession};
