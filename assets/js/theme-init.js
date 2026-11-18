document.documentElement.classList.add("js"); // hides the crawler copy of the page once scripts run
// Applies the saved light/dark preference before first paint.
(function () { try { var t = localStorage.getItem("fj-theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch (e) {} })();
