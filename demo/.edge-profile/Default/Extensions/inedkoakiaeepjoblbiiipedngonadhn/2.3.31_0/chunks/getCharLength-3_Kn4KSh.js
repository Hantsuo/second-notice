function r(r){return r.charCodeAt(0)>255?2:1}function t(t,n=12){if(!t)return"";let o=0,e="";for(const f of String(t)){const t=r(f);if(o+t>n)break;o+=t,e+=f}return e}export{t as s};
