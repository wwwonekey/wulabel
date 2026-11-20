// 先定好浅色 / 深色，免得启动时闪一下深色（和 src/theme.ts 的规则一样）
(function () {
  var s = "auto";
  try {
    s = localStorage.getItem("xlabel.theme") || "auto";
  } catch (e) {}
  var dark = s === "dark" || (s !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
