/* ============================================================
   NexorSparks — Auth Action Pages Shared Script
   Reused by: action.html, verify-email.html, reset-password.html,
              recover-email.html, change-email.html

   This is the ONLY place Firebase is initialized for the /auth/
   pages. Every page includes this file once — never re-run
   firebase.initializeApp() anywhere else in /auth/.
   ============================================================ */

(function () {
  "use strict";

  // ------------------------------------------------------------
  // 1. FIREBASE INIT (same project as the main NexorSparks app)
  // ------------------------------------------------------------
  const firebaseConfig = {
    apiKey: "AIzaSyC30TcmMVhP_8HdFYS1WufRiZwSDYNMTF0",
    authDomain: "pulse2-92372.firebaseapp.com",
    databaseURL: "https://pulse2-92372-default-rtdb.firebaseio.com",
    projectId: "pulse2-92372",
    storageBucket: "pulse2-92372.firebasestorage.app",
    messagingSenderId: "276235725177",
    appId: "1:276235725177:web:0f4e0789fae80a435927a8"
  };

  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const auth = firebase.auth();

  // ------------------------------------------------------------
  // 2. OPEN-REDIRECT PROTECTION
  //    continueUrl is attacker-influenceable (it's just a query
  //    string param), so we NEVER redirect to it blindly. Only
  //    hostnames in this allow-list are trusted. Add every real
  //    domain NexorSparks is served from.
  // ------------------------------------------------------------
  const ALLOWED_CONTINUE_HOSTS = [
    location.hostname,          // current domain (wherever /auth/ is deployed)
    "nexor-f4d.pages.dev"       // NexorSparks help center / marketing domain
    // "www.yourdomain.com",     // <-- add your production domain(s) here
    // "yourdomain.com"
  ];

  // Fallback destinations used across every page
  const HOME_URL = "../index.html";
  const LOGIN_URL = "../index.html";
  const HELP_CENTER_URL = "https://nexor-f4d.pages.dev/help-center";
  const PRIVACY_URL = "https://nexor-f4d.pages.dev/help-center#privacy-policy";
  const TERMS_URL = "https://nexor-f4d.pages.dev/help-center#terms-of-service";

  /**
   * Validates a continueUrl and returns a safe absolute URL to use,
   * or null if it's missing / untrusted / malformed.
   */
  function sanitizeContinueUrl(raw) {
    if (!raw) return null;
    let u;
    try {
      u = new URL(raw, location.href);
    } catch (e) {
      return null;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!ALLOWED_CONTINUE_HOSTS.includes(u.hostname)) return null;
    return u.href;
  }

  // ------------------------------------------------------------
  // 3. URL PARAM HELPERS
  // ------------------------------------------------------------
  function getParams() {
    const qs = new URLSearchParams(location.search);
    return {
      mode: qs.get("mode") || "",
      oobCode: qs.get("oobCode") || "",
      apiKey: qs.get("apiKey") || "",
      lang: qs.get("lang") || "en",
      continueUrl: sanitizeContinueUrl(qs.get("continueUrl")),
      rawContinueUrl: qs.get("continueUrl") || ""
    };
  }

  /**
   * Basic sanity check on the oobCode shape before we ever hand it
   * to Firebase. This isn't a security boundary (Firebase validates
   * server-side regardless) — it just lets us fail fast with a clean
   * "invalid link" screen instead of a raw SDK error for obviously
   * tampered/missing codes.
   */
  function isPlausibleOobCode(code) {
    return typeof code === "string" && /^[A-Za-z0-9\-_]{6,}$/.test(code);
  }

  // ------------------------------------------------------------
  // 4. FRIENDLY ERROR MESSAGES
  //    Never show raw Firebase error text/codes to the user.
  // ------------------------------------------------------------
  function friendlyAuthError(err) {
    const code = (err && err.code) || "";
    const map = {
      "auth/expired-action-code": "This link has expired. Please request a new one.",
      "auth/invalid-action-code": "This link is invalid or has already been used.",
      "auth/user-disabled": "This account has been disabled. Contact support for help.",
      "auth/user-not-found": "We couldn't find an account for this link.",
      "auth/weak-password": "Please choose a stronger password (at least 8 characters).",
      "auth/network-request-failed": "Network error. Check your connection and try again.",
      "auth/too-many-requests": "Too many attempts. Please wait a bit and try again.",
      "auth/missing-android-pkg-name": "This link is misconfigured. Please request a new one.",
      "auth/invalid-continue-uri": "This link is misconfigured. Please request a new one.",
      "auth/argument-error": "This link appears to be malformed or incomplete."
    };
    return map[code] || "Something went wrong with this link. Please request a new one.";
  }

  // ------------------------------------------------------------
  // 5. SMALL UI HELPERS (shared markup patterns)
  // ------------------------------------------------------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(msg) {
    let el = document.getElementById("a-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "a-toast";
      el.className = "a-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function renderFooter(mountEl) {
    mountEl.innerHTML =
      '<a href="' + LOGIN_URL + '">Login</a>' +
      '<span class="dot">&middot;</span>' +
      '<a href="' + HOME_URL + '">Home</a>' +
      '<span class="dot">&middot;</span>' +
      '<a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">Privacy Policy</a>' +
      '<span class="dot">&middot;</span>' +
      '<a href="' + TERMS_URL + '" target="_blank" rel="noopener">Terms</a>' +
      '<span class="dot">&middot;</span>' +
      '<a href="' + HELP_CENTER_URL + '" target="_blank" rel="noopener">Help Center</a>';
  }

  function renderBrand(mountEl, subtitle) {
    mountEl.innerHTML =
      '<div class="auth-brand-mark"><img src="https://aryasongs.github.io/Pulse/621954EC-539B-4CA6-8CBB-9172C2BBC445.png" alt="NexorSparks"></div>' +
      '<div class="auth-brand-name">Nexor Sparks</div>' +
      (subtitle ? '<div class="auth-brand-sub">' + escapeHtml(subtitle) + '</div>' : '');
  }

  // Password strength: returns { score: 0-3, label }
  function evaluatePasswordStrength(pw) {
    if (!pw) return { score: 0, label: "" };
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
    if (pw.length >= 12) score = Math.min(3, score + 1);
    const labels = ["Too weak", "Weak", "Good", "Strong"];
    return { score, label: labels[score] };
  }

  function isValidPassword(pw) {
    return typeof pw === "string" && pw.length >= 8 && pw.length <= 4096;
  }

  // Expose a small namespace to the page scripts
  window.NexorAuth = {
    auth,
    getParams,
    isPlausibleOobCode,
    friendlyAuthError,
    escapeHtml,
    showToast,
    renderFooter,
    renderBrand,
    evaluatePasswordStrength,
    isValidPassword,
    HOME_URL,
    LOGIN_URL,
    HELP_CENTER_URL,
    PRIVACY_URL,
    TERMS_URL
  };
})();
