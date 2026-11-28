// M3 Dark is the default shell palette; keep it applied before first paint.
try {
  document.documentElement.classList.remove("light");
  document.documentElement.classList.add("dark");
  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", "#0E1113");
} catch {
  // The CSS root tokens remain dark even if the document cannot be updated.
}
