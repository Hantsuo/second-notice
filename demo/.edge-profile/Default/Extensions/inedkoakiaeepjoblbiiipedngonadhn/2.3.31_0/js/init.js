/*
 * @Author: www.itab.link
 * @Date: 2022-01-07 22:32:28
 * @LastEditors: itab.link
 * @LastEditTime: 2023-04-28 11:22:17
 * @Description: 首屏壁纸闪现，缩短白屏感知
 */

try {
    const baseConfig = JSON.parse(localStorage.getItem("baseConfig") || "{}");
    const wallpaper = baseConfig.wallpaper || {};
    // type: 0/1 图片 2 视频(用 thumb) 3 纯色/渐变 4 其他图片
    if (wallpaper.type == 0 || wallpaper.type == 1 || wallpaper.type == 2 || wallpaper.type == 4) {
        let src = wallpaper.type == 2 ? wallpaper.thumb : (wallpaper.thumb || wallpaper.src);
        if (src) {
            const bodyBg = document.createElement("div");
            bodyBg.setAttribute("class", "body-bg");
            bodyBg.setAttribute(
                "style",
                `background-image:url(${src});filter: blur(${wallpaper.blur || 0}px);`
            );
            document.body.appendChild(bodyBg);
            // Vue 挂载壁纸后移除闪现层
            const remove = () => {
                if (bodyBg.parentNode) bodyBg.parentNode.removeChild(bodyBg);
            };
            setTimeout(remove, 2500);
            window.addEventListener("itab-wallpaper-ready", remove, { once: true });
        }
    } else if (wallpaper.type == 3 && wallpaper.src) {
        const bodyBg = document.createElement("div");
        bodyBg.setAttribute("class", "body-bg");
        bodyBg.setAttribute("style", `background:${wallpaper.src};`);
        document.body.appendChild(bodyBg);
        setTimeout(() => {
            if (bodyBg.parentNode) bodyBg.parentNode.removeChild(bodyBg);
        }, 2500);
    }
} catch (e) {}

// edge浏览器扩展模式下 启用此logo
let isEdge = !window.location.protocol.includes("http") && window.navigator.userAgent.includes("Edg");
if (isEdge) {
    const applyIcon = document.head.querySelector("link[rel=icon]");
    if (applyIcon) applyIcon.href = "logo/edge.ico";
}
