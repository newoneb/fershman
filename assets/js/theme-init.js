// Applies the saved light/dark preference before first paint.
(function () { try { var t = localStorage.getItem("fj-theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch (e) {} })();
