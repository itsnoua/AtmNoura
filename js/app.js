let isAuthed = false;
let selected = null;
let visitedSet = new Set();

const el = (id) => document.getElementById(id);

function setMsg(id, text, ok = true) {
  const node = el(id);
  if (!node) return;
  node.textContent = text;
  node.style.color = ok ? "#0a7" : "#c00";
}

function enableControls(enabled) {
  if (el("gmapsBtn")) el("gmapsBtn").disabled = !enabled;
  if (el("requestNo")) el("requestNo").disabled = !enabled;
  if (el("saveBtn")) el("saveBtn").disabled = !enabled;
}

function openGoogleMaps(lat, lng) {
  const url = `https://www.google.com/maps?q=${lat},${lng}`;
  window.open(url, "_blank");
}

function normalizeRequestNo(v) {
  return (v ?? "").trim();
}

function getInspectorId() {
  return (localStorage.getItem("inspector_id") || "").trim().toUpperCase();
}

function setInspectorId(v) {
  localStorage.setItem("inspector_id", v);
}

async function loadAtms() {
  const inspectorId = getInspectorId();
  if (!inspectorId) return [];

  const { data, error } = await window.sb
    .from("atms")
    .select("atm_id, bank, city, lat, lng, date, inspector_id")
    .eq("inspector_id", inspectorId);

  if (error) throw error;
  return data ?? [];
}

async function loadVisits() {
  const inspectorId = getInspectorId();
  if (!inspectorId) return [];

  const { data, error } = await window.sb
    .from("atm_visits")
    .select("atm_id, request_no, inspector_id")
    .eq("inspector_id", inspectorId);

  if (error) throw error;
  return data ?? [];
}

function refreshStats(total) {
  if (el("totalCount")) el("totalCount").textContent = String(total);
  if (el("visitedCount")) el("visitedCount").textContent = String(visitedSet.size);
}

async function renderData(map) {
  setMsg("statusMsg", "جاري تحميل البيانات…", true);
  enableControls(false);

  // تصفير واجهة الاختيار
  selected = null;
  if (el("selectedAtm")) el("selectedAtm").textContent = "—";
  if (el("selectedCity")) el("selectedCity").textContent = "—";
  if (el("selectedBank")) el("selectedBank").textContent = "—";
  if (el("selectedDate")) el("selectedDate").textContent = "—";

  let atms = [];
  try {
    const [a, v] = await Promise.all([loadAtms(), loadVisits()]);
    atms = a;
    visitedSet = new Set((v ?? []).map((x) => x.atm_id));
    refreshStats(atms.length);
  } catch (e) {
    setMsg("statusMsg", `فشل تحميل البيانات: ${e.message ?? e}`, false);
    refreshStats(0);
    return;
  }

  // تنظيف الماركرز القديمة (لو فيه رندر سابق)
  if (window._atmLayer) {
    window._atmLayer.clearLayers();
  } else {
    window._atmLayer = L.layerGroup().addTo(map);
  }

  // رسم الصرافات
  atms.forEach((a) => {
    const isVisited = visitedSet.has(a.atm_id);

    const marker = L.marker([a.lat, a.lng], { opacity: isVisited ? 0.5 : 1.0 })
      .addTo(window._atmLayer)
      .on("click", () => {
        selected = a;

        if (el("selectedAtm")) el("selectedAtm").textContent = a.atm_id;
        if (el("selectedCity")) el("selectedCity").textContent = a.city ?? "—";
        if (el("selectedBank")) el("selectedBank").textContent = a.bank ?? "—";
        if (el("selectedDate")) el("selectedDate").textContent = a.date ?? "—";

        if (isAuthed) enableControls(true);

        if (visitedSet.has(a.atm_id)) {
          setMsg("statusMsg", "هذا الصراف مسجل مسبقًا.", false);
        } else {
          setMsg("statusMsg", "جاهز لإدخال رقم الزيارة.", true);
        }
      });

    marker.bindTooltip(`${a.bank ?? ""} - ${a.city ?? ""}`.trim() || a.atm_id);
  });

  setMsg("statusMsg", "تم تحميل البيانات ✅", true);

  // زوم على أول نقطة
  if (atms.length) {
    map.setView([atms[0].lat, atms[0].lng], 11);
  }
}

(async function main() {
  // الخريطة
  const map = L.map("map").setView([23.8859, 45.0792], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  // بالبداية عطّلي الأدوات لين يصير دخول
  enableControls(false);

  // ✅ أهم تعديل: لا نسمح بعرض نقاط تلقائيًا حتى لو فيه inspector_id قديم
  localStorage.removeItem("inspector_id");
  isAuthed = false;

  // تأكيد رسائل البداية
  setMsg("pinMsg", "", true);
  setMsg("statusMsg", "ادخلي PIN عشان تظهر النقاط.", false);

  // PIN (هو اللي يحدد A/B)
  if (el("pinBtn")) {
    el("pinBtn").addEventListener("click", async () => {
      const pin = (el("pin").value ?? "").trim();
      const pins = window.APP_CONFIG?.INSPECTOR_PINS || {};

      const matched = Object.entries(pins).find(([_, p]) => String(p) === pin);

      if (!matched) {
        isAuthed = false;
        enableControls(false);
        setMsg("pinMsg", "PIN غير صحيح", false);
        setMsg("statusMsg", "ادخلي PIN صحيح عشان تظهر نقاطك.", false);
        return;
      }

      const inspectorId = matched[0]; // A أو B
      setInspectorId(inspectorId);

      isAuthed = true;
      setMsg("pinMsg", "تم الدخول ✅", true);

      await renderData(map);
    });
  }

  // فتح قوقل ماب
  if (el("gmapsBtn")) {
    el("gmapsBtn").addEventListener("click", () => {
      if (!selected) return;
      openGoogleMaps(selected.lat, selected.lng);
    });
  }

  // حفظ رقم الزيارة
  if (el("saveBtn")) {
    el("saveBtn").addEventListener("click", async () => {
      if (!selected) return;

      const requestNo = normalizeRequestNo(el("requestNo")?.value);
      if (!requestNo) {
        setMsg("statusMsg", "رقم الزيارة الزامي.", false);
        return;
      }

      if (visitedSet.has(selected.atm_id)) {
        setMsg("statusMsg", "تم تسجيل هذا الصراف مسبقًا.", false);
        return;
      }

      el("saveBtn").disabled = true;

      const inspectorId = getInspectorId();

      const { error } = await window.sb.from("atm_visits").insert({
        atm_id: selected.atm_id,
        request_no: requestNo,
        inspector_id: inspectorId
      });

      if (error) {
        if (String(error.code) === "23505") {
          setMsg("statusMsg", "تم التسجيل مسبقًا (الصراف أو رقم الطلب مكرر).", false);
        } else {
          setMsg("statusMsg", `خطأ: ${error.message}`, false);
        }
        el("saveBtn").disabled = false;
        return;
      }

      visitedSet.add(selected.atm_id);

      // تحديث العداد بدون خبصة
      const total = Number(el("totalCount")?.textContent || 0);
      refreshStats(total);

      setMsg("statusMsg", "تم الحفظ ✅", true);
      if (el("requestNo")) el("requestNo").value = "";
      el("saveBtn").disabled = false;
    });
  }
})();
