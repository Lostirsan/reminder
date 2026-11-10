export type ThemeChoice = "light" | "dark";
export const THEME_KEY = "theme";

/**
 * Runs inline in <head> before the first paint so there is no flash of the wrong theme.
 * First visit: light or dark from the browser preference, saved as the choice; after that the
 * saved choice is used and only the toggle changes it.
 */
export const themeInitScript = `(function(){try{var d=document.documentElement;function a(){var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";try{localStorage.setItem("${THEME_KEY}",t)}catch(e){}}d.classList.toggle("dark",t==="dark")}a();window.addEventListener("storage",a);window.__applyTheme=a}catch(e){}})();`;
