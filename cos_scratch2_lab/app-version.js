window.COS_SCRATCH_VERSION = "2026.11.04.25";
document.querySelectorAll("[data-app-version]").forEach(element => {
  element.textContent = "v" + window.COS_SCRATCH_VERSION;
  element.title = "COS Scratch 연습실 버전 " + window.COS_SCRATCH_VERSION;
});
document.title = "COS Scratch 2.0 실전 연습 · v" + window.COS_SCRATCH_VERSION;
