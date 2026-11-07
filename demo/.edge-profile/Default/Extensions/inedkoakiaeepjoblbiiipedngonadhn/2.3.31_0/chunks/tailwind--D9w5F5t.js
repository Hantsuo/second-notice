import{y as t}from"./vendor-vue-Nq1w0RH7.js";const o=(t,o)=>{const e=t.__vccOpts||t;for(const[r,s]of o)e[r]=s;return e};
/**
 * @license @tabler/icons-vue v3.46.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */var e={outline:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"},filled:{xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"currentColor",stroke:"none"}};
/**
 * @license @tabler/icons-vue v3.46.0 - MIT
 *
 * This source code is licensed under the MIT license.
 * See the LICENSE file in the root directory of this source tree.
 */const r=(o,r,s,l)=>({color:s="currentColor",size:i=24,stroke:n=2,title:c,class:w,...h},{attrs:a,slots:d})=>{let u=[...l.map(o=>t(...o)),...d.default?[d.default()]:[]];return c&&(u=[t("title",c),...u]),t("svg",{...e[o],width:i,height:i,...a,class:["tabler-icon",`tabler-icon-${r}`],..."filled"===o?{fill:s}:{"stroke-width":n??e[o]["stroke-width"],stroke:s},...h},u)};export{o as _,r as c};
