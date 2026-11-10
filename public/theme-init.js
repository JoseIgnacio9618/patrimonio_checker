// External and blocking so a saved dark theme is applied before the first paint under CSP.
(() => {
  let preference = "system";
  try {
    const saved = localStorage.getItem("patrimonio-theme");
    if (["light", "dark", "system"].includes(saved)) preference = saved;
  } catch {
    /* Storage may be unavailable in private or restricted contexts. */
  }
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
