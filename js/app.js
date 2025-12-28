let isAuthed = false;
let selected = null;

let atmsCache = [];
let visitedMap = new Map();  
let markersByAtmId = new Map(); 

let map, layer;

const el = (id) => document.getElementById(id);

function setMsg(id, text, ok = true) {
  const node = el(id);
  if (!node) return;
  node.textContent = text ?? "";
  node.style.color = ok ? "#0a7" : "#c00";
}

function setSelectedUI(a) {
  if (el("selectedAtm")) el("selectedAtm").textContent = a?.atm_id ?? "—";
  if (el("selectedCity")) el("selectedCity").textContent = a?.city ?? "—";
  if (el("selectedBank")) el("selectedBank").textContent = a?.bank ?? "—";
  if (el("selectedDate")) el("selectedDate").textContent = a?.date ?? "—"; 
}

function refreshStats() {
  if (el("totalCount")) el("totalCount").textContent = String(atmsCache.length);
  if (el("visitedCount")) el("visitedCount").textContent = String(visitedMap.size);
}

function getInspectorId() {
  return (localStorage.getItem("inspector_id") || "").trim().toUpperCase();
}
function setInspectorId(v) {
  localStorage.setItem("inspector_id", (v || "").trim().toUpperCase());
}

function enableControls(enabled) {
  if (el("gmapsBtn")) el("gmapsBtn").disabled = !enabled;
  if (el("saveBtn")) el("saveBtn").disabled = !enabled;

  const chk = el("notFoundChk");
  const req = el("requestNo");

  if (chk) chk.disabled = !enabled;

  if (!enabled) {
    if (req) req.disabled = true;
    if (chk) chk.checked = false;
    if (req) req.value = "";
    return;
  }

  if (chk && chk.checked) {
    if (req) {
      req.disabled = true;
      req.value = "";
    }
  } else {
    if (req) req.disabled = false;
  }
}


function openGoogleMaps(lat, lng) {
  const url = `https://www.google.com/maps?q=${lat},${lng}`;
  window.open(url, "_blank");
}

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function getRequestNoOrNull() {
  const chk = el("notFoundChk");
  if (chk?.checked) return null;

  const d = digitsOnly(el("requestNo")?.value);
  if (d.length !== 8) return "__INVALID__";
  return `INS-${d}`;
}


function statusForAtm(atmId) {
  return visitedMap.get(atmId)?.status || "new";
}

const PIN_SVGS = {
  new: `
    <svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
      <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 22.7 12.5 41 12.5 41S25 22.7 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="#1E88E5"/>
      <circle cx="12.5" cy="12.5" r="5.2" fill="#fff"/>
    </svg>`,
  visited: `
    <svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
      <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 22.7 12.5 41 12.5 41S25 22.7 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="#E53935"/>
      <circle cx="12.5" cy="12.5" r="5.2" fill="#fff"/>
    </svg>`,
  not_found: `
    <svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
      <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 22.7 12.5 41 12.5 41S25 22.7 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="#9E9E9E"/>
      <circle cx="12.5" cy="12.5" r="5.2" fill="#fff"/>
    </svg>`
};

function svgData(svg) {
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg.trim());
}

const SHADOW_URL = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

const ICONS = {
  new: L.icon({
    iconUrl: svgData(PIN_SVGS.new),
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [0, -35],
    shadowUrl: SHADOW_URL,
    shadowSize: [41, 41],
    shadowAnchor: [12, 41]
  }),
  visited: L.icon({
    iconUrl: svgData(PIN_SVGS.visited),
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [0, -35],
    shadowUrl: SHADOW_URL,
    shadowSize: [41, 41],
    shadowAnchor: [12, 41]
  }),
  not_found: L.icon({
    iconUrl: svgData(PIN_SVGS.not_found),
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [0, -35],
    shadowUrl: SHADOW_URL,
    shadowSize: [41, 41],
    shadowAnchor: [12, 41]
  })
};

function iconForStatus(status) {
  if (status === "visited") return ICONS.visited;
  if (status === "not_found") return ICONS.not_found;
  return ICONS.new;
}

function setMarkerStatus(atmId, status) {
  const m = markersByAtmId.get(atmId);
  if (!m) return;
  m.setIcon(iconForStatus(status));
}

async function loadAtmsForInspector(inspectorId) {
  const { data, error } = await window.sb
    .from("atms")
    .select("atm_id, bank, city, street, lat, lng, date, inspector_id")
    .eq("inspector_id", inspectorId);

  if (error) throw error;
  return data ?? [];
}

async function loadVisitsForInspector(inspectorId) {
  const { data, error } = await window.sb
    .from("atm_visits")
    .select("atm_id, request_no, not_found")
    .eq("inspector_id", inspectorId);

  if (error) throw error;
  return data ?? [];
}

async function renderDataForInspector(inspectorId) {
  setMsg("statusMsg", "جاري تحميل البيانات…", true);

  selected = null;
  setSelectedUI(null);
  enableControls(false);

  if (el("requestNo")) el("requestNo").value = "";
  if (el("notFoundChk")) el("notFoundChk").checked = false;

  // clear
  if (layer) layer.clearLayers();
  markersByAtmId.clear();
  visitedMap.clear();
  atmsCache = [];

  try {
    const [atms, visits] = await Promise.all([
      loadAtmsForInspector(inspectorId),
      loadVisitsForInspector(inspectorId)
    ]);

    atmsCache = atms;

    (visits ?? []).forEach(v => {
      visitedMap.set(v.atm_id, { status: v.not_found ? "not_found" : "visited" });
    });

    refreshStats();

    atmsCache.forEach((a) => {
      const status = statusForAtm(a.atm_id);

      const marker = L.marker([a.lat, a.lng], { icon: iconForStatus(status) })
        .addTo(layer)
        .on("click", () => {
          selected = a;
          setSelectedUI(a);

          if (!isAuthed) {
            enableControls(false);
            setMsg("statusMsg", "ادخلي PIN أولاً.", false);
            return;
          }

          if (visitedMap.has(a.atm_id)) {
            enableControls(false);
            setMsg("statusMsg", "هذا الصراف مسجل مسبقًا.", false);
          } else {
            enableControls(true);
            setMsg("statusMsg", ".", true);
          }
        });

      marker.bindTooltip(`${a.bank ?? ""} - ${a.city ?? ""}`.trim() || a.atm_id);

      markersByAtmId.set(a.atm_id, marker);
    });

    if (atmsCache.length) {
      map.setView([atmsCache[0].lat, atmsCache[0].lng], 12);
    }

    setMsg("statusMsg", "تم تحميل البيانات ", true);
  } catch (e) {
    refreshStats();
    setMsg("statusMsg", `فشل تحميل البيانات: ${e?.message ?? e}`, false);
  }
}

(async function main() {
  isAuthed = false;
  selected = null;
  setSelectedUI(null);
  enableControls(false);

  map = L.map("map").setView([23.8859, 45.0792], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  layer = L.layerGroup().addTo(map);

  setMsg("statusMsg", ".", false);

  if (el("notFoundChk")) {
    el("notFoundChk").addEventListener("change", () => {
      if (!isAuthed || !selected) return;

      if (el("notFoundChk").checked) {
        if (el("requestNo")) {
          el("requestNo").value = "";
          el("requestNo").disabled = true;
        }
      } else {
        if (el("requestNo")) {
          el("requestNo").disabled = false;
          el("requestNo").focus();
        }
      }
    });
  }

  if (el("requestNo")) {
    el("requestNo").addEventListener("input", () => {
      const d = digitsOnly(el("requestNo").value).slice(0, 8);
      el("requestNo").value = d;
    });
  }

  if (el("pinBtn")) {
    el("pinBtn").addEventListener("click", async () => {
      const pin = (el("pin")?.value ?? "").trim();
      const pins = window.APP_CONFIG?.INSPECTOR_PINS || {};
      const matched = Object.entries(pins).find(([_, p]) => String(p) === pin);

      if (!matched) {
        isAuthed = false;
        enableControls(false);
        setMsg("pinMsg", "PIN غير صحيح", false);
        setMsg("statusMsg", "PINغير صحيح", false);
        return;
      }

      const inspectorId = matched[0]; 
      setInspectorId(inspectorId);

      isAuthed = true;
      setMsg("pinMsg", "✅", true);

      await renderDataForInspector(inspectorId);
    });
  }

  if (el("gmapsBtn")) {
    el("gmapsBtn").addEventListener("click", () => {
      if (!selected) return;
      openGoogleMaps(selected.lat, selected.lng);
    });
  }

  if (el("saveBtn")) {
    el("saveBtn").addEventListener("click", async () => {
      if (!isAuthed) {
        setMsg("statusMsg", "ادخل PINاولا ", false);
        return;
      }
      if (!selected) {
        setMsg("statusMsg", "اختار نقطة أولاً.", false);
        return;
      }
      if (visitedMap.has(selected.atm_id)) {
        setMsg("statusMsg", "تم تسجيل هذا الصراف مسبقًا.", false);
        return;
      }

      const inspectorId = getInspectorId();
      if (!inspectorId) {
        setMsg("statusMsg", "PIN غير مفعل بشكل صحيح.", false);
        return;
      }

      const notFound = !!el("notFoundChk")?.checked;
      const requestNo = getRequestNoOrNull();

      if (!notFound && requestNo === "__INVALID__") {
        setMsg("statusMsg", "اكتب 8 أرقام فقط (بدون حروف).", false);
        return;
      }

      el("saveBtn").disabled = true;

      const payload = {
        atm_id: selected.atm_id,
        inspector_id: inspectorId,
        not_found: notFound,
        request_no: notFound ? null : requestNo
      };

      const { error } = await window.sb.from("atm_visits").insert(payload);

      if (error) {
        setMsg("statusMsg", `خطأ: ${error.message}`, false);
        el("saveBtn").disabled = false;
        return;
      }

      const status = notFound ? "not_found" : "visited";
      visitedMap.set(selected.atm_id, { status });
      refreshStats();
      setMarkerStatus(selected.atm_id, status);

      // reset inputs
      if (el("requestNo")) el("requestNo").value = "";
      if (el("notFoundChk")) el("notFoundChk").checked = false;
      enableControls(false);

      setMsg("statusMsg", "تم الحفظ ", true);
      el("saveBtn").disabled = false;
    });
  }
})();
