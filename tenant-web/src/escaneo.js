/* Movimiento visual de la portada (escaneo 3D). No toca pagos, catálogo ni el acuerdo. */
(function () {
  "use strict";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var card = document.getElementById("scan-card");
  var stage = card && card.closest(".scan-stage");
  if (stage) {
    var nm = document.getElementById("scan-name"), ct = document.getElementById("scan-count"), bar = stage.querySelector(".preview-bar i");
    var names = ["C. Ramírez", "M. Torres", "L. Gómez", "A. Pardo", "J. Rueda"], n = 1248, i = 0;
    if (reduce) { stage.classList.add("done"); }
    else {
      stage.addEventListener("pointermove", function (e) {
        var r = stage.getBoundingClientRect();
        stage.style.setProperty("--ry", ((e.clientX - r.left) / r.width - .5) * 18 + "deg");
        stage.style.setProperty("--rx", -((e.clientY - r.top) / r.height - .5) * 14 + "deg");
      });
      stage.addEventListener("pointerleave", function () { stage.style.setProperty("--rx", "0deg"); stage.style.setProperty("--ry", "0deg"); });
      var cycle = function () {
        stage.classList.remove("scanning", "done"); void stage.offsetWidth; stage.classList.add("scanning");
        setTimeout(function () {
          i = (i + 1) % names.length; n += 1;
          nm.textContent = names[i]; ct.textContent = n.toLocaleString("es-CO");
          bar.style.width = Math.min(100, n / 16) + "%"; stage.classList.add("done");
        }, 2200);
      };
      cycle(); setInterval(cycle, 4800);
    }
  }
  if (reduce || !("IntersectionObserver" in window)) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("rv-in"); io.unobserve(e.target); } });
  }, { threshold: .15 });
  document.querySelectorAll(".assurance>div,.public-how li,.own-app>div,.public-purchase-form").forEach(function (el, k) {
    el.classList.add("rv"); el.style.transitionDelay = (k % 4) * 90 + "ms"; io.observe(el);
  });
})();
