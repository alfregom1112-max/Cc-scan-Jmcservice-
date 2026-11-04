/* Acuerdo de Entrega y Tratamiento de Datos — solo aplica al plan "own_app".
   Es aditivo: no modifica Wompi, Supabase ni el catálogo. Añade una condición extra antes del envío. */
(function () {
  "use strict";
  var KEY = "jm-acuerdo-leido:v1";
  var form = document.getElementById("purchase-form");
  var box = document.getElementById("own-app-agreement");
  var link = document.getElementById("agreement-link");
  var status = document.getElementById("agreement-status");
  if (!form || !box || !link) return;
  var check = form.querySelector('input[name="accepted"]');
  var message = document.getElementById("purchase-message");
  var ownAppSelected = false;
  var readFlag = false;

  try { readFlag = sessionStorage.getItem(KEY) === "1"; } catch (e) {}

  function sync() {
    box.hidden = !ownAppSelected;
    if (!check) return;
    var locked = ownAppSelected && !readFlag;
    if (locked) check.checked = false;
    check.disabled = locked;
    if (status) {
      status.textContent = readFlag
        ? "Acuerdo abierto. Ya puedes marcar la casilla de aceptación."
        : "Abre el acuerdo para habilitar la casilla de aceptación.";
      status.classList.toggle("ok", readFlag);
    }
  }

  function markRead() {
    readFlag = true;
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    sync();
  }

  link.addEventListener("click", markRead);
  link.addEventListener("auxclick", markRead);

  window.addEventListener("jm:plan-selected", function (ev) {
    ownAppSelected = !!(ev.detail && ev.detail.id === "own_app");
    sync();
  });

  // Condición adicional (captura): bloquea el envío a Wompi si es aplicación propia y no se abrió el acuerdo.
  document.addEventListener("submit", function (ev) {
    if (ev.target !== form || !ownAppSelected) return;
    if (readFlag && check && check.checked) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (message) {
      message.textContent = readFlag
        ? "Marca la casilla para aceptar el Acuerdo de Entrega y Tratamiento de Datos."
        : "Antes de continuar al pago, abre y lee el Acuerdo de Entrega y Tratamiento de Datos.";
      message.classList.add("error");
    }
    (readFlag ? check : link).focus();
  }, true);

  sync();
})();
