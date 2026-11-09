/* แดชบอร์ด DMC สพม.ชัยภูมิ — อ่านข้อมูลจาก Google Sheet แบบอย่างเดียว (ไม่มีการเขียนกลับ) */
(function () {
  "use strict";

  var cfg = window.DMC_CONFIG || {};
  var ZONES = window.SCHOOL_ZONES || {};
  var state = { rows: [], filter: "all", q: "", mine: null, dataTime: null };

  var MONTHS = { "ม.ค.": 0, "ก.พ.": 1, "มี.ค.": 2, "เม.ย.": 3, "พ.ค.": 4, "มิ.ย.": 5, "ก.ค.": 6, "ส.ค.": 7, "ก.ย.": 8, "ต.ค.": 9, "พ.ย.": 10, "ธ.ค.": 11 };
  var MONTH_NAMES = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  var TZ = 7 * 3600000; // แสดงผลเป็นเวลาไทย (Asia/Bangkok) เสมอกันไม่ว่าเครื่องผู้ใช้ตั้งโซนไหน

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function parseCsv(text) {
    var rows = [], row = [], cur = "", q = false, i = 0, c;
    text = text.replace(/^\uFEFF/, "");
    for (; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else { q = false; } }
        else { cur += c; }
      } else if (c === '"') { q = true; }
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else { cur += c; }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function tsOf(y, mo, d, h, mi, s) { return Date.UTC(y, mo, d, h, mi, s || 0) - TZ; }

  /* คืนค่าเป็น epoch (ms) ของเวลาไทย หรือ null ถ้าอ่านไม่ได้ — ไม่เดาจาก new Date() เพื่อกันค่าขยะ */
  function toTs(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (s.length < 8) return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) return tsOf(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    m = s.match(/(\d{1,2})\s+([^\s\d]{2,6})\.?\s+(\d{4})\s*(?:เวลา)?\s*(\d{1,2})[.:](\d{2})/);
    if (m) {
      var mk = m[2].replace(/\.$/, "") + ".";
      if (MONTHS[mk] != null) return tsOf(+m[3] - 543, MONTHS[mk], +m[1], +m[4], +m[5]);
    }
    m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\s+(\d{1,2})[.:](\d{2})/);
    if (m) {
      var yr = +m[3] > 2400 ? +m[3] - 543 : +m[3];
      return tsOf(yr, +m[2] - 1, +m[1], +m[4], +m[5]);
    }
    return null;
  }

  function pad(n) { return ("0" + n).slice(-2); }

  function fmt(t) {
    if (t == null) return "—";
    var d = new Date(t + TZ);
    return d.getUTCDate() + " " + MONTH_NAMES[d.getUTCMonth()] + " " + String(d.getUTCFullYear() + 543).slice(-2) +
      " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }

  function parseDeadline(v) {
    if (!v) return null;
    var s = String(v).trim();
    if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) { var t = Date.parse(s); return isNaN(t) ? null : t; }
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    return m ? tsOf(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  }

  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

  function gviz(tab) {
    return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(cfg.sheetId) +
      "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(tab) + "&_=" + Date.now();
  }

  function fetchTab(tab) {
    return fetch(gviz(tab), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  /* ---------- data model ---------- */
  function statusOf(raw, time) {
    var v = String(raw || "").trim();
    if (v) {
      if (/รับรอง/.test(v)) return "approved";
      if (/ยืนยัน/.test(v)) return "confirmed";
      return "pending";
    }
    if (time) return "confirmed";
    return "pending";
  }

  function buildModel(csvText) {
    var rows = parseCsv(csvText);
    var hi = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].some(function (c) { return String(c).trim() === "โรงเรียน"; })) { hi = i; break; }
    }
    if (hi < 0) throw new Error("ไม่พบแถวหัวตาราง (คอลัมน์ 'โรงเรียน') ในแท็บ " + cfg.tabData);

    var h = rows[hi].map(function (c) { return String(c).trim(); });
    var iSchool = h.indexOf("โรงเรียน");
    /* มองเฉพาะหัวคอลัมน์ที่อยู่หลังคอลัมน์โรงเรียน และชื่อสั้น (กันเซลล์หัวเรื่องยาว ๆ ที่ข้อความหน้าเว็บปนมา) */
    var pick = function (fn) {
      for (var k = iSchool + 1; k < h.length; k++) {
        if (h[k] && h[k].length <= 40 && fn(h[k])) return k;
      }
      return -1;
    };
    /* รองรับ 2 หน้าตาแท็บ data:
       (A) คัดลอกหน้า DMC มาทั้งบล็อก — มีคอลัมน์เวลา แต่หัวคอลัมน์สถานะเพี้ยน ("สถานะวันปิดระบบ")
       (B) ตารางสถานะอย่างเดียว — หัวคอลัมน์ "Admin รร. ยืนยันข้อมูล" / "ผอ.รร. รับรองข้อมูล" และมีคอลัมน์สหวิทยาเขต
       ยึดชื่อหัวคอลัมน์ก่อน ถ้าหาไม่ได้จึงยึดคอลัมน์เวลาที่อยู่ติดกัน */
    var iZone = pick(function (n) { return /สหวิทยาเขต/.test(n); });
    var iSchoolTime = pick(function (n) { return /เวลาที่ยืนยัน/.test(n); });
    var iLogin = pick(function (n) { return /login/i.test(n); });
    var iDirTime = pick(function (n) { return /รับรอง/.test(n) && /เวลา/.test(n); });
    var iSchoolStatus = pick(function (n) { return /ยืนยัน/.test(n) && !/รับรอง/.test(n) && !/เวลา/.test(n); });
    if (iSchoolStatus < 0 && iSchoolTime > 0) iSchoolStatus = iSchoolTime - 1;
    if (iSchoolStatus < 0) iSchoolStatus = pick(function (n) { return /^สถานะ/.test(n); });
    var iDirStatus = pick(function (n) { return /รับรอง/.test(n) && !/เวลา/.test(n); });
    if (iDirStatus < 0 && iDirTime > 0) iDirStatus = iDirTime - 1;
    var iNote = pick(function (n) { return /หมายเหตุ/.test(n); });

    var out = [];
    for (var r = hi + 1; r < rows.length; r++) {
      var row = rows[r];
      var school = String(row[iSchool] || "").trim();
      if (!school) continue;
      if (/^รวม/.test(school) || /รวมทั้งหมด/.test(row.join(" "))) break;
      var m = school.match(/^(\d{5,10})\s*-\s*(.+)$/);
      var code = m ? m[1] : "";
      var name = m ? m[2].trim() : school;
      var stSchoolRaw = iSchoolStatus >= 0 ? row[iSchoolStatus] : "";
      var stDirRaw = iDirStatus >= 0 ? row[iDirStatus] : "";
      var tSchool = iSchoolTime >= 0 ? toTs(row[iSchoolTime]) : null;
      var tDir = iDirTime >= 0 ? toTs(row[iDirTime]) : null;
      var tLogin = iLogin >= 0 ? toTs(row[iLogin]) : null;

      var schoolState = statusOf(stSchoolRaw, tSchool);
      var dirState = statusOf(stDirRaw, tDir);
      if (dirState === "approved" && schoolState === "pending") schoolState = "confirmed";

      var overall = dirState === "approved" ? "approved" : (schoolState === "confirmed" ? "confirmed" : "pending");
      var meta = ZONES[code] || {};
      var zoneInSheet = iZone >= 0 ? String(row[iZone] || "").trim() : "";
      out.push({
        code: code, name: name,
        zone: zoneInSheet || meta.zone || "ไม่ระบุสหวิทยาเขต",
        overall: overall,
        rawSchool: String(stSchoolRaw || "").trim(),
        rawDir: String(stDirRaw || "").trim(),
        note: iNote >= 0 ? String(row[iNote] || "").trim() : "",
        tSchool: tSchool, tDir: tDir, tLogin: tLogin,
        lastTouch: tDir || tSchool || tLogin
      });
    }
    if (!out.length) throw new Error("อ่านแถวข้อมูลไม่ได้ (พบหัวตารางแต่ไม่มีข้อมูล)");
    /* บอกผู้เรียกว่าชีทนี้มีคอลัมน์อะไรบ้าง เพื่อไม่ให้เดาว่า "ไม่มีเวลา" = "ไม่เคยเข้าใช้" */
    out.hasTime = out.some(function (x) { return x.tSchool || x.tDir; });
    out.hasLogin = out.some(function (x) { return !!x.tLogin; });
    out.hasNote = iNote >= 0;
    return out;
  }

  /* ---------- render ---------- */
  function counts(rows) {
    var c = { approved: 0, confirmed: 0, pending: 0, nologin: 0, total: rows.length };
    rows.forEach(function (x) {
      c[x.overall]++;
      if (rows.hasLogin && !x.tLogin) c.nologin++;
    });
    return c;
  }

  function renderHeader(dataTime, fetchedAt) {
    $("org").textContent = cfg.org || "";
    var nb = $("noticeBanner");
    if (cfg.notice) { nb.hidden = false; nb.textContent = cfg.notice; } else { nb.hidden = true; }
    if (cfg.title) $("title").textContent = cfg.title;
    if (cfg.logo) { var lg = $("logo"); lg.src = cfg.logo; lg.hidden = false; }
    $("roundName").textContent = cfg.roundName || "";
    $("dataTime").textContent = dataTime ? "ข้อมูล ณ " + fmt(dataTime) + " น." : (cfg.dataNote || "ยังไม่ระบุเวลาข้อมูล");
    $("fetchedAt").textContent = "ดึงข้อมูลล่าสุด " + fmt(fetchedAt) + " น.";
    $("fetchedAt").hidden = false;
    $("sheetLink").href = "https://docs.google.com/spreadsheets/d/" + cfg.sheetId + "/edit";
    renderCountdown();
  }

  function renderCountdown() {
    var el = $("countdown");
    var dl = parseDeadline(cfg.deadline);
    if (dl == null) { el.hidden = true; return; }
    el.hidden = false;
    var ms = dl - Date.now();
    if (ms <= 0) { el.textContent = "ปิดรอบแล้ว (" + fmt(dl) + " น.)"; return; }
    var mins = Math.floor(ms / 60000), days = Math.floor(mins / 1440), hrs = Math.floor((mins % 1440) / 60), mm = mins % 60;
    var txt = days > 0 ? days + " วัน " + hrs + " ชม." : (hrs > 0 ? hrs + " ชม. " + mm + " น." : mm + " นาที");
    el.textContent = "เหลืออีก " + txt + " ถึงกำหนด " + fmt(dl) + " น.";
  }

  function renderSummary(rows) {
    var c = counts(rows);
    $("kApproved").textContent = c.approved;
    $("kTotal").textContent = c.total;
    $("kApprovedPct").textContent = "คิดเป็น " + pct(c.approved, c.total) + "% ของโรงเรียนทั้งหมด";
    $("kConfirmed").textContent = c.confirmed;
    $("kConfirmedPct").textContent = "คิดเป็น " + pct(c.confirmed, c.total) + "%";
    $("kPending").textContent = c.pending;
    $("kPendingPct").textContent = "คิดเป็น " + pct(c.pending, c.total) + "%";
    $("kNoLogin").textContent = c.nologin;
    var noLoginCard = document.querySelector(".card-blue");
    if (noLoginCard) noLoginCard.hidden = !rows.hasLogin;

    var pb = $("progressBar");
    $("barOk").style.width = pct(c.approved, c.total) + "%";
    $("barWarn").style.width = pct(c.confirmed, c.total) + "%";
    pb.setAttribute("aria-valuenow", pct(c.approved, c.total));
    $("progressText").textContent = c.approved + "/" + c.total + " โรงเรียน (" + pct(c.approved, c.total) + "%)";

    var zones = {};
    rows.forEach(function (x) {
      var z = zones[x.zone] || (zones[x.zone] = { name: x.zone, approved: 0, confirmed: 0, pending: 0, total: 0 });
      z[x.overall]++; z.total++;
    });
    var list = Object.keys(zones).map(function (k) { return zones[k]; })
      .sort(function (a, b) { return (b.pending - a.pending) || (b.confirmed - a.confirmed) || a.name.localeCompare(b.name, "th"); });

    $("zones").innerHTML = list.map(function (z) {
      return '<div class="zone">' +
        '<span class="zone-name">' + esc(z.name) + '</span>' +
        '<span class="zone-num">' + z.approved + '/' + z.total + ' รับรอง · ค้าง ' + (z.confirmed + z.pending) + '</span>' +
        '<span class="zone-bar">' +
        '<i class="zone-ok" style="width:' + pct(z.approved, z.total) + '%"></i>' +
        '<i class="zone-warn" style="width:' + pct(z.confirmed, z.total) + '%"></i>' +
        '<i class="zone-bad" style="width:' + pct(z.pending, z.total) + '%"></i>' +
        '</span></div>';
    }).join("");
  }

  var BADGE = {
    approved: { cls: "badge-ok", label: "รับรองแล้ว" },
    confirmed: { cls: "badge-warn", label: "รอ ผอ.รับรอง" },
    pending: { cls: "badge-bad", label: "ยังไม่ยืนยัน" }
  };

  function renderTable() {
    var q = state.q.trim().toLowerCase();
    var rows = state.rows.filter(function (x) {
      if (state.mine && x.code !== state.mine) return false;
      if (state.filter !== "all") {
        if (state.filter === "nologin") { if (x.tLogin) return false; }
        else if (x.overall !== state.filter) return false;
      }
      if (!q) return true;
      return (x.name + " " + x.code + " " + x.zone).toLowerCase().indexOf(q) >= 0;
    });
    rows.sort(function (a, b) {
      var rank = { pending: 0, confirmed: 1, approved: 2 };
      return (rank[a.overall] - rank[b.overall]) || String(a.zone).localeCompare(String(b.zone), "th") ||
        String(a.name).localeCompare(String(b.name), "th");
    });

    var timeHeader = document.querySelector(".thead [role=columnheader]:nth-child(3)");
    if (timeHeader) timeHeader.textContent = state.rows.hasTime ? "เวลาล่าสุด" : (state.rows.hasNote ? "หมายเหตุ" : "");

    var html = rows.map(function (x) {
      var b = BADGE[x.overall];
      var when = x.overall === "approved" ? (x.tDir ? "รับรอง " + fmt(x.tDir) : (x.note || ""))
        : x.overall === "confirmed" ? (x.tSchool ? "ยืนยัน " + fmt(x.tSchool) : (x.note || ""))
          : (state.rows.hasLogin ? (x.tLogin ? "เข้าใช้ล่าสุด " + fmt(x.tLogin) : "ยังไม่เคยเข้าใช้") : (x.note || ""));
      return '<div class="row' + (state.mine && x.code === state.mine ? " is-mine" : "") + '" role="row">' +
        '<div><div class="row-name">' + esc(x.name) + ' <span class="row-code">(' + esc(x.code) + ')</span></div>' +
        '<div class="row-zone">' + esc(x.zone) + '</div></div>' +
        '<div><span class="badge ' + b.cls + '">' + b.label + '</span></div>' +
        '<div class="row-time">' + esc(when) + '</div>' +
        '<button class="copy" data-code="' + esc(x.code) + '" type="button">คัดลอกลิงก์</button>' +
        '</div>';
    }).join("");

    $("tbody").innerHTML = html;
    $("empty").hidden = rows.length > 0;
    $("tableCount").textContent = "แสดง " + rows.length + " จาก " + state.rows.length + " โรงเรียน";

    Array.prototype.forEach.call(document.querySelectorAll(".copy"), function (btn) {
      btn.addEventListener("click", function () { copyLink(btn.getAttribute("data-code")); });
    });
  }

  function copyLink(code) {
    var url = location.origin + location.pathname + "?school=" + encodeURIComponent(code);
    var done = function () { toast("คัดลอกลิงก์โรงเรียนแล้ว"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else { fallbackCopy(url, done); }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { window.prompt("คัดลอกลิงก์นี้", text); }
    document.body.removeChild(ta);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function renderSchoolView() {
    var box = $("schoolView");
    if (!state.mine) { box.hidden = true; return; }
    var row = state.rows.filter(function (x) { return x.code === state.mine; })[0];
    if (!row) { box.hidden = true; state.mine = null; return; }
    var b = BADGE[row.overall];
    box.hidden = false;
    box.innerHTML = '<span>มุมมองเฉพาะโรงเรียน: <strong>' + esc(row.name) + '</strong> · <span class="badge ' + b.cls + '">' + b.label + '</span></span>' +
      '<a href="' + location.pathname + '">← ดูภาพรวมทั้งเขต</a>';
  }

  function showError(msg) {
    var box = $("errorBox");
    box.hidden = false;
    box.innerHTML = "<strong>อ่านข้อมูลไม่ได้:</strong> " + esc(msg) +
      "<br>ตรวจสอบว่า (1) ชีทถูกแชร์ &quot;ทุกคนที่มีลิงก์มีสิทธิ์อ่าน&quot; (2) ชื่อแท็บ <code>" + esc(cfg.tabData) + "</code> ยังถูกต้อง (3) ค่า SHEET_ID ใน config.js ยังชี้ไฟล์เดิม";
    $("dataTime").textContent = "อ่านข้อมูลไม่สำเร็จ";
  }

  function staleCheck(dataTime, fetchedAt) {
    var ref = dataTime || fetchedAt;
    var hours = (Date.now() - ref) / 3600000;
    var banner = $("staleBanner");
    if (dataTime && hours < -0.5) {
      banner.hidden = false;
      banner.innerHTML = "เวลาข้อมูลที่ระบุ (" + fmt(dataTime) + " น.) เป็นเวลาในอนาคต — ตรวจสอบช่อง A1 ของแท็บ " + esc(cfg.tabMeta) + " อีกครั้ง";
      return;
    }
    if (dataTime && hours > (cfg.staleHours || 3)) {
      banner.hidden = false;
      banner.innerHTML = "ข้อมูลชุดนี้เก่ากว่า " + (cfg.staleHours || 3) + " ชั่วโมง (ข้อมูล ณ " + fmt(dataTime) +
        " น.) — โปรดตรวจสอบว่ามีการวางข้อมูลรอบล่าสุดแล้วหรือยัง";
    } else { banner.hidden = true; }
  }

  /* ---------- boot ---------- */
  function init() {
    var params = new URLSearchParams(location.search);
    state.mine = params.get("school");

    Array.prototype.forEach.call(document.querySelectorAll(".pill"), function (p) {
      p.addEventListener("click", function () {
        Array.prototype.forEach.call(document.querySelectorAll(".pill"), function (o) { o.classList.remove("is-active"); });
        p.classList.add("is-active");
        state.filter = p.getAttribute("data-filter");
        renderTable();
      });
    });
    $("search").addEventListener("input", function (e) { state.q = e.target.value; renderTable(); });
    setInterval(renderCountdown, 60000);

    var fetchedAt = Date.now();
    var metaP = fetchTab(cfg.tabMeta).then(function (txt) {
      var rows = parseCsv(txt);
      var now = Date.now(), lo = now - 40 * 86400000, hi = now + 7 * 86400000;
      for (var i = 0; i < rows.length; i++) {
        for (var j = 0; j < rows[i].length; j++) {
          var t = toTs(rows[i][j]);
          /* รับเฉพาะเวลาที่สมเหตุสมผล กันกรณีไม่มีแท็บ meta แล้ว gviz คืนเนื้อหาแท็บอื่นมาแทน */
          if (t && t >= lo && t <= hi) return t;
        }
      }
      return null;
    }).catch(function () { return null; });

    Promise.all([fetchTab(cfg.tabData), metaP]).then(function (res) {
      state.rows = buildModel(res[0]);
      state.dataTime = res[1];
      renderHeader(state.dataTime, fetchedAt);
      renderSummary(state.rows);
      renderSchoolView();
      renderTable();
      staleCheck(state.dataTime, fetchedAt);

      var expected = Object.keys(ZONES).length;
      if (expected && state.rows.length < expected) {
        var banner = $("staleBanner");
        banner.hidden = false;
        banner.innerHTML = "อ่านข้อมูลได้ " + state.rows.length + " จาก " + expected + " โรงเรียน — อาจวางข้อมูลไม่ครบหรือแท็บถูกแก้โครงสร้าง";
      }
    }).catch(function (err) {
      showError(err && err.message ? err.message : "ไม่ทราบสาเหตุ");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
