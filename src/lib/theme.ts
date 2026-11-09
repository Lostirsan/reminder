export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "theme";

/**
 * Runs inline in <head> before the first paint so there is no flash of the wrong theme.
 * Default is the browser/OS preference; a stored manual choice ("light"/"dark") overrides it.
 */
export const themeInitScript = `(function(){try{var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t=localStorage.getItem("${THEME_KEY}");d.classList.toggle("dark",t==="dark"||(t!=="light"&&m.matches))}a();m.addEventListener("change",a);window.addEventListener("storage",a);window.__applyTheme=a}catch(e){}})();`;
