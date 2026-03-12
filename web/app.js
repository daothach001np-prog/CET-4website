window.__cet4_module_loaded = true;
window.__cet4_app_interactive = false;

const SUPABASE_SDK_IMPORTS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
  "https://esm.sh/@supabase/supabase-js@2",
  "https://esm.run/@supabase/supabase-js@2",
  "https://unpkg.com/@supabase/supabase-js@2/dist/module/index.js",
];
const SUPABASE_SDK_IMPORT_TIMEOUT_MS = 4500;

let createClientFactory = null;

function importWithTimeout(url, timeoutMs = SUPABASE_SDK_IMPORT_TIMEOUT_MS) {
  return Promise.race([
    import(url),
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    }),
  ]);
}

function reportBootstrapError(error) {
  const message = error && error.message ? error.message : String(error || "Unknown bootstrap error");
  console.error("Bootstrap failed", error);
  window.__cet4_app_interactive = false;

  try {
    if (ui["alert"]) {
      showAlert(`Bootstrap failed: ${message}`, "error", 10000);
      return;
    }
  } catch (_innerError) {
    // Fallback to a blocking dialog below.
  }

  try {
    window.alert(`Bootstrap failed: ${message}`);
  } catch (_alertError) {
    // No-op.
  }
}

async function ensureCreateClientFactory() {
  if (typeof createClientFactory === "function") {
    return createClientFactory;
  }

  const failures = [];
  for (const url of SUPABASE_SDK_IMPORTS) {
    try {
      const mod = await importWithTimeout(url);
      if (mod && typeof mod.createClient === "function") {
        createClientFactory = mod.createClient;
        return createClientFactory;
      }
      failures.push(`${url} (missing createClient)`);
    } catch (error) {
      failures.push(`${url} (${error && error.message ? error.message : error})`);
    }
  }

  console.error("Failed to load Supabase SDK", failures);
  throw new Error("Unable to load the login service. Check network/CDN access and refresh.");
}

const MODULE_LABELS = {
  reading: "阅读",
  translation: "翻译",
  writing: "写作",
  listening: "听力",
  mock: "模拟考",
};

const STATUS_LABELS = {
  pending: "待处理",
  returned: "退回重做",
  passed: "通过",
};

const MAX_IMAGE_COUNT_TOTAL = 12;
const MAX_RAW_IMAGE_SIZE = 25 * 1024 * 1024;
const TARGET_UPLOAD_SIZE = Math.floor(0.9 * 1024 * 1024);
const EMERGENCY_UPLOAD_SIZE = Math.floor(0.56 * 1024 * 1024);
const MAX_IMAGE_SIDE = 1200;
const MIN_JPEG_QUALITY = 0.36;
const START_JPEG_QUALITY = 0.72;
const MAX_POST_COMPRESS_SIZE = Math.floor(TARGET_UPLOAD_SIZE * 1.45);
const NON_JPEG_REENCODE_MIN_SIZE = 220 * 1024;
const MAX_ESSAY_IMAGE_COUNT = 3;
const MAX_ESSAY_IMAGE_SIZE = 12 * 1024 * 1024;
const MAX_TRANSLATION_IMAGE_COUNT = 3;
const MAX_TRANSLATION_IMAGE_SIZE = 12 * 1024 * 1024;
const PREPARE_CONCURRENCY = 3;
const UPLOAD_CONCURRENCY = 2;
const UPLOAD_MAX_RETRY = 4;
const UPLOAD_RETRY_BASE_DELAY_MS = 680;
const UPLOAD_TIMEOUT_MIN_MS = 55000;
const UPLOAD_TIMEOUT_MAX_MS = 180000;
const UPSERT_MAX_RETRY = 2;
const ANNOT_JPEG_QUALITY = 0.82;
const ANNOT_UPLOAD_MAX_RETRY = 2;
const ANNOT_UPLOAD_TIMEOUT_MIN_MS = 28000;
const ANNOT_UPLOAD_TIMEOUT_MAX_MS = 80000;

const SUBMISSION_BUCKET = "submission-images";
const ANNOT_BUCKET = "annotation-images";
const SUBMISSION_PUBLIC_MARKER = `/storage/v1/object/public/${SUBMISSION_BUCKET}/`;
const ANNOT_PUBLIC_MARKER = `/storage/v1/object/public/${ANNOT_BUCKET}/`;
const SUBMISSION_DRAFT_PREFIX = "cet4_submission_draft";
const REVIEW_DRAFT_PREFIX = "cet4_review_draft";
const DRAFT_DB_NAME = "cet4-progress-draft-assets";
const DRAFT_DB_VERSION = 1;
const DRAFT_DB_STORE = "submissionDrafts";
const MESSAGE_POLL_INTERVAL_MS = 28000;
const CALENDAR_MARK_ORDER = ["none", "ring", "done", "missed"];
const CALENDAR_MARK_LABELS = {
  ring: "圈一下",
  done: "已完成",
  missed: "待补交",
};

const ui = {};

let supabase = null;
let currentSession = null;
let currentProfile = null;
let allProfiles = new Map();
let submissionCache = [];
let selectedSubmissionId = null;
let annotationMapBySubmission = new Map();
let teacherReviewMap = new Map();

let pendingImages = [];
let existingImages = [];
let removedStoragePaths = [];

let reflectionCache = [];
let reflectionCommentMap = new Map();
let selectedReflectionId = null;
let lastPopupMsg = "";
let lastPopupAt = 0;
let activePage = "";
let essayChatHistory = [];
let essayPendingImages = [];
let translationPendingImages = [];
let translationPromptCache = [];
let myTranslationAttemptCache = [];
let teacherTranslationAttemptCache = [];
let myTranslationReviewMap = new Map();
let teacherTranslationReviewMap = new Map();
let selectedTranslationAttemptId = null;
let latestTranslationOcrText = "";
let historyModuleFilter = "all";
let historyDateFilter = "";
let historyHighlightedSubmissionId = "";
let studentSubmissionCursor = startOfWeek(new Date());
let mySubmissionCache = [];
let myReviewMap = new Map();
let myAnnotationMap = new Map();
let selectedStudentReviewId = null;
let submissionDraftTimer = 0;
let reviewDraftTimer = 0;
let suppressSubmissionDraftSync = false;
let suppressReviewDraftSync = false;
let draftDbPromise = null;
let unreadMessageCount = 0;
let messageCache = [];
let messagePollTimer = 0;
let messagesFeatureReady = true;
let calendarFeatureReady = true;
let studentCalendarCursor = startOfMonth(new Date());
let teacherCalendarCursor = startOfMonth(new Date());
let studentCalendarMarks = [];
let teacherCalendarMarks = [];
let studentCalendarSubmissionCounts = new Map();
let teacherCalendarSubmissionCounts = new Map();
let hasShownSubmissionDraftRestore = false;

const previewState = {
  open: false,
  submissionId: null,
  sourceUrl: "",
  title: "图片预览",
  tip: "这里支持放大、旋转和翻转，仅影响当前预览，不会修改原图。",
  allowAnnotate: false,
  enableTransforms: false,
  rotation: 0,
  scale: 1,
  flipX: 1,
  flipY: 1,
};

const annotState = {
  open: false,
  submissionId: null,
  sourceImageUrl: "",
  annotationId: null,
  originalAnnotatedPath: null,
  drawing: false,
  moved: false,
  lastX: 0,
  lastY: 0,
  history: [],
  zoom: 1,
};

function bootstrapApp() {
  void init().catch(reportBootstrapError);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapApp, { once: true });
} else {
  bootstrapApp();
}

async function init() {
  cacheUi();
  bindGlobalErrorHandlers();
  bindEvents();
  window.__cet4_app_interactive = true;
  fillDefaultDates();
  renderMotivation();
  initAiConfigUi();
  renderEssayChatLog();
  renderEssayPendingImages();
  renderTranslationPendingImages();
  renderMyTranslationHistory();
  renderTeacherTranslationList();

  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    lockAuth("请先在 web/config.js 填写 Supabase 配置。");
    return;
  }

  let createClient = null;
  try {
    createClient = await ensureCreateClientFactory();
  } catch (error) {
    lockAuth(error.message);
    return;
  }

  supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    showAlert(`读取会话失败: ${error.message}`, "error");
  }

  currentSession = session;
  await syncSessionUi();

  supabase.auth.onAuthStateChange(async (_event, nextSession) => {
    currentSession = nextSession;
    await syncSessionUi();
  });
}

function bindGlobalErrorHandlers() {
  window.addEventListener("error", (event) => {
    if (event?.message) {
      showAlert(`前端错误: ${event.message}`, "error", 7000);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const msg = event?.reason?.message || String(event?.reason || "未知 Promise 错误");
    showAlert(`异步错误: ${msg}`, "error", 7000);
  });
}

function cacheUi() {
  const ids = [
    "alert",
    "global-banner",
    "global-banner-icon",
    "global-banner-text",
    "upload-sticky-banner",
    "upload-sticky-text",
    "upload-sticky-percent",
    "upload-sticky-bar",
    "upload-sticky-meta",
    "session-badge",
    "motivation-quote",
    "motivation-sub",
    "auth-panel",
    "email",
    "password",
    "sign-in-btn",
    "sign-up-btn",
    "workspace",
    "who-email",
    "who-role",
    "message-bell-btn",
    "message-bell-badge",
    "message-panel",
    "message-list",
    "mark-all-read-btn",
    "claim-teacher-btn",
    "claim-admin-btn",
    "refresh-btn",
    "sign-out-btn",
    "page-nav-panel",
    "student-nav",
    "teammate-nav",
    "teacher-nav",
    "guide-panel",
    "student-panel",
    "submission-form",
    "study-date",
    "study-module",
    "student-date-prev-btn",
    "student-date-today-btn",
    "student-date-next-btn",
    "student-date-chip-list",
    "study-content",
    "study-paste-zone",
    "study-pick-btn",
    "study-images",
    "pending-images",
    "upload-progress-panel",
    "upload-progress-text",
    "upload-progress-percent",
    "upload-progress-bar",
    "upload-progress-meta",
    "existing-images-panel",
    "existing-images",
    "word-summary",
    "mistake-summary",
    "submission-draft-state",
    "clear-submission-draft-btn",
    "history-panel",
    "history-module-tabs",
    "history-date-filter",
    "history-filter-today-btn",
    "history-date-clear-btn",
    "history-filter-state",
    "history-sync-list",
    "history-sync-stats",
    "history-list",
    "student-calendar-prev-btn",
    "student-calendar-today-btn",
    "student-calendar-next-btn",
    "student-calendar-label",
    "student-calendar-grid",
    "teacher-panel",
    "role-target-user",
    "role-target-value",
    "set-role-btn",
    "identity-target-user",
    "identity-display-name",
    "identity-email",
    "load-identity-btn",
    "save-identity-btn",
    "use-email-as-name-btn",
    "teacher-date",
    "teacher-module",
    "teacher-load-btn",
    "teacher-review-list",
    "review-target",
    "review-selection-stats",
    "review-images",
    "review-annotations",
    "review-status",
    "review-score",
    "review-comment",
    "review-draft-state",
    "clear-review-draft-btn",
    "save-review-btn",
    "review-last-saved",
    "saved-review-list",
    "saved-review-refresh-btn",
    "calendar-student",
    "teacher-calendar-prev-btn",
    "teacher-calendar-today-btn",
    "teacher-calendar-next-btn",
    "teacher-calendar-label",
    "teacher-calendar-grid",
    "reflection-panel",
    "reflection-student",
    "reflection-teacher",
    "reflection-form",
    "reflection-date",
    "reflection-focus",
    "reflection-content",
    "save-reflection-btn",
    "student-reflection-list",
    "reflection-filter-date",
    "reflection-filter-student",
    "load-reflections-btn",
    "teacher-reflection-list",
    "reflection-target",
    "reflection-comment",
    "save-reflection-comment-btn",
    "essay-panel",
    "ai-endpoint",
    "ai-model",
    "ai-vision-model",
    "ai-key",
    "ai-save-config-btn",
    "ai-test-btn",
    "essay-topic",
    "essay-goal",
    "essay-content",
    "essay-paste-zone",
    "essay-pick-btn",
    "essay-images",
    "essay-pending-images",
    "essay-ocr-btn",
    "essay-review-btn",
    "essay-clear-btn",
    "essay-result",
    "essay-chat-log",
    "essay-chat-input",
    "essay-chat-send-btn",
    "translation-panel",
    "translation-student",
    "translation-teacher",
    "translation-mode",
    "translation-year-filter",
    "translation-paper-filter",
    "translation-prompt-select",
    "translation-source",
    "translation-reference",
    "translation-student-text",
    "translation-paste-zone",
    "translation-pick-btn",
    "translation-images",
    "translation-pending-images",
    "translation-ocr-btn",
    "translation-review-btn",
    "translation-clear-btn",
    "translation-result",
    "translation-history-refresh-btn",
    "translation-history-list",
    "translation-teacher-date",
    "translation-teacher-student",
    "translation-teacher-load-btn",
    "translation-teacher-list",
    "translation-review-target",
    "translation-review-score",
    "translation-review-comment",
    "translation-save-review-btn",
    "student-review-modal",
    "student-review-kicker",
    "student-review-title",
    "student-review-subtitle",
    "student-review-body",
    "student-review-close-btn",
    "image-preview-modal",
    "image-preview-title",
    "image-preview-tip",
    "image-preview-close-btn",
    "image-preview-img",
    "image-preview-zoom-out-btn",
    "image-preview-zoom-in-btn",
    "image-preview-rotate-left-btn",
    "image-preview-rotate-right-btn",
    "image-preview-flip-x-btn",
    "image-preview-flip-y-btn",
    "image-preview-reset-btn",
    "image-preview-open-annot-btn",
    "annot-modal",
    "annot-modal-title",
    "annot-modal-tip",
    "annot-context",
    "annot-close-btn",
    "annot-canvas",
    "annot-note",
    "annot-zoom-out-btn",
    "annot-zoom-in-btn",
    "annot-rotate-left-btn",
    "annot-rotate-right-btn",
    "annot-flip-x-btn",
    "annot-flip-y-btn",
    "annot-fit-btn",
    "annot-zoom-label",
    "annot-undo-btn",
    "annot-clear-btn",
    "annot-save-btn",
  ];

  for (const id of ids) {
    ui[id] = document.getElementById(id);
  }
}

function bindEvents() {
  ui["sign-in-btn"].addEventListener("click", () => void signIn());
  ui["sign-up-btn"].addEventListener("click", () => void signUp());
  ui["message-bell-btn"].addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMessagePanel();
  });
  ui["mark-all-read-btn"].addEventListener("click", () => void markAllMessagesRead());
  ui["message-list"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-open-message-id]");
    if (!btn) {
      return;
    }
    const messageId = btn.dataset.openMessageId;
    if (!messageId) {
      return;
    }
    void openMessage(messageId);
  });
  ui["claim-teacher-btn"].addEventListener("click", () => void claimTeacherRole());
  ui["claim-admin-btn"].addEventListener("click", () => void claimAdminRole());
  ui["refresh-btn"].addEventListener("click", () => void refreshData());
  ui["sign-out-btn"].addEventListener("click", () => void signOut());

  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => {
      const page = btn.getAttribute("data-page");
      if (!page) {
        return;
      }
      showPage(page);
    });
  }

  ui["history-module-tabs"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-module]");
    if (!btn) {
      return;
    }
    const module = btn.getAttribute("data-module") || "all";
    historyModuleFilter = module;
    clearHistoryFocus();
    renderHistoryModuleTabs();
    renderHistoryList();
  });
  ui["history-date-filter"].addEventListener("change", () => {
    clearHistoryFocus();
    setHistoryDateFilter(ui["history-date-filter"].value);
  });
  ui["history-filter-today-btn"].addEventListener("click", () => {
    clearHistoryFocus();
    setHistoryDateFilter(toIsoDate(new Date()));
  });
  ui["history-date-clear-btn"].addEventListener("click", () => {
    clearHistoryFocus();
    setHistoryDateFilter("");
  });

  ui["ai-save-config-btn"].addEventListener("click", saveAiConfig);
  ui["ai-test-btn"].addEventListener("click", () => void testAiConnection());
  bindImagePasteZone({
    zoneId: "essay-paste-zone",
    pickBtnId: "essay-pick-btn",
    inputId: "essay-images",
    appendFn: appendEssayImageFiles,
    label: "作文图片",
  });
  ui["essay-images"].addEventListener("change", (event) => {
    onPickEssayImages(event);
  });
  ui["essay-pending-images"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-remove-essay-id]");
    if (!btn) {
      return;
    }
    removeEssayImage(btn.dataset.removeEssayId);
  });
  ui["essay-ocr-btn"].addEventListener("click", () => void runEssayOcrOnly());
  ui["essay-review-btn"].addEventListener("click", () => void reviewEssayWithAi());
  ui["essay-clear-btn"].addEventListener("click", clearEssayDraft);
  ui["essay-chat-send-btn"].addEventListener("click", () => void sendEssayChat());
  ui["essay-chat-input"].addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendEssayChat();
    }
  });

  ui["translation-mode"].addEventListener("change", onTranslationModeChanged);
  ui["translation-year-filter"].addEventListener("change", () => renderTranslationPromptSelect());
  ui["translation-paper-filter"].addEventListener("change", () => renderTranslationPromptSelect());
  ui["translation-prompt-select"].addEventListener("change", applySelectedTranslationPrompt);
  bindImagePasteZone({
    zoneId: "translation-paste-zone",
    pickBtnId: "translation-pick-btn",
    inputId: "translation-images",
    appendFn: appendTranslationImageFiles,
    label: "翻译图片",
  });
  ui["translation-images"].addEventListener("change", (event) => {
    onPickTranslationImages(event);
  });
  ui["translation-pending-images"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-remove-translation-id]");
    if (!btn) {
      return;
    }
    removeTranslationImage(btn.dataset.removeTranslationId);
  });
  ui["translation-ocr-btn"].addEventListener("click", () => void runTranslationOcrOnly());
  ui["translation-review-btn"].addEventListener("click", () => void reviewTranslationWithAi());
  ui["translation-clear-btn"].addEventListener("click", clearTranslationDraft);
  ui["translation-history-refresh-btn"].addEventListener("click", () => void loadMyTranslationAttempts(true));

  ui["translation-teacher-load-btn"].addEventListener("click", () => void loadTeacherTranslationAttempts());
  ui["translation-teacher-date"].addEventListener("change", () => void loadTeacherTranslationAttempts());
  ui["translation-teacher-student"].addEventListener("change", () => void loadTeacherTranslationAttempts());
  ui["translation-teacher-list"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-translation-attempt-id]");
    if (!btn) {
      return;
    }
    const attemptId = btn.dataset.translationAttemptId;
    if (!attemptId) {
      return;
    }
    selectTeacherTranslationAttempt(attemptId);
  });
  ui["translation-save-review-btn"].addEventListener("click", () => void saveTeacherTranslationReview());
  bindImagePasteZone({
    zoneId: "study-paste-zone",
    pickBtnId: "study-pick-btn",
    inputId: "study-images",
    appendFn: appendStudyImageFiles,
    label: "作业图片",
  });

  ui["submission-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSubmission();
  });

  ui["student-date-prev-btn"].addEventListener("click", () => {
    studentSubmissionCursor = addDays(studentSubmissionCursor, -7);
    renderStudentDatePicker();
  });
  ui["student-date-today-btn"].addEventListener("click", () => {
    const today = toIsoDate(new Date());
    studentSubmissionCursor = startOfWeek(today);
    applyStudentStudyDate(today);
  });
  ui["student-date-next-btn"].addEventListener("click", () => {
    studentSubmissionCursor = addDays(studentSubmissionCursor, 7);
    renderStudentDatePicker();
  });
  ui["student-date-chip-list"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-study-quick-date]");
    if (!btn) {
      return;
    }
    const pickedDate = btn.dataset.studyQuickDate;
    if (!pickedDate) {
      return;
    }
    applyStudentStudyDate(pickedDate);
  });

  ui["study-date"].addEventListener("change", () => {
    syncStudentDateQuickCursor();
    scheduleSubmissionDraftSync();
    void onStudentSlotChanged();
  });
  ui["study-module"].addEventListener("change", () => {
    scheduleSubmissionDraftSync();
    void onStudentSlotChanged();
  });
  ui["study-content"].addEventListener("input", scheduleSubmissionDraftSync);
  ui["word-summary"].addEventListener("input", scheduleSubmissionDraftSync);
  ui["mistake-summary"].addEventListener("input", scheduleSubmissionDraftSync);
  ui["clear-submission-draft-btn"].addEventListener("click", () => void clearSubmissionDraft(true));

  ui["study-images"].addEventListener("change", (event) => {
    void onPickImages(event);
  });

  ui["pending-images"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-remove-pending-id]");
    if (!btn) {
      return;
    }
    removePendingImage(btn.dataset.removePendingId);
  });

  ui["existing-images"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-remove-existing-index]");
    if (!btn) {
      return;
    }
    const index = Number.parseInt(btn.dataset.removeExistingIndex, 10);
    if (Number.isNaN(index)) {
      return;
    }
    removeExistingImage(index);
  });

  ui["set-role-btn"].addEventListener("click", () => void setUserRole());
  ui["identity-target-user"].addEventListener("change", loadIdentityFromSelection);
  ui["load-identity-btn"].addEventListener("click", loadIdentityFromSelection);
  ui["save-identity-btn"].addEventListener("click", () => void saveIdentityLabel());
  ui["use-email-as-name-btn"].addEventListener("click", () => void setIdentityToEmail());
  ui["teacher-load-btn"].addEventListener("click", () => void loadTeacherData());

  ui["teacher-review-list"].addEventListener("click", (event) => {
    const deleteBtn = event.target.closest("button[data-delete-submission-id]");
    if (deleteBtn) {
      const deleteId = deleteBtn.getAttribute("data-delete-submission-id");
      if (deleteId) {
        void deleteSubmissionAsAdmin(deleteId);
      }
      return;
    }

    const btn = event.target.closest("button[data-review-id]");
    if (!btn) {
      return;
    }
    const id = btn.getAttribute("data-review-id");
    if (!id) {
      return;
    }
    void selectSubmissionForReview(id);
  });

  ui["review-images"].addEventListener("click", (event) => {
    const previewBtn = event.target.closest("button[data-open-preview]");
    if (previewBtn) {
      const submissionId = previewBtn.dataset.submissionId;
      const source = previewBtn.dataset.sourceUrl;
      if (submissionId && source) {
        const sourceUrl = decodeURIComponent(source);
        openImagePreview(submissionId, sourceUrl, {
          allowAnnotate: true,
          enableTransforms: true,
          title: buildSourcePreviewTitle(submissionId, sourceUrl),
          tip: "这里支持先看大图、旋转翻转，再进入批注工作台。",
        });
      }
      return;
    }

    const btn = event.target.closest("button[data-open-annot]");
    if (!btn) {
      return;
    }
    const submissionId = btn.dataset.submissionId;
    const source = btn.dataset.sourceUrl;
    if (!submissionId || !source) {
      return;
    }
    void openAnnotationModal(submissionId, decodeURIComponent(source));
  });

  ui["review-annotations"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-edit-annot-id]");
    if (!btn) {
      return;
    }
    const submissionId = btn.dataset.submissionId;
    const annotationId = btn.dataset.editAnnotId;
    if (!submissionId || !annotationId) {
      return;
    }
    void reopenAnnotationForEdit(submissionId, annotationId);
  });

  ui["saved-review-list"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-saved-review-id]");
    if (!btn) {
      return;
    }
    const id = btn.getAttribute("data-saved-review-id");
    if (!id) {
      return;
    }
    void selectSubmissionForReview(id);
  });

  ui["saved-review-refresh-btn"].addEventListener("click", () => {
    void loadTeacherData(true);
  });

  ui["review-status"].addEventListener("change", scheduleReviewDraftSync);
  ui["review-score"].addEventListener("input", scheduleReviewDraftSync);
  ui["review-comment"].addEventListener("input", scheduleReviewDraftSync);
  ui["clear-review-draft-btn"].addEventListener("click", () => void clearActiveReviewDraft());
  ui["save-review-btn"].addEventListener("click", () => void saveReview());
  ui["history-list"].addEventListener("click", handleStudentReviewActionClick);
  ui["history-sync-list"].addEventListener("click", handleStudentReviewActionClick);
  ui["student-review-body"].addEventListener("click", handleStudentReviewActionClick);
  ui["student-review-close-btn"].addEventListener("click", closeStudentReviewModal);
  ui["student-calendar-grid"].addEventListener("click", (event) => {
    const cell = event.target.closest("button[data-history-date]");
    if (!cell) {
      return;
    }
    const pickedDate = cell.dataset.historyDate;
    if (!pickedDate) {
      return;
    }
    clearHistoryFocus();
    setHistoryDateFilter(historyDateFilter === pickedDate ? "" : pickedDate, { syncCalendar: false });
  });
  ui["student-calendar-prev-btn"].addEventListener("click", () => {
    studentCalendarCursor = addMonths(studentCalendarCursor, -1);
    void loadStudentCalendarData();
  });
  ui["student-calendar-today-btn"].addEventListener("click", () => {
    studentCalendarCursor = startOfMonth(new Date());
    void loadStudentCalendarData();
  });
  ui["student-calendar-next-btn"].addEventListener("click", () => {
    studentCalendarCursor = addMonths(studentCalendarCursor, 1);
    void loadStudentCalendarData();
  });
  ui["calendar-student"].addEventListener("change", () => void loadTeacherCalendarData());
  ui["teacher-calendar-prev-btn"].addEventListener("click", () => {
    teacherCalendarCursor = addMonths(teacherCalendarCursor, -1);
    void loadTeacherCalendarData();
  });
  ui["teacher-calendar-today-btn"].addEventListener("click", () => {
    teacherCalendarCursor = startOfMonth(new Date());
    void loadTeacherCalendarData();
  });
  ui["teacher-calendar-next-btn"].addEventListener("click", () => {
    teacherCalendarCursor = addMonths(teacherCalendarCursor, 1);
    void loadTeacherCalendarData();
  });
  ui["teacher-calendar-grid"].addEventListener("click", (event) => {
    const cell = event.target.closest("button[data-calendar-date]");
    if (!cell) {
      return;
    }
    const markDate = cell.dataset.calendarDate;
    if (!markDate) {
      return;
    }
    void cycleTeacherCalendarMark(markDate);
  });

  ui["reflection-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    void saveStudentReflection();
  });

  ui["load-reflections-btn"].addEventListener("click", () => void loadTeacherReflections());
  ui["teacher-reflection-list"].addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-reflection-id]");
    if (!btn) {
      return;
    }
    const reflectionId = btn.dataset.reflectionId;
    if (!reflectionId) {
      return;
    }
    selectTeacherReflection(reflectionId);
  });

  ui["save-reflection-comment-btn"].addEventListener("click", () => void saveReflectionComment());

  ui["annot-close-btn"].addEventListener("click", closeAnnotationModal);
  ui["annot-zoom-out-btn"].addEventListener("click", () => adjustAnnotZoom(-0.15));
  ui["annot-zoom-in-btn"].addEventListener("click", () => adjustAnnotZoom(0.15));
  ui["annot-rotate-left-btn"].addEventListener("click", () => void rotateAnnotation(-90));
  ui["annot-rotate-right-btn"].addEventListener("click", () => void rotateAnnotation(90));
  ui["annot-flip-x-btn"].addEventListener("click", () => void flipAnnotation("x"));
  ui["annot-flip-y-btn"].addEventListener("click", () => void flipAnnotation("y"));
  ui["annot-fit-btn"].addEventListener("click", fitAnnotCanvas);
  ui["annot-undo-btn"].addEventListener("click", () => void undoAnnotation());
  ui["annot-clear-btn"].addEventListener("click", () => void clearAnnotation());
  ui["annot-save-btn"].addEventListener("click", () => void saveAnnotationImage());
  ui["student-review-modal"].addEventListener("click", (event) => {
    if (event.target === ui["student-review-modal"]) {
      closeStudentReviewModal();
    }
  });
  ui["image-preview-close-btn"].addEventListener("click", closeImagePreview);
  ui["image-preview-zoom-out-btn"].addEventListener("click", () => adjustPreviewZoom(-0.15));
  ui["image-preview-zoom-in-btn"].addEventListener("click", () => adjustPreviewZoom(0.15));
  ui["image-preview-rotate-left-btn"].addEventListener("click", () => rotatePreview(-90));
  ui["image-preview-rotate-right-btn"].addEventListener("click", () => rotatePreview(90));
  ui["image-preview-flip-x-btn"].addEventListener("click", togglePreviewFlipX);
  ui["image-preview-flip-y-btn"].addEventListener("click", togglePreviewFlipY);
  ui["image-preview-reset-btn"].addEventListener("click", resetImagePreviewTransform);
  ui["image-preview-open-annot-btn"].addEventListener("click", openCurrentPreviewInAnnotator);
  ui["image-preview-modal"].addEventListener("click", (event) => {
    if (event.target === ui["image-preview-modal"]) {
      closeImagePreview();
    }
  });
  ui["annot-modal"].addEventListener("click", (event) => {
    if (event.target === ui["annot-modal"]) {
      closeAnnotationModal();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".message-hub")) {
      hideMessagePanel();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    hideMessagePanel();
    if (previewState.open) {
      closeImagePreview();
      return;
    }
    if (!ui["student-review-modal"].classList.contains("hidden")) {
      closeStudentReviewModal();
      return;
    }
    if (annotState.open) {
      closeAnnotationModal();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void loadMessages(true);
    }
  });

  bindCanvasDrawingEvents();
}

function bindCanvasDrawingEvents() {
  const canvas = ui["annot-canvas"];
  if (!canvas) {
    return;
  }

  canvas.addEventListener("pointerdown", onAnnotPointerDown);
  canvas.addEventListener("pointermove", onAnnotPointerMove);
  canvas.addEventListener("pointerup", onAnnotPointerUp);
  canvas.addEventListener("pointerleave", onAnnotPointerUp);
  canvas.addEventListener("pointercancel", onAnnotPointerUp);
}

function fillDefaultDates() {
  const today = toIsoDate(new Date());
  ui["study-date"].value = today;
  ui["teacher-date"].value = today;
  ui["reflection-date"].value = today;
  ui["reflection-filter-date"].value = today;
  ui["translation-teacher-date"].value = today;
  historyDateFilter = "";
  studentSubmissionCursor = startOfWeek(today);
  renderStudentDatePicker();
  renderHistoryFilterState();
}

function renderMotivation() {
  const quotes = [
    { zh: "今天多做一页，考场就少慌一分。", en: "One extra page today means one less panic moment in the exam." },
    { zh: "四级不是天赋题，是执行力题。", en: "CET-4 is not about talent, it's about execution." },
    { zh: "你现在的每次复盘，都会在考场里救你。", en: "Every review you do now will save you points on exam day." },
    { zh: "每天稳步推进，比临时爆冲更有效。", en: "Steady daily progress beats last-minute cramming." },
    { zh: "把错题吃透，就是在给分数加底座。", en: "Mastering mistakes builds your score foundation." },
    { zh: "坚持打卡的日子，最终都会体现在成绩上。", en: "Consistency always appears in your final score." },
    { zh: "能坚持到最后的人，往往不是最聪明的人。", en: "The one who persists wins, not necessarily the smartest one." },
    { zh: "每次纠错，都是在缩小你和目标分的距离。", en: "Every correction shortens the gap to your target score." },
    { zh: "慢一点没关系，停下才最可惜。", en: "Going slow is fine; stopping is the real loss." },
    { zh: "今天不追求完美，只追求完成。", en: "Today, aim for completion over perfection." },
    { zh: "高分来自重复，不是灵感。", en: "High scores come from repetition, not inspiration." },
    { zh: "把每天做到位，结果会替你说话。", en: "Do each day well, and results will speak for you." },
    { zh: "你练过的每个句型，都会在考场里回报你。", en: "Every sentence pattern you practice will pay off in the exam." },
    { zh: "先把简单题拿满，心态就稳了。", en: "Secure the easy points first, and confidence follows." },
    { zh: "完成计划，比等待状态更重要。", en: "Executing the plan matters more than waiting for motivation." },
    { zh: "今天的自律，是明天的底气。", en: "Today's discipline becomes tomorrow's confidence." },
    { zh: "当你开始稳定，分数就开始上涨。", en: "When your routine stabilizes, your score rises." },
    { zh: "不怕慢，只怕断。", en: "Do not fear slow progress; fear inconsistency." },
    { zh: "你不是在熬时间，你是在积累优势。", en: "You are not killing time; you are building an advantage." },
    { zh: "先坚持 7 天，再谈难不难。", en: "Commit for seven days first, then judge the difficulty." },
    { zh: "每一天的认真，都会变成最后的幸运。", en: "Daily effort turns into final luck." },
    { zh: "有记录的努力，才会持续有效。", en: "Effort with records is effort that lasts." },
    { zh: "别和别人比，先超过昨天的自己。", en: "Don't compare with others; beat yesterday's self first." },
    { zh: "你愿意复盘，已经超过很多人。", en: "Your willingness to review already puts you ahead of many." },
    { zh: "分数是副产品，能力才是主线。", en: "Score is a byproduct; ability is the main line." },
    { zh: "先行动，再优化。", en: "Act first, optimize later." },
    { zh: "现在的认真，会在成绩单上发光。", en: "Your effort now will shine on the score report." },
    { zh: "练到熟练，考试就会轻松。", en: "Train to fluency, and the test gets easier." },
    { zh: "任何一天都不晚，从今天开始。", en: "It is never too late; start today." },
    { zh: "稳定输入，才有稳定输出。", en: "Stable input leads to stable output." },
  ];

  const now = new Date();
  const index = (now.getFullYear() + now.getMonth() * 31 + now.getDate()) % quotes.length;
  ui["motivation-quote"].textContent = `${quotes[index].zh} / ${quotes[index].en}`;
  ui["motivation-sub"].textContent = "今天完成计划中的一小步，就是上岸的一大步。 / Small daily wins lead to big exam results.";
}

function isAdminUser() {
  return Boolean(currentProfile?.is_admin);
}

function roleLabel(profile) {
  if (!profile) {
    return "-";
  }

  let base = "学生";
  if (profile.role === "teacher") {
    base = "老师";
  } else if (profile.role === "teammate") {
    base = "队友";
  }

  if (profile.role === "teacher" && profile.is_admin) {
    return `${base}（管理员）`;
  }

  return base;
}

function getAllowedPages(role) {
  if (role === "teacher") {
    return ["teacher-review", "teacher-reflection", "teacher-translation", "teacher-essay", "teacher-guide"];
  }
  if (role === "teammate") {
    return [
      "teammate-guide",
      "teammate-home",
      "teammate-history",
      "teammate-review",
      "teammate-reflection",
      "teammate-translation",
      "teammate-essay",
    ];
  }
  return ["student-guide", "student-home", "student-history", "student-reflection", "student-translation", "student-essay"];
}

function getDefaultPage(role) {
  if (role === "teacher") {
    return "teacher-review";
  }
  if (role === "teammate") {
    return "teammate-home";
  }
  return "student-home";
}

function showPage(requestedPage) {
  if (!currentProfile) {
    return;
  }

  const role = currentProfile.role;
  const allowed = getAllowedPages(role);
  const page = allowed.includes(requestedPage) ? requestedPage : getDefaultPage(role);

  activePage = page;
  sessionStorage.setItem(`cet4_active_page_${role}`, page);
  hideMessagePanel();

  ui["student-panel"].classList.add("hidden");
  ui["teacher-panel"].classList.add("hidden");
  ui["history-panel"].classList.add("hidden");
  ui["reflection-panel"].classList.add("hidden");
  ui["translation-panel"].classList.add("hidden");
  ui["essay-panel"].classList.add("hidden");
  ui["guide-panel"].classList.add("hidden");

  if (page === "student-home" || page === "teammate-home") {
    ui["student-panel"].classList.remove("hidden");
    renderStudentDatePicker();
    void loadCurrentSubmissionImages();
  } else if (page === "teacher-review" || page === "teammate-review") {
    ui["teacher-panel"].classList.remove("hidden");
    void loadTeacherCalendarData();
  } else if (page === "student-history" || page === "teammate-history") {
    ui["history-panel"].classList.remove("hidden");
    renderHistoryModuleTabs();
    renderHistoryList();
    void loadStudentCalendarData();
  } else if (page === "student-reflection" || page === "teacher-reflection" || page === "teammate-reflection") {
    ui["reflection-panel"].classList.remove("hidden");
    if (page === "student-reflection") {
      void loadStudentReflections();
    } else {
      void loadTeacherReflections();
    }
  } else if (page === "student-essay" || page === "teacher-essay" || page === "teammate-essay") {
    ui["essay-panel"].classList.remove("hidden");
  } else if (page === "student-translation" || page === "teacher-translation" || page === "teammate-translation") {
    ui["translation-panel"].classList.remove("hidden");
    if (currentProfile.role === "student") {
      void Promise.all([
        loadTranslationPromptCatalog(),
        loadMyTranslationAttempts(),
      ]);
    } else if (currentProfile.role === "teacher") {
      void loadTeacherTranslationAttempts();
    } else {
      void Promise.all([
        loadTranslationPromptCatalog(),
        loadMyTranslationAttempts(),
        loadTeacherTranslationAttempts(),
      ]);
    }
  } else if (page === "student-guide" || page === "teacher-guide" || page === "teammate-guide") {
    ui["guide-panel"].classList.remove("hidden");
  }

  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.classList.toggle("active", btn.getAttribute("data-page") === page);
  }
}

function lockAuth(message) {
  ui["sign-in-btn"].disabled = true;
  ui["sign-up-btn"].disabled = true;
  showAlert(message, "error");
}

async function syncSessionUi() {
  if (!currentSession) {
    currentProfile = null;
    allProfiles = new Map();
    submissionCache = [];
    annotationMapBySubmission = new Map();
    teacherReviewMap = new Map();
    reflectionCache = [];
    reflectionCommentMap = new Map();
    selectedSubmissionId = null;
    selectedReflectionId = null;
    activePage = "";
    historyDateFilter = "";
    historyHighlightedSubmissionId = "";
    studentSubmissionCursor = startOfWeek(new Date());
    essayChatHistory = [];
    clearEssayPendingImages();
    resetTranslationState();
    resetMessageState();
    hasShownSubmissionDraftRestore = false;
    renderEssayChatLog();
    resetStudentImageState();
    closeImagePreview();
    closeStudentReviewModal();
    closeAnnotationModal();
    setSessionBadge(false);
    ui["auth-panel"].classList.remove("hidden");
    ui["workspace"].classList.add("hidden");
    return;
  }

  const ready = await ensureProfile();
  if (!ready) {
    return;
  }

  setSessionBadge(true);
  ui["auth-panel"].classList.add("hidden");
  ui["workspace"].classList.remove("hidden");
  ui["who-email"].textContent = currentSession.user.email ?? "-";
  ui["who-role"].textContent = roleLabel(currentProfile);

  const isTeammate = currentProfile.role === "teammate";
  const isStudent = currentProfile.role === "student" || isTeammate;
  const isTeacher = currentProfile.role === "teacher" || isTeammate;
  const isPureTeacher = currentProfile.role === "teacher";

  ui["student-nav"].classList.toggle("hidden", !isStudent);
  ui["teammate-nav"].classList.toggle("hidden", !isTeammate);
  ui["teacher-nav"].classList.toggle("hidden", !isTeacher);
  ui["reflection-student"].classList.toggle("hidden", !isStudent);
  ui["reflection-teacher"].classList.toggle("hidden", !isTeacher);
  ui["translation-student"].classList.toggle("hidden", !isStudent);
  ui["translation-teacher"].classList.toggle("hidden", !isTeacher);
  for (const el of document.querySelectorAll(".teacher-only")) {
    el.classList.toggle("hidden", !isPureTeacher);
  }
  ui["student-panel"].classList.add("hidden");
  ui["teacher-panel"].classList.add("hidden");
  ui["history-panel"].classList.add("hidden");
  ui["reflection-panel"].classList.add("hidden");
  ui["translation-panel"].classList.add("hidden");
  ui["essay-panel"].classList.add("hidden");
  ui["guide-panel"].classList.add("hidden");

  const defaultPage = getDefaultPage(currentProfile.role);
  const role = currentProfile.role;
  const firstGuideKey = `cet4_guide_seen_${role}`;
  const hasSeenGuide = localStorage.getItem(firstGuideKey) === "1";
  const saved = sessionStorage.getItem(`cet4_active_page_${role}`) || defaultPage;
  const guidePage = role === "teacher" ? "teacher-guide" : role === "teammate" ? "teammate-guide" : "student-guide";
  const landing = hasSeenGuide ? saved : guidePage;
  showPage(landing);
  if (!hasSeenGuide) {
    localStorage.setItem(firstGuideKey, "1");
  }

  await refreshData();
  startMessagePolling();
  void loadMessages(true);
}

async function ensureProfile() {
  const uid = currentSession?.user?.id;
  if (!uid) {
    return false;
  }

  let { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", uid)
    .maybeSingle();

  if (error) {
    showAlert(`读取 profile 失败: ${error.message}`, "error");
    return false;
  }

  if (!data) {
    const fallbackName = currentSession.user.email?.split("@")[0] ?? "new_user";
    const { error: insertError } = await supabase.from("profiles").insert({
      id: uid,
      full_name: fallbackName,
      role: "student",
    });

    if (insertError) {
      showAlert(`创建 profile 失败: ${insertError.message}`, "error");
      return false;
    }

    const result = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .single();

    data = result.data;
    error = result.error;
  }

  if (error || !data) {
    showAlert(`获取 profile 失败: ${error?.message ?? "未知错误"}`, "error");
    return false;
  }

  currentProfile = data;
  return true;
}

function setSessionBadge(online) {
  const badge = ui["session-badge"];
  badge.classList.toggle("online", online);
  badge.classList.toggle("offline", !online);
  badge.textContent = online ? "在线" : "未登录";
}

function getSubmissionDraftKey() {
  const uid = currentSession?.user?.id;
  return uid ? `${SUBMISSION_DRAFT_PREFIX}_${uid}` : "";
}

function getReviewDraftKey(submissionId) {
  const uid = currentSession?.user?.id;
  return uid && submissionId ? `${REVIEW_DRAFT_PREFIX}_${uid}_${submissionId}` : "";
}

function readCurrentSubmissionDraft() {
  return {
    studyDate: ui["study-date"].value,
    module: ui["study-module"].value,
    content: ui["study-content"].value,
    wordSummary: ui["word-summary"].value,
    mistakeSummary: ui["mistake-summary"].value,
    pendingImageCount: pendingImages.length,
    updatedAt: new Date().toISOString(),
  };
}

function updateSubmissionDraftState(draft = null, synced = false) {
  const el = ui["submission-draft-state"];
  if (!el) {
    return;
  }

  if (!draft) {
    el.textContent = "文字和待上传图片会自动保存为草稿，刷新后可继续编辑。";
    return;
  }

  const when = formatDateTime(draft.updatedAt);
  const imageText = draft.pendingImageCount > 0 ? `，待上传图片 ${draft.pendingImageCount} 张也已保留` : "";
  el.textContent = `${synced ? "本地草稿已更新" : "已恢复本地草稿"}：${draft.studyDate || "-"} / ${MODULE_LABELS[draft.module] ?? draft.module ?? "-"} · ${when}${imageText}。`;
}

function scheduleSubmissionDraftSync() {
  if (suppressSubmissionDraftSync || !currentSession) {
    return;
  }
  if (submissionDraftTimer) {
    window.clearTimeout(submissionDraftTimer);
  }
  submissionDraftTimer = window.setTimeout(() => {
    void syncSubmissionDraftNow();
  }, 260);
}

async function syncSubmissionDraftNow() {
  if (suppressSubmissionDraftSync || !currentSession || (currentProfile?.role !== "student" && currentProfile?.role !== "teammate")) {
    return;
  }

  if (submissionDraftTimer) {
    window.clearTimeout(submissionDraftTimer);
    submissionDraftTimer = 0;
  }

  const key = getSubmissionDraftKey();
  if (!key) {
    return;
  }

  const draft = readCurrentSubmissionDraft();
  localStorage.setItem(key, JSON.stringify(draft));
  await persistSubmissionDraftAssets();
  updateSubmissionDraftState(draft, true);
}

async function restoreSubmissionDraft() {
  const key = getSubmissionDraftKey();
  if (!key) {
    updateSubmissionDraftState(null);
    return;
  }

  const raw = localStorage.getItem(key);
  let draft = null;
  if (raw) {
    try {
      draft = JSON.parse(raw);
    } catch (_error) {
      localStorage.removeItem(key);
    }
  }

  suppressSubmissionDraftSync = true;
  try {
    if (draft) {
      ui["study-date"].value = draft.studyDate || ui["study-date"].value;
      ui["study-module"].value = draft.module || ui["study-module"].value;
      ui["study-content"].value = draft.content || "";
      ui["word-summary"].value = draft.wordSummary || "";
      ui["mistake-summary"].value = draft.mistakeSummary || "";
      updateSubmissionDraftState(draft, false);
    } else {
      ui["study-content"].value = "";
      ui["word-summary"].value = "";
      ui["mistake-summary"].value = "";
      updateSubmissionDraftState(null);
    }

    const files = await loadSubmissionDraftAssets();
    if (files.length) {
      setPendingImagesFromFiles(files);
    } else {
      clearPendingImages();
    }
    syncStudentDateQuickCursor();
    if (!hasShownSubmissionDraftRestore && draft && (draft.content || draft.wordSummary || draft.mistakeSummary || files.length > 0)) {
      hasShownSubmissionDraftRestore = true;
      showAlert("已恢复上次未完成的作业草稿。", "info", 2800, true);
    }
  } finally {
    suppressSubmissionDraftSync = false;
  }
}

async function clearSubmissionDraft(resetFields = false) {
  const key = getSubmissionDraftKey();
  if (!key) {
    return;
  }

  if (resetFields && !confirmAction("确认清空当前作业草稿？本地文字和待上传图片都会删除。")) {
    return;
  }

  localStorage.removeItem(key);
  await clearSubmissionDraftAssets();
  updateSubmissionDraftState(null);

  if (resetFields) {
    suppressSubmissionDraftSync = true;
    try {
      ui["study-content"].value = "";
      ui["word-summary"].value = "";
      ui["mistake-summary"].value = "";
      clearPendingImages();
    } finally {
      suppressSubmissionDraftSync = false;
    }
    showAlert("本地作业草稿已清空。", "info", 2600, true);
  }
}

function readCurrentReviewDraft() {
  return {
    submissionId: selectedSubmissionId,
    status: ui["review-status"].value,
    score: ui["review-score"].value,
    comment: ui["review-comment"].value,
    updatedAt: new Date().toISOString(),
  };
}

function updateReviewDraftState(draft = null, synced = false) {
  const el = ui["review-draft-state"];
  if (!el) {
    return;
  }

  if (!selectedSubmissionId) {
    el.textContent = "当前批改内容会自动暂存，本地刷新后可恢复。";
    return;
  }

  if (!draft) {
    el.textContent = "当前批改内容会自动暂存，本地刷新后可恢复。";
    return;
  }

  el.textContent = `${synced ? "本地批改草稿已更新" : "已恢复本地批改草稿"}：${formatDateTime(draft.updatedAt)}。`;
}

function scheduleReviewDraftSync() {
  if (suppressReviewDraftSync || !selectedSubmissionId || !currentSession) {
    return;
  }
  if (reviewDraftTimer) {
    window.clearTimeout(reviewDraftTimer);
  }
  reviewDraftTimer = window.setTimeout(() => {
    syncReviewDraftNow();
  }, 220);
}

function syncReviewDraftNow() {
  if (suppressReviewDraftSync || !selectedSubmissionId || !currentSession || !isReviewerProfile()) {
    return;
  }

  if (reviewDraftTimer) {
    window.clearTimeout(reviewDraftTimer);
    reviewDraftTimer = 0;
  }

  const key = getReviewDraftKey(selectedSubmissionId);
  if (!key) {
    return;
  }

  const draft = readCurrentReviewDraft();
  localStorage.setItem(key, JSON.stringify(draft));
  updateReviewDraftState(draft, true);
}

function restoreReviewDraftForSelection() {
  if (!selectedSubmissionId) {
    updateReviewDraftState(null);
    return;
  }

  const key = getReviewDraftKey(selectedSubmissionId);
  const raw = key ? localStorage.getItem(key) : "";
  if (!raw) {
    updateReviewDraftState(null);
    return;
  }

  try {
    const draft = JSON.parse(raw);
    suppressReviewDraftSync = true;
    ui["review-status"].value = draft.status || ui["review-status"].value;
    ui["review-score"].value = draft.score || ui["review-score"].value;
    ui["review-comment"].value = draft.comment || ui["review-comment"].value;
    updateReviewDraftState(draft, false);
  } catch (_error) {
    localStorage.removeItem(key);
    updateReviewDraftState(null);
  } finally {
    suppressReviewDraftSync = false;
  }
}

function clearReviewDraftBySubmission(submissionId) {
  const key = getReviewDraftKey(submissionId);
  if (key) {
    localStorage.removeItem(key);
  }
  if (selectedSubmissionId === submissionId) {
    updateReviewDraftState(null);
  }
}

async function clearActiveReviewDraft() {
  if (!selectedSubmissionId) {
    return;
  }
  if (!confirmAction("确认清空当前批改的本地草稿？")) {
    return;
  }

  clearReviewDraftBySubmission(selectedSubmissionId);
  await selectSubmissionForReview(selectedSubmissionId);
  showAlert("当前批改的本地草稿已清空。", "info", 2400, true);
}

function resetMessageState() {
  stopMessagePolling();
  hideMessagePanel();
  unreadMessageCount = 0;
  messageCache = [];
  messagesFeatureReady = true;
  renderMessageBell();
  renderMessageList();
}

function startMessagePolling() {
  stopMessagePolling();
  if (!currentSession) {
    return;
  }
  messagePollTimer = window.setInterval(() => {
    void loadMessages(true);
  }, MESSAGE_POLL_INTERVAL_MS);
}

function stopMessagePolling() {
  if (messagePollTimer) {
    window.clearInterval(messagePollTimer);
    messagePollTimer = 0;
  }
}

function toggleMessagePanel() {
  if (!messagesFeatureReady) {
    showAlert("消息提醒功能需要先执行最新的 schema.sql。", "error", 3600, true);
    return;
  }

  ui["message-panel"].classList.toggle("hidden");
  if (!ui["message-panel"].classList.contains("hidden")) {
    void loadMessages(true);
  }
}

function hideMessagePanel() {
  ui["message-panel"].classList.add("hidden");
}

function renderMessageBell() {
  const badge = ui["message-bell-badge"];
  if (!badge) {
    return;
  }
  if (!unreadMessageCount) {
    badge.classList.add("hidden");
    badge.textContent = "0";
    return;
  }
  badge.classList.remove("hidden");
  badge.textContent = unreadMessageCount > 99 ? "99+" : String(unreadMessageCount);
}

function renderMessageList() {
  const holder = ui["message-list"];
  if (!holder) {
    return;
  }

  if (!messagesFeatureReady) {
    holder.innerHTML = "<p class=\"muted\">当前数据库还没升级到新版消息结构，执行最新 schema.sql 后这里会自动启用。</p>";
    renderMessageBell();
    return;
  }

  if (!messageCache.length) {
    holder.innerHTML = "<p class=\"muted\">暂时没有新消息。</p>";
    renderMessageBell();
    return;
  }

  holder.innerHTML = messageCache
    .map((row) => {
      const unread = !row.read_at;
      const title = escapeHtml(messageEventTitle(row.event_type));
      const body = escapeHtml(row.body || "");
      const sender = escapeHtml(displayName(row.sender_id));
      const when = escapeHtml(formatDateTime(row.created_at));
      const page = escapeHtml(messagePageLabel(row.link_page));
      return `
        <article class="message-card ${unread ? "unread" : ""}">
          <div class="message-card-head">
            <span class="message-card-title">${title}</span>
            <span class="message-card-time">${when}</span>
          </div>
          <p class="message-card-body">${body}</p>
          <div class="message-card-actions">
            <span class="message-card-tag">${sender} · ${page}</span>
            <button class="btn btn-ghost btn-small" type="button" data-open-message-id="${row.id}" title="打开相关页面">${unread ? "查看并已读" : "查看"}</button>
          </div>
        </article>
      `;
    })
    .join("");

  renderMessageBell();
}

async function loadMessages(silent = false) {
  if (!currentSession) {
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("recipient_id", currentSession.user.id)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    if (isMessageSchemaError(error)) {
      messagesFeatureReady = false;
      unreadMessageCount = 0;
      messageCache = [];
      renderMessageList();
      return;
    }
    if (!silent) {
      showAlert(`读取消息提醒失败: ${error.message}`, "error", 4800, true);
    }
    return;
  }

  messagesFeatureReady = true;
  messageCache = data ?? [];
  unreadMessageCount = messageCache.filter((item) => !item.read_at).length;
  renderMessageList();
}

async function markMessageRead(messageId) {
  const row = messageCache.find((item) => item.id === messageId);
  if (!row || row.read_at || !messagesFeatureReady) {
    return;
  }

  const { error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("recipient_id", currentSession.user.id);

  if (error) {
    if (!isMessageSchemaError(error)) {
      showAlert(`标记消息已读失败: ${error.message}`, "error", 4200, true);
    }
    return;
  }

  row.read_at = new Date().toISOString();
  unreadMessageCount = Math.max(0, unreadMessageCount - 1);
  renderMessageList();
}

async function markAllMessagesRead() {
  if (!messageCache.length || !messagesFeatureReady) {
    return;
  }

  const unreadIds = messageCache.filter((item) => !item.read_at).map((item) => item.id);
  if (!unreadIds.length) {
    return;
  }

  const { error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .in("id", unreadIds)
    .eq("recipient_id", currentSession.user.id);

  if (error) {
    showAlert(`全部已读失败: ${error.message}`, "error", 4200, true);
    return;
  }

  const readAt = new Date().toISOString();
  messageCache = messageCache.map((item) => ({ ...item, read_at: item.read_at || readAt }));
  unreadMessageCount = 0;
  renderMessageList();
}

async function openMessage(messageId) {
  const row = messageCache.find((item) => item.id === messageId);
  if (!row) {
    return;
  }
  await markMessageRead(messageId);
  hideMessagePanel();
  if (row.link_page) {
    showPage(row.link_page);
    if ((row.link_page === "teacher-review" || row.link_page === "teammate-review") && row.related_submission_id) {
      await loadTeacherData(true);
      await selectSubmissionForReview(row.related_submission_id);
      return;
    }
    if (row.link_page === "student-history" || row.link_page === "teammate-history") {
      await loadStudentData();
      await loadStudentCalendarData();
      if (row.related_submission_id) {
        focusHistorySubmission(row.related_submission_id);
      }
    }
  }
}

function renderTeacherCalendarStudentOptions(users = [...allProfiles.values()]) {
  const select = ui["calendar-student"];
  if (!select) {
    return;
  }

  const current = select.value;
  const students = users.filter((item) => item.role !== "teacher");
  select.innerHTML = "";

  if (!students.length) {
    select.innerHTML = "<option value=\"\">暂无学生</option>";
    return;
  }

  students.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = describeUser(user);
    select.appendChild(option);
  });

  if ([...select.options].some((item) => item.value === current)) {
    select.value = current;
  }
}

async function loadStudentCalendarData() {
  if (!currentSession || (currentProfile?.role !== "student" && currentProfile?.role !== "teammate")) {
    return;
  }

  const result = await loadCalendarDataForStudent(currentSession.user.id, studentCalendarCursor);
  if (!result) {
    renderStudentCalendar();
    return;
  }

  studentCalendarMarks = result.marks;
  studentCalendarSubmissionCounts = result.countMap;
  renderStudentCalendar();
}

async function loadTeacherCalendarData() {
  if (!currentSession || (currentProfile?.role !== "teacher" && currentProfile?.role !== "teammate")) {
    return;
  }

  const studentId = ui["calendar-student"].value;
  if (!studentId) {
    teacherCalendarMarks = [];
    teacherCalendarSubmissionCounts = new Map();
    renderTeacherCalendar();
    return;
  }

  const result = await loadCalendarDataForStudent(studentId, teacherCalendarCursor);
  if (!result) {
    renderTeacherCalendar();
    return;
  }

  teacherCalendarMarks = result.marks;
  teacherCalendarSubmissionCounts = result.countMap;
  renderTeacherCalendar();
}

async function loadCalendarDataForStudent(studentId, monthDate) {
  if (!studentId) {
    return {
      marks: [],
      countMap: new Map(),
    };
  }

  const { start, end } = getMonthRange(monthDate);
  const [marksResp, submissionsResp] = await Promise.all([
    supabase
      .from("calendar_marks")
      .select("*")
      .eq("student_id", studentId)
      .gte("mark_date", start)
      .lte("mark_date", end)
      .order("mark_date", { ascending: true }),
    supabase
      .from("submissions")
      .select("study_date,module")
      .eq("student_id", studentId)
      .gte("study_date", start)
      .lte("study_date", end),
  ]);

  if (marksResp.error) {
    if (isCalendarSchemaError(marksResp.error)) {
      calendarFeatureReady = false;
      return null;
    }
    showAlert(`读取打卡日历失败: ${marksResp.error.message}`, "error", 4800, true);
    return null;
  }

  if (submissionsResp.error) {
    showAlert(`读取打卡提交统计失败: ${submissionsResp.error.message}`, "error", 4800, true);
    return null;
  }

  calendarFeatureReady = true;
  return {
    marks: marksResp.data ?? [],
    countMap: buildSubmissionCountMap(submissionsResp.data ?? []),
  };
}

function renderStudentCalendar() {
  ui["student-calendar-label"].textContent = formatMonthLabel(studentCalendarCursor);
  renderCalendarGrid(
    ui["student-calendar-grid"],
    studentCalendarCursor,
    studentCalendarMarks,
    studentCalendarSubmissionCounts,
    {
      filterable: true,
      selectedDate: historyDateFilter,
    }
  );
}

function renderTeacherCalendar() {
  ui["teacher-calendar-label"].textContent = formatMonthLabel(teacherCalendarCursor);
  if (!ui["calendar-student"].value) {
    ui["teacher-calendar-grid"].innerHTML = "<p class=\"muted\">先选择一位学生，再给对应日期做打卡标记。</p>";
    return;
  }
  renderCalendarGrid(
    ui["teacher-calendar-grid"],
    teacherCalendarCursor,
    teacherCalendarMarks,
    teacherCalendarSubmissionCounts,
    { editable: true }
  );
}

function renderCalendarGrid(holder, monthDate, marks, countMap, options = {}) {
  if (!holder) {
    return;
  }

  if (!calendarFeatureReady) {
    holder.innerHTML = `<p class="muted">Calendar data is not ready in the database yet.</p>`;
    return;
  }

  const editable = Boolean(options.editable);
  const filterable = Boolean(options.filterable);
  const selectedDate = String(options.selectedDate || "");
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const markMap = new Map((marks ?? []).map((row) => [row.mark_date, row]));
  const cells = buildCalendarCells(monthDate);
  const today = toIsoDate(new Date());

  holder.innerHTML = [
    ...weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`),
    ...cells.map((cell) => {
      if (!cell.iso) {
        return `<div class="calendar-cell is-empty" aria-hidden="true"></div>`;
      }
      const row = markMap.get(cell.iso);
      const kind = normalizeCalendarMarkKind(row?.kind);
      const count = countMap.get(cell.iso) || 0;
      const classes = [
        "calendar-cell",
        cell.iso === today ? "is-today" : "",
        editable || filterable ? "is-clickable" : "",
        filterable && selectedDate === cell.iso ? "is-filtered" : "",
      ].filter(Boolean).join(" ");
      const markHtml = kind === "none"
        ? `<span class="calendar-mark"></span>`
        : `<span class="calendar-mark kind-${kind}" title="${CALENDAR_MARK_LABELS[kind] ?? kind}"></span>`;
      const countHtml = count > 0 ? `<span class="calendar-count-badge">${count}</span>` : "";
      const todayHtml = cell.iso === today ? `<span class="calendar-today-pill">Today</span>` : "";
      const inner = `
        <span class="calendar-cell-head">
          <span class="calendar-cell-day-wrap">
            <span class="calendar-cell-day">${cell.day}</span>
            ${todayHtml}
          </span>
          <span class="calendar-cell-submissions">${count > 0 ? `${count} modules` : "No submit"}</span>
        </span>
        ${markHtml}
        ${countHtml}
      `;
      if (editable) {
        return `<button class="${classes}" type="button" data-calendar-date="${cell.iso}" title="Switch teacher mark">${inner}</button>`;
      }
      if (filterable) {
        return `<button class="${classes}" type="button" data-history-date="${cell.iso}" title="${selectedDate === cell.iso ? "Clear date filter" : `Filter by ${cell.iso}`}">${inner}</button>`;
      }
      return `<article class="${classes}">${inner}</article>`;
    }),
  ].join("");
}

async function cycleTeacherCalendarMark(markDate) {
  if (!calendarFeatureReady) {
    return;
  }

  const studentId = ui["calendar-student"].value;
  if (!studentId) {
    return;
  }

  const current = teacherCalendarMarks.find((row) => row.mark_date === markDate);
  const currentKind = normalizeCalendarMarkKind(current?.kind);
  const nextKind = nextCalendarMarkKind(currentKind);

  if (nextKind === "none") {
    if (!current?.id) {
      return;
    }
    const { error } = await supabase
      .from("calendar_marks")
      .delete()
      .eq("id", current.id);
    if (error) {
      showAlert(`删除日历标记失败: ${error.message}`, "error", 4200, true);
      return;
    }
    teacherCalendarMarks = teacherCalendarMarks.filter((row) => row.id !== current.id);
  } else {
    const payload = {
      student_id: studentId,
      mark_date: markDate,
      kind: nextKind,
      marked_by: currentSession.user.id,
    };
    const { data, error } = await supabase
      .from("calendar_marks")
      .upsert(payload, { onConflict: "student_id,mark_date" })
      .select("*")
      .maybeSingle();
    if (error) {
      showAlert(`保存日历标记失败: ${error.message}`, "error", 4200, true);
      return;
    }
    const saved = data || { ...payload, id: current?.id || `local_${markDate}` };
    const exists = teacherCalendarMarks.some((row) => row.mark_date === markDate);
    teacherCalendarMarks = exists
      ? teacherCalendarMarks.map((row) => (row.mark_date === markDate ? { ...row, ...saved } : row))
      : [...teacherCalendarMarks, saved];
    if (studentId === currentSession.user.id) {
      studentCalendarMarks = teacherCalendarMarks.slice();
      renderStudentCalendar();
    }
  }

  renderTeacherCalendar();
}

function openImagePreview(submissionId, sourceUrl, options = {}) {
  const row = findSubmissionRecord(submissionId);
  const defaultTitle = row
    ? `图片预览 · ${displayName(row.student_id)} · ${row.study_date} · ${MODULE_LABELS[row.module] ?? row.module}`
    : "图片预览";
  const allowAnnotate = options.allowAnnotate ?? isReviewerProfile();
  const enableTransforms = Boolean(options.enableTransforms);
  const title = options.title || defaultTitle;
  const tip = options.tip || (enableTransforms
    ? "Rotate and flip only affect this preview."
    : "Zoom-only preview. The original image never changes.");

  previewState.open = true;
  previewState.submissionId = submissionId;
  previewState.sourceUrl = sourceUrl;
  previewState.title = title;
  previewState.tip = tip;
  previewState.allowAnnotate = allowAnnotate;
  previewState.enableTransforms = enableTransforms;
  previewState.rotation = 0;
  previewState.scale = 1;
  previewState.flipX = 1;
  previewState.flipY = 1;

  ui["image-preview-img"].src = sourceUrl;
  ui["image-preview-title"].textContent = title;
  ui["image-preview-tip"].textContent = tip;
  ui["image-preview-open-annot-btn"].classList.toggle("hidden", !allowAnnotate);
  setImagePreviewToolVisibility();
  ui["image-preview-modal"].classList.remove("hidden");
  applyImagePreviewTransform();
}

function closeImagePreview() {
  previewState.open = false;
  previewState.submissionId = null;
  previewState.sourceUrl = "";
  previewState.title = "图片预览";
  previewState.tip = "Zoom-only preview. The original image never changes.";
  previewState.allowAnnotate = false;
  previewState.enableTransforms = false;
  resetImagePreviewTransform(false);
  ui["image-preview-img"].removeAttribute("src");
  ui["image-preview-title"].textContent = "图片预览";
  ui["image-preview-tip"].textContent = "Zoom-only preview. The original image never changes.";
  ui["image-preview-open-annot-btn"].classList.toggle("hidden", !isReviewerProfile());
  setImagePreviewToolVisibility();
  ui["image-preview-modal"].classList.add("hidden");
}

function setImagePreviewToolVisibility() {
  const showTransforms = Boolean(previewState.enableTransforms);
  ui["image-preview-rotate-left-btn"].classList.toggle("hidden", !showTransforms);
  ui["image-preview-rotate-right-btn"].classList.toggle("hidden", !showTransforms);
  ui["image-preview-flip-x-btn"].classList.toggle("hidden", !showTransforms);
  ui["image-preview-flip-y-btn"].classList.toggle("hidden", !showTransforms);
}

function applyImagePreviewTransform() {
  const img = ui["image-preview-img"];
  if (!img) {
    return;
  }
  img.style.transform = `rotate(${previewState.rotation}deg) scale(${previewState.scale * previewState.flipX}, ${previewState.scale * previewState.flipY})`;
}

function adjustPreviewZoom(delta) {
  previewState.scale = Math.min(3.2, Math.max(0.4, previewState.scale + delta));
  applyImagePreviewTransform();
}

function rotatePreview(delta) {
  previewState.rotation = (previewState.rotation + delta + 360) % 360;
  applyImagePreviewTransform();
}

function togglePreviewFlipX() {
  previewState.flipX *= -1;
  applyImagePreviewTransform();
}

function togglePreviewFlipY() {
  previewState.flipY *= -1;
  applyImagePreviewTransform();
}

function resetImagePreviewTransform(updateUi = true) {
  previewState.rotation = 0;
  previewState.scale = 1;
  previewState.flipX = 1;
  previewState.flipY = 1;
  if (updateUi) {
    applyImagePreviewTransform();
  }
}

function openCurrentPreviewInAnnotator() {
  if (!previewState.open || !previewState.submissionId || !previewState.sourceUrl || !previewState.allowAnnotate || !isReviewerProfile()) {
    return;
  }
  const submissionId = previewState.submissionId;
  const sourceUrl = previewState.sourceUrl;
  closeImagePreview();
  void openAnnotationModal(submissionId, sourceUrl);
}

function isReviewerProfile() {
  return currentProfile?.role === "teacher" || currentProfile?.role === "teammate";
}

async function signUp() {
  if (!supabase) {
    showAlert("Login service is still loading. Refresh the page and try again.", "error");
    return;
  }

  const email = ui["email"].value.trim();
  const password = ui["password"].value;
  if (!email || password.length < 6) {
    showAlert("注册失败：邮箱必填，密码至少 6 位。", "error");
    return;
  }

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    showAlert(`注册失败: ${error.message}`, "error");
    return;
  }

  showAlert("注册成功，请使用账号登录。", "info");
}

async function signIn() {
  if (!supabase) {
    showAlert("Login service is still loading. Refresh the page and try again.", "error");
    return;
  }

  const email = ui["email"].value.trim();
  const password = ui["password"].value;

  if (!email || !password) {
    showAlert("登录失败：邮箱和密码不能为空。", "error");
    return;
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showAlert(`登录失败: ${error.message}`, "error");
    return;
  }

  showAlert("登录成功。", "info", 1500);
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    showAlert(`退出失败: ${error.message}`, "error");
    return;
  }

  showAlert("已退出登录。", "info", 1200);
}

async function claimTeacherRole() {
  const { data, error } = await supabase.rpc("claim_teacher_role");
  if (error) {
    showAlert(`设为老师失败: ${error.message}`, "error");
    return;
  }

  if (data?.role === "teacher") {
    showAlert("你已成为老师。", "info");
  } else {
    showAlert("角色已更新。", "info");
  }

  await ensureProfile();
  await refreshData();
}

async function claimAdminRole() {
  const { data, error } = await supabase.rpc("claim_admin_role");
  if (error) {
    showAlert(`设为管理员失败: ${error.message}`, "error", 5200, true);
    return;
  }

  if (data?.is_admin) {
    showAlert("你已成为管理员。", "info", 2600, true);
  } else {
    showAlert("管理员状态已更新。", "info", 2200, true);
  }

  await ensureProfile();
  await refreshData();
}

async function refreshData() {
  if (!currentSession || !currentProfile) {
    return;
  }

  const profileOk = await loadProfiles();
  if (!profileOk) {
    return;
  }

  refreshRoleUi();

  if (currentProfile.role === "student") {
    resetStudentImageState();
    resetTeacherTranslationEditor();
    if (ui["existing-images-panel"]) {
      ui["existing-images-panel"].open = false;
    }
    await restoreSubmissionDraft();
    await Promise.all([
      loadStudentData(),
      loadCurrentSubmissionImages(),
      loadStudentCalendarData(),
      loadStudentReflections(),
      loadTranslationPromptCatalog(),
      loadMyTranslationAttempts(),
    ]);
  } else if (currentProfile.role === "teacher") {
    clearReviewEditor();
    clearTranslationDraft(false);
    resetTeacherTranslationEditor();
    await Promise.all([
      loadTeacherData(),
      loadTeacherCalendarData(),
      loadTeacherReflections(),
      loadTranslationPromptCatalog(),
      loadTeacherTranslationAttempts(),
    ]);
  } else {
    // teammate: both can submit and review
    resetStudentImageState();
    resetTeacherTranslationEditor();
    if (ui["existing-images-panel"]) {
      ui["existing-images-panel"].open = false;
    }
    clearReviewEditor();
    await restoreSubmissionDraft();
    await Promise.all([
      loadStudentData(),
      loadCurrentSubmissionImages(),
      loadStudentCalendarData(),
      loadTeacherData(),
      loadTeacherCalendarData(),
      loadTeacherReflections(),
      loadTranslationPromptCatalog(),
      loadMyTranslationAttempts(),
      loadTeacherTranslationAttempts(),
    ]);
  }
}

async function loadProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    showAlert(`读取用户列表失败: ${error.message}`, "error");
    return false;
  }

  allProfiles = new Map();
  for (const row of data ?? []) {
    allProfiles.set(row.id, row);
  }

  await ensureProfile();
  return true;
}

function refreshRoleUi() {
  const users = [...allProfiles.values()];
  const teacherCount = users.filter((x) => x.role === "teacher").length;
  const isTeacher = currentProfile.role === "teacher";
  const isReviewer = currentProfile.role === "teacher" || currentProfile.role === "teammate";

  ui["claim-teacher-btn"].classList.toggle(
    "hidden",
    !(currentProfile.role === "student" && teacherCount === 0)
  );
  ui["claim-admin-btn"].classList.toggle(
    "hidden",
    !(currentProfile.role === "teacher" && !currentProfile.is_admin)
  );

  if (isTeacher) {
    renderRoleTargets(users);
    renderIdentityTargets(users);
    loadIdentityFromSelection();
  } else {
    ui["role-target-user"].innerHTML = "";
    ui["identity-target-user"].innerHTML = "";
    ui["identity-display-name"].value = "";
    ui["identity-email"].textContent = "注册邮箱：-";
  }

  if (isReviewer) {
    renderReflectionStudentOptions(users);
    renderTeacherCalendarStudentOptions(users);
    renderTranslationTeacherStudentOptions(users);
  } else {
    ui["calendar-student"].innerHTML = "";
  }
}

function renderRoleTargets(users) {
  const select = ui["role-target-user"];
  select.innerHTML = "";

  for (const user of users) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = `${describeUser(user)} (${user.role}${user.is_admin ? "/admin" : ""})`;
    select.appendChild(option);
  }
}

function renderIdentityTargets(users) {
  const select = ui["identity-target-user"];
  const current = select.value;
  select.innerHTML = "";

  const students = users.filter((x) => x.role === "student");
  if (!students.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无学生";
    select.appendChild(option);
    return;
  }

  for (const user of students) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = describeUser(user);
    select.appendChild(option);
  }

  if ([...select.options].some((x) => x.value === current)) {
    select.value = current;
  }
}

function renderReflectionStudentOptions(users) {
  const select = ui["reflection-filter-student"];
  const current = select.value || "all";

  select.innerHTML = "<option value=\"all\">全部同学</option>";
  for (const user of users) {
    if (user.role === "teacher") {
      continue;
    }
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = describeUser(user);
    select.appendChild(option);
  }

  if ([...select.options].some((x) => x.value === current)) {
    select.value = current;
  }
}

function renderTranslationTeacherStudentOptions(users) {
  const select = ui["translation-teacher-student"];
  if (!select) {
    return;
  }
  const current = select.value || "all";

  select.innerHTML = "<option value=\"all\">全部同学</option>";
  for (const user of users) {
    if (user.role === "teacher") {
      continue;
    }
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = describeUser(user);
    select.appendChild(option);
  }

  if ([...select.options].some((x) => x.value === current)) {
    select.value = current;
  }
}

function loadIdentityFromSelection() {
  const userId = ui["identity-target-user"].value;
  const profile = allProfiles.get(userId);
  if (!profile) {
    ui["identity-display-name"].value = "";
    ui["identity-email"].textContent = "注册邮箱：-";
    return;
  }

  ui["identity-display-name"].value = profile.full_name ?? "";
  ui["identity-email"].textContent = `注册邮箱：${profile.login_email || "未同步"}`;
}

async function setUserRole() {
  const targetUser = ui["role-target-user"].value;
  const targetRole = ui["role-target-value"].value;

  if (!targetUser || !targetRole) {
    showAlert("请选择用户和角色。", "error");
    return;
  }

  if (!confirmAction("确认修改该账号角色？")) {
    return;
  }

  await withButtonBusy(ui["set-role-btn"], "保存中...", async () => {
    const { error } = await supabase.rpc("set_user_role", {
      p_user: targetUser,
      p_role: targetRole,
    });

    if (error) {
      throw error;
    }

    showAlert("角色更新成功。", "info");
    await loadProfiles();
    await refreshData();
  }).catch((error) => {
    showAlert(`设置角色失败: ${error.message}`, "error");
  });
}

async function saveIdentityLabel() {
  const targetUser = ui["identity-target-user"].value;
  const fullName = ui["identity-display-name"].value.trim();

  if (!targetUser) {
    showAlert("请先选择学生账号。", "error");
    return;
  }

  await withButtonBusy(ui["save-identity-btn"], "保存中...", async () => {
    const { error } = await withTimeout(
      supabase.rpc("set_profile_label", {
        p_user: targetUser,
        p_full_name: fullName,
      }),
      18000,
      "保存身份标识超时"
    );

    if (error) {
      throw error;
    }

    showAlert("身份标识已保存。", "info", 2400, true);
    await loadProfiles();
    loadIdentityFromSelection();
  }).catch((error) => {
    showAlert(`保存身份标识失败: ${error.message}`, "error");
  });
}

async function setIdentityToEmail() {
  const targetUser = ui["identity-target-user"].value;
  const profile = allProfiles.get(targetUser);
  if (!profile) {
    showAlert("请先选择学生账号。", "error");
    return;
  }

  if (!profile.login_email) {
    showAlert("该账号尚未同步邮箱，请先执行最新 schema.sql。", "error", 5200, true);
    return;
  }

  ui["identity-display-name"].value = profile.login_email;
  await saveIdentityLabel();
}

function initAiConfigUi() {
  const endpoint = localStorage.getItem("cet4_ai_endpoint")
    || window.AI_REVIEW_API_URL
    || "https://api.openai.com/v1/chat/completions";
  const model = localStorage.getItem("cet4_ai_model")
    || window.AI_REVIEW_MODEL
    || "gpt-4o-mini";
  const visionModel = localStorage.getItem("cet4_ai_vision_model")
    || window.AI_REVIEW_VISION_MODEL
    || model;
  const key = localStorage.getItem("cet4_ai_key")
    || window.AI_REVIEW_API_KEY
    || "";

  ui["ai-endpoint"].value = endpoint;
  ui["ai-model"].value = model;
  ui["ai-vision-model"].value = visionModel;
  ui["ai-key"].value = key;
  ui["essay-result"].textContent = "暂无批改结果。";
  if (ui["translation-result"]) {
    ui["translation-result"].textContent = "暂无翻译批改结果。";
  }
}

function readAiConfig() {
  return {
    endpoint: ui["ai-endpoint"].value.trim(),
    model: ui["ai-model"].value.trim(),
    visionModel: ui["ai-vision-model"].value.trim(),
    apiKey: ui["ai-key"].value.trim(),
  };
}

function validateAiConfig(config) {
  if (!config.endpoint) {
    throw new Error("请填写 AI Endpoint。");
  }
  if (!config.model) {
    throw new Error("请填写 AI Model。");
  }
  if (!config.visionModel) {
    throw new Error("请填写 Vision Model。");
  }
  if (!config.apiKey) {
    throw new Error("请填写 AI API Key。");
  }
}

function saveAiConfig() {
  const config = readAiConfig();
  try {
    validateAiConfig(config);
  } catch (error) {
    showAlert(error.message, "error");
    return;
  }

  localStorage.setItem("cet4_ai_endpoint", config.endpoint);
  localStorage.setItem("cet4_ai_model", config.model);
  localStorage.setItem("cet4_ai_vision_model", config.visionModel);
  localStorage.setItem("cet4_ai_key", config.apiKey);
  showAlert("AI 配置已保存。", "info", 2200, true);
}

async function testAiConnection() {
  await withButtonBusy(ui["ai-test-btn"], "测试中...", async () => {
    const config = readAiConfig();
    validateAiConfig(config);

    const text = await callAiChat(
      [
        { role: "system", content: "你是一个简洁的英语学习助手。" },
        { role: "user", content: "只返回“连接成功”四个字。" },
      ],
      30000
    );

    if (!text.includes("连接成功")) {
      throw new Error("API 已响应，但返回格式异常。");
    }

    showAlert("AI 接口连接成功。", "info", 2600, true);
  }).catch((error) => {
    showAlert(`AI 接口测试失败: ${error.message}`, "error", 6500, true);
  });
}

function clearEssayDraft() {
  ui["essay-topic"].value = "";
  ui["essay-goal"].value = "";
  ui["essay-content"].value = "";
  ui["essay-result"].textContent = "暂无批改结果。";
  clearEssayPendingImages();
  essayChatHistory = [];
  renderEssayChatLog();
}

async function reviewEssayWithAi() {
  await withButtonBusy(ui["essay-review-btn"], "批改中...", async () => {
    const topic = ui["essay-topic"].value.trim();
    const goal = ui["essay-goal"].value.trim();
    let essay = ui["essay-content"].value.trim();

    if ((!essay || essay.length < 30) && essayPendingImages.length > 0) {
      essay = await extractEssayTextFromImages();
      ui["essay-content"].value = essay;
      showAlert("已先完成图片识别，再进入作文批改。", "info", 2600, true);
    }

    if (!essay || essay.length < 30) {
      throw new Error("作文内容太短。请粘贴正文，或上传手写图片后先识别。");
    }

    const systemPrompt = [
      "你是大学英语四级写作批改老师。",
      "请严格按以下结构输出：",
      "1) 总评（2-4句）",
      "2) 预估四级写作分（0-15）+理由",
      "3) 语法错误清单（逐条：原句片段 -> 问题 -> 修改建议）",
      "4) 词汇与句式优化（至少5条）",
      "5) 一版可直接背诵的改写范文（120-180词）",
      "6) 3个明天就能执行的训练动作",
      "请直接输出中文说明，范文用英文。",
    ].join("\n");

    const userPrompt = [
      `题目: ${topic || "未提供"}`,
      `目标: ${goal || "提升四级写作得分"}`,
      "作文正文:",
      essay,
    ].join("\n");

    const result = await callAiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      70000
    );

    ui["essay-result"].textContent = result;

    essayChatHistory = [
      { role: "system", content: "你是CET-4写作老师。基于前面的作文批改继续回答学生追问。" },
      { role: "user", content: userPrompt },
      { role: "assistant", content: result },
    ];
    renderEssayChatLog();
    showAlert("作文批改完成。", "info", 2800, true);
  }).catch((error) => {
    showAlert(`作文批改失败: ${error.message}`, "error", 7200, true);
  });
}

async function sendEssayChat() {
  const input = ui["essay-chat-input"];
  const text = input.value.trim();
  if (!text) {
    return;
  }

  await withButtonBusy(ui["essay-chat-send-btn"], "发送中...", async () => {
    if (!essayChatHistory.length) {
      const seed = ui["essay-content"].value.trim();
      if (!seed) {
        throw new Error("请先填写作文或先做一次 AI 批改。");
      }
      essayChatHistory = [
        { role: "system", content: "你是CET-4写作老师，回答要简洁、可执行。" },
        { role: "user", content: `这是我的作文：\n${seed}` },
      ];
    }

    essayChatHistory.push({ role: "user", content: text });
    const reply = await callAiChat(essayChatHistory.slice(-16), 60000);
    essayChatHistory.push({ role: "assistant", content: reply });
    input.value = "";
    renderEssayChatLog();
  }).catch((error) => {
    showAlert(`发送失败: ${error.message}`, "error", 6200, true);
  });
}

function renderEssayChatLog() {
  const box = ui["essay-chat-log"];
  if (!box) {
    return;
  }
  box.innerHTML = "";

  const items = essayChatHistory.filter((x) => x.role === "user" || x.role === "assistant");
  if (!items.length) {
    box.innerHTML = "<p class=\"muted\">还没有聊天记录，先点一次“AI 批改作文”。</p>";
    return;
  }

  for (const row of items.slice(-14)) {
    const div = document.createElement("div");
    div.className = `chat-item ${row.role}`;
    div.innerHTML = `<strong>${row.role === "user" ? "你" : "AI老师"}：</strong>${escapeHtml(row.content)}`;
    box.appendChild(div);
  }

  box.scrollTop = box.scrollHeight;
}

async function callAiChat(messages, timeoutMs = 45000, modelOverride = "") {
  const config = readAiConfig();
  validateAiConfig(config);
  const targetModel = (modelOverride || config.model).trim();

  const response = await withTimeout(
    fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: targetModel,
        messages,
        temperature: 0.25,
      }),
    }),
    timeoutMs,
    "AI 接口请求超时"
  );

  let payload = null;
  let rawText = "";
  try {
    payload = await response.json();
  } catch (_error) {
    try {
      rawText = await response.text();
    } catch (_ignored) {
      rawText = "";
    }
  }

  if (!response.ok) {
    const reason = extractAiError(payload) || rawText || `${response.status} ${response.statusText}`;
    throw new Error(reason);
  }

  const text = payload?.choices?.[0]?.message?.content
    || payload?.output_text
    || payload?.data?.[0]?.output_text
    || "";

  if (!text) {
    throw new Error("AI 返回内容为空。");
  }

  return String(text).trim();
}

function extractAiError(payload) {
  if (!payload) {
    return "";
  }
  return payload?.error?.message
    || payload?.message
    || payload?.error
    || "";
}

function onPickEssayImages(event) {
  const picked = Array.from(event.target.files ?? []);
  appendEssayImageFiles(picked);
}

function appendEssayImageFiles(picked) {
  if (!picked.length) {
    return;
  }

  for (const file of picked) {
    if (!file.type.startsWith("image/")) {
      showAlert(`已跳过非图片: ${file.name}`, "error");
      continue;
    }
    if (file.size > MAX_ESSAY_IMAGE_SIZE) {
      showAlert(`图片超过 ${Math.floor(MAX_ESSAY_IMAGE_SIZE / 1024 / 1024)}MB: ${file.name}`, "error");
      continue;
    }
    if (essayPendingImages.length >= MAX_ESSAY_IMAGE_COUNT) {
      showAlert(`作文图片最多 ${MAX_ESSAY_IMAGE_COUNT} 张。`, "error");
      break;
    }

    essayPendingImages.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    });
  }

  ui["essay-images"].value = "";
  renderEssayPendingImages();
}

function removeEssayImage(imageId) {
  const idx = essayPendingImages.findIndex((x) => x.id === imageId);
  if (idx < 0) {
    return;
  }
  URL.revokeObjectURL(essayPendingImages[idx].previewUrl);
  essayPendingImages.splice(idx, 1);
  renderEssayPendingImages();
}

function clearEssayPendingImages() {
  for (const item of essayPendingImages) {
    URL.revokeObjectURL(item.previewUrl);
  }
  essayPendingImages = [];
  if (ui["essay-images"]) {
    ui["essay-images"].value = "";
  }
  renderEssayPendingImages();
}

function renderEssayPendingImages() {
  const holder = ui["essay-pending-images"];
  if (!holder) {
    return;
  }
  if (!essayPendingImages.length) {
    holder.innerHTML = "<span class=\"muted\">暂无作文图片</span>";
    return;
  }

  holder.innerHTML = essayPendingImages
    .map((item) => {
      const src = escapeAttr(item.previewUrl);
      return `<div class="thumb-edit">
        <img class="thumb-img" src="${src}" alt="essay-img" />
        <button type="button" class="thumb-remove-btn" data-remove-essay-id="${item.id}" title="删除">×</button>
      </div>`;
    })
    .join("");
}

async function runEssayOcrOnly() {
  await withButtonBusy(ui["essay-ocr-btn"], "识别中...", async () => {
    const text = await extractEssayTextFromImages();
    if (!text || text.length < 20) {
      throw new Error("识别结果过短，请重拍清晰图片。");
    }
    ui["essay-content"].value = text;
    showAlert("图片作文识别完成，已填入正文。", "info", 2800, true);
  }).catch((error) => {
    showAlert(`图片识别失败: ${error.message}`, "error", 6800, true);
  });
}

async function extractEssayTextFromImages() {
  if (!essayPendingImages.length) {
    throw new Error("请先上传作文图片。");
  }

  const config = readAiConfig();
  validateAiConfig(config);

  const dataUrls = [];
  for (const item of essayPendingImages) {
    const prepared = await prepareImageForUpload(item.file);
    const dataUrl = await fileToDataUrl(prepared);
    dataUrls.push(dataUrl);
  }

  const userContent = [
    {
      type: "text",
      text: "请从这些手写英语作文图片中提取完整英文正文。仅输出提取后的英文作文，不要解释，不要加序号。",
    },
    ...dataUrls.map((url) => ({
      type: "image_url",
      image_url: { url },
    })),
  ];

  try {
    return await callAiChat(
      [
        {
          role: "system",
          content: "你是英语作文OCR助手，严格提取图片文字并输出纯正文。",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      90000,
      config.visionModel
    );
  } catch (error) {
    const msg = String(error?.message || "");
    if (!msg.includes("image_url")) {
      throw error;
    }

    // Fallback for providers that accept image_url as plain string.
    const fallbackContent = [
      {
        type: "text",
        text: "请从这些手写英语作文图片中提取完整英文正文。仅输出提取后的英文作文，不要解释，不要加序号。",
      },
      ...dataUrls.map((url) => ({
        type: "image_url",
        image_url: url,
      })),
    ];

    return await callAiChat(
      [
        {
          role: "system",
          content: "你是英语作文OCR助手，严格提取图片文字并输出纯正文。",
        },
        {
          role: "user",
          content: fallbackContent,
        },
      ],
      90000,
      config.visionModel
    );
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function resetTranslationState() {
  clearTranslationPendingImages();
  translationPromptCache = [];
  myTranslationAttemptCache = [];
  teacherTranslationAttemptCache = [];
  myTranslationReviewMap = new Map();
  teacherTranslationReviewMap = new Map();
  selectedTranslationAttemptId = null;
  latestTranslationOcrText = "";
  if (ui["translation-mode"]) {
    ui["translation-mode"].value = "corpus";
  }
  if (ui["translation-year-filter"]) {
    ui["translation-year-filter"].innerHTML = "<option value=\"all\">全部批次</option>";
  }
  if (ui["translation-paper-filter"]) {
    ui["translation-paper-filter"].innerHTML = "<option value=\"all\">全部套数</option>";
  }
  if (ui["translation-prompt-select"]) {
    ui["translation-prompt-select"].innerHTML = "<option value=\"\">暂无真题题库</option>";
  }
  if (ui["translation-source"]) {
    ui["translation-source"].value = "";
  }
  if (ui["translation-reference"]) {
    ui["translation-reference"].value = "";
    ui["translation-reference"].placeholder = "题库模式自动填充；自定义模式可不填。";
  }
  if (ui["translation-student-text"]) {
    ui["translation-student-text"].value = "";
  }
  if (ui["translation-result"]) {
    ui["translation-result"].textContent = "暂无翻译批改结果。";
  }
  onTranslationModeChanged();
  renderMyTranslationHistory();
  renderTeacherTranslationList();
  resetTeacherTranslationEditor();
}

function clearTranslationDraft(resetPrompt = true) {
  clearTranslationPendingImages();
  latestTranslationOcrText = "";
  if (ui["translation-student-text"]) {
    ui["translation-student-text"].value = "";
  }
  if (ui["translation-result"]) {
    ui["translation-result"].textContent = "暂无翻译批改结果。";
  }
  if (!resetPrompt) {
    return;
  }

  if (ui["translation-mode"]) {
    ui["translation-mode"].value = "corpus";
  }
  onTranslationModeChanged();
  applySelectedTranslationPrompt();
}

function resetTeacherTranslationEditor() {
  selectedTranslationAttemptId = null;
  if (ui["translation-review-target"]) {
    ui["translation-review-target"].textContent = "当前未选择翻译作答";
  }
  if (ui["translation-review-score"]) {
    ui["translation-review-score"].value = 80;
  }
  if (ui["translation-review-comment"]) {
    ui["translation-review-comment"].value = "";
  }
}

async function loadTranslationPromptCatalog(force = false) {
  if (!force && translationPromptCache.length > 0) {
    renderTranslationPromptSelect();
    return translationPromptCache;
  }

  const { data, error } = await supabase
    .from("translation_prompts")
    .select("*")
    .order("year", { ascending: false })
    .order("paper_code", { ascending: false })
    .order("prompt_no", { ascending: true })
    .limit(300);

  if (error) {
    showAlert(`读取翻译题库失败: ${error.message}`, "error", 6400, true);
    translationPromptCache = [];
    renderTranslationPromptSelect();
    return [];
  }

  translationPromptCache = data ?? [];
  renderTranslationPromptSelect();
  return translationPromptCache;
}

function renderTranslationPromptSelect() {
  const select = ui["translation-prompt-select"];
  if (!select) {
    return;
  }
  renderTranslationPromptFilters();

  const current = select.value;
  select.innerHTML = "";

  if (!translationPromptCache.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无真题题库，可先切换到自定义题目";
    select.appendChild(option);
    onTranslationModeChanged();
    return;
  }

  const activeExam = ui["translation-year-filter"]?.value || "all";
  const activeSet = ui["translation-paper-filter"]?.value || "all";
  const filtered = translationPromptCache.filter((prompt) => {
    const info = parsePromptPaperInfo(prompt);
    if (activeExam !== "all" && info.examKey !== activeExam) {
      return false;
    }
    if (activeSet !== "all" && info.setKey !== activeSet) {
      return false;
    }
    return true;
  });

  if (!filtered.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "当前筛选下暂无题目";
    select.appendChild(option);
    onTranslationModeChanged();
    applySelectedTranslationPrompt();
    return;
  }

  for (const prompt of filtered) {
    const option = document.createElement("option");
    option.value = prompt.id;
    option.textContent = formatTranslationPromptLabel(prompt);
    select.appendChild(option);
  }

  if ([...select.options].some((x) => x.value === current)) {
    select.value = current;
  }

  onTranslationModeChanged();
  applySelectedTranslationPrompt();
}

function onTranslationModeChanged() {
  const mode = ui["translation-mode"]?.value || "corpus";
  const isCorpus = mode === "corpus";
  const hasCorpus = translationPromptCache.length > 0;
  if (ui["translation-year-filter"]) {
    ui["translation-year-filter"].disabled = !isCorpus || !hasCorpus;
  }
  if (ui["translation-paper-filter"]) {
    ui["translation-paper-filter"].disabled = !isCorpus || !hasCorpus;
  }
  if (ui["translation-prompt-select"]) {
    ui["translation-prompt-select"].disabled = !isCorpus || !hasCorpus;
  }
  if (!isCorpus && ui["translation-reference"]) {
    ui["translation-reference"].placeholder = "题库模式自动填充；自定义模式可不填。";
  }
}

function applySelectedTranslationPrompt() {
  const mode = ui["translation-mode"]?.value || "corpus";
  if (mode !== "corpus") {
    return null;
  }

  const promptId = ui["translation-prompt-select"]?.value;
  if (!promptId) {
    return null;
  }

  const prompt = translationPromptCache.find((x) => x.id === promptId);
  if (!prompt) {
    return null;
  }

  if (ui["translation-source"]) {
    ui["translation-source"].value = prompt.source_text || "";
  }
  if (ui["translation-reference"]) {
    ui["translation-reference"].value = prompt.reference_text || "";
    ui["translation-reference"].placeholder = prompt.reference_text
      ? "题库模式自动填充；自定义模式可不填。"
      : "该题暂无参考译文，将按语义准确度与语言质量进行批改。";
  }
  return prompt;
}

function formatTranslationPromptLabel(prompt) {
  const info = parsePromptPaperInfo(prompt);
  const pieces = [];
  pieces.push(info.examLabel);
  pieces.push(info.setLabel);
  if (prompt.prompt_no) {
    pieces.push(`第${prompt.prompt_no}题`);
  }
  if (prompt.title) {
    pieces.push(String(prompt.title));
  }
  return pieces.join(" · ") || "真题题目";
}

function renderTranslationPromptFilters() {
  const examSelect = ui["translation-year-filter"];
  const setSelect = ui["translation-paper-filter"];
  if (!examSelect || !setSelect) {
    return;
  }

  const prevExam = examSelect.value || "all";
  const prevSet = setSelect.value || "all";

  const examMap = new Map();
  for (const prompt of translationPromptCache) {
    const info = parsePromptPaperInfo(prompt);
    examMap.set(info.examKey, info.examLabel);
  }

  examSelect.innerHTML = "<option value=\"all\">全部批次</option>";
  const examEntries = [...examMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  for (const [key, label] of examEntries) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = label;
    examSelect.appendChild(option);
  }
  examSelect.value = examEntries.some(([key]) => key === prevExam) ? prevExam : "all";

  const activeExam = examSelect.value || "all";
  const setMap = new Map();
  for (const prompt of translationPromptCache) {
    const info = parsePromptPaperInfo(prompt);
    if (activeExam !== "all" && info.examKey !== activeExam) {
      continue;
    }
    setMap.set(info.setKey, info.setLabel);
  }

  setSelect.innerHTML = "<option value=\"all\">全部套数</option>";
  const setEntries = [...setMap.entries()].sort((a, b) => comparePromptSetKey(a[0], b[0]));
  for (const [key, label] of setEntries) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = label;
    setSelect.appendChild(option);
  }
  setSelect.value = setEntries.some(([key]) => key === prevSet) ? prevSet : "all";
}

function comparePromptSetKey(a, b) {
  const na = Number.parseInt(String(a).replace(/[^0-9]/g, ""), 10);
  const nb = Number.parseInt(String(b).replace(/[^0-9]/g, ""), 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
    return na - nb;
  }
  return String(a).localeCompare(String(b));
}

function parsePromptPaperInfo(prompt) {
  const fallbackYear = prompt?.year ? String(prompt.year) : "未分组";
  const rawCode = String(prompt?.paper_code ?? "").trim();
  const normalized = rawCode.toUpperCase();
  const matched = normalized.match(/^(\d{4})-(\d{2})-S(\d+)$/);
  if (matched) {
    const year = matched[1];
    const month = matched[2];
    const setNo = Number.parseInt(matched[3], 10) || 1;
    return {
      examKey: `${year}-${month}`,
      examLabel: `${year}年${Number.parseInt(month, 10)}月`,
      setKey: `S${setNo}`,
      setLabel: `第${setNo}套`,
    };
  }
  return {
    examKey: fallbackYear,
    examLabel: prompt?.year ? `${fallbackYear}年` : "未分组",
    setKey: rawCode || "default",
    setLabel: rawCode || "默认套数",
  };
}

function onPickTranslationImages(event) {
  const picked = Array.from(event.target.files ?? []);
  appendTranslationImageFiles(picked);
}

function appendTranslationImageFiles(picked) {
  if (!picked.length) {
    return;
  }
  latestTranslationOcrText = "";

  for (const file of picked) {
    if (!file.type.startsWith("image/")) {
      showAlert(`已跳过非图片: ${file.name}`, "error");
      continue;
    }
    if (file.size > MAX_TRANSLATION_IMAGE_SIZE) {
      showAlert(`图片超过 ${Math.floor(MAX_TRANSLATION_IMAGE_SIZE / 1024 / 1024)}MB: ${file.name}`, "error");
      continue;
    }
    if (translationPendingImages.length >= MAX_TRANSLATION_IMAGE_COUNT) {
      showAlert(`翻译图片最多 ${MAX_TRANSLATION_IMAGE_COUNT} 张。`, "error");
      break;
    }

    translationPendingImages.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    });
  }

  ui["translation-images"].value = "";
  renderTranslationPendingImages();
}

function removeTranslationImage(imageId) {
  const idx = translationPendingImages.findIndex((x) => x.id === imageId);
  if (idx < 0) {
    return;
  }
  URL.revokeObjectURL(translationPendingImages[idx].previewUrl);
  translationPendingImages.splice(idx, 1);
  renderTranslationPendingImages();
}

function clearTranslationPendingImages() {
  for (const item of translationPendingImages) {
    URL.revokeObjectURL(item.previewUrl);
  }
  translationPendingImages = [];
  if (ui["translation-images"]) {
    ui["translation-images"].value = "";
  }
  renderTranslationPendingImages();
}

function renderTranslationPendingImages() {
  const holder = ui["translation-pending-images"];
  if (!holder) {
    return;
  }
  if (!translationPendingImages.length) {
    holder.innerHTML = "<span class=\"muted\">暂无翻译图片</span>";
    return;
  }

  holder.innerHTML = translationPendingImages
    .map((item) => {
      const src = escapeAttr(item.previewUrl);
      return `<div class="thumb-edit">
        <img class="thumb-img" src="${src}" alt="translation-img" />
        <button type="button" class="thumb-remove-btn" data-remove-translation-id="${item.id}" title="删除">×</button>
      </div>`;
    })
    .join("");
}

async function runTranslationOcrOnly() {
  await withButtonBusy(ui["translation-ocr-btn"], "识别中...", async () => {
    const text = await extractTranslationTextFromImages();
    if (!text || text.length < 8) {
      throw new Error("识别结果过短，请重拍清晰图片。");
    }
    latestTranslationOcrText = text;
    ui["translation-student-text"].value = text;
    showAlert("手写译文识别完成，已填入文本框。", "info", 2800, true);
  }).catch((error) => {
    showAlert(`翻译图片识别失败: ${error.message}`, "error", 6800, true);
  });
}

async function extractTranslationTextFromImages() {
  if (!translationPendingImages.length) {
    throw new Error("请先上传翻译手写图片。");
  }

  const config = readAiConfig();
  validateAiConfig(config);

  const dataUrls = [];
  for (const item of translationPendingImages) {
    const prepared = await prepareImageForUpload(item.file);
    const dataUrl = await fileToDataUrl(prepared);
    dataUrls.push(dataUrl);
  }

  const userContent = [
    {
      type: "text",
      text: "请从这些手写英语翻译作答图片中提取完整英文译文。仅输出英文译文，不要解释，不要编号。",
    },
    ...dataUrls.map((url) => ({
      type: "image_url",
      image_url: { url },
    })),
  ];

  try {
    return await callAiChat(
      [
        {
          role: "system",
          content: "你是英语翻译OCR助手，严格提取图片中的英文译文正文。",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      90000,
      config.visionModel
    );
  } catch (error) {
    const msg = String(error?.message || "");
    if (!msg.includes("image_url")) {
      throw error;
    }

    const fallbackContent = [
      {
        type: "text",
        text: "请从这些手写英语翻译作答图片中提取完整英文译文。仅输出英文译文，不要解释，不要编号。",
      },
      ...dataUrls.map((url) => ({
        type: "image_url",
        image_url: url,
      })),
    ];

    return await callAiChat(
      [
        {
          role: "system",
          content: "你是英语翻译OCR助手，严格提取图片中的英文译文正文。",
        },
        {
          role: "user",
          content: fallbackContent,
        },
      ],
      90000,
      config.visionModel
    );
  }
}

async function reviewTranslationWithAi() {
  await withButtonBusy(ui["translation-review-btn"], "批改中...", async () => {
    await loadTranslationPromptCatalog();

    const mode = ui["translation-mode"].value;
    const prompt = mode === "corpus" ? applySelectedTranslationPrompt() : null;
    const promptId = mode === "corpus" ? prompt?.id ?? null : null;
    const source = ui["translation-source"].value.trim();
    const reference = ui["translation-reference"].value.trim();
    let studentText = ui["translation-student-text"].value.trim();
    let ocrText = latestTranslationOcrText;

    if ((!studentText || studentText.length < 8) && translationPendingImages.length > 0) {
      ocrText = await extractTranslationTextFromImages();
      latestTranslationOcrText = ocrText;
      studentText = ocrText.trim();
      ui["translation-student-text"].value = studentText;
      showAlert("已先完成手写识别，再进入翻译批改。", "info", 2600, true);
    }

    if (!source) {
      throw new Error("请先填写中文原文，或在题库模式中选择题目。");
    }

    if (!studentText || studentText.length < 8) {
      throw new Error("翻译内容太短，请先输入或先识别手写图片。");
    }

    const label = prompt ? formatTranslationPromptLabel(prompt) : "自定义题目";
    const { systemPrompt, userPrompt } = buildTranslationReviewPrompts({
      mode,
      promptLabel: label,
      source,
      reference,
      studentText,
    });

    const rawResult = await callAiChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      70000
    );

    const parsed = parseAiJsonObject(rawResult);
    const displayText = formatTranslationReviewForDisplay(parsed, rawResult);
    ui["translation-result"].textContent = displayText;

    const score = normalizeTranslationScore(parsed);
    const aiFeedback = parsed || { raw_text: rawResult };

    const { error: saveError } = await withTimeout(
      supabase.from("translation_attempts").insert({
        student_id: currentSession.user.id,
        prompt_id: promptId,
        source_text: source,
        reference_text: reference,
        student_text: ui["translation-student-text"].value.trim(),
        ocr_text: ocrText,
        final_text: studentText,
        ai_score: score,
        ai_feedback: aiFeedback,
      }),
      22000,
      "保存翻译批改记录超时"
    );

    if (saveError) {
      throw saveError;
    }

    await loadMyTranslationAttempts(true);
    if (currentProfile.role === "teacher" || currentProfile.role === "teammate") {
      await loadTeacherTranslationAttempts();
    }
    showAlert("翻译批改完成，已保存到记录。", "info", 3200, true);
  }).catch((error) => {
    showAlert(`翻译批改失败: ${error.message}`, "error", 7200, true);
  });
}

function buildTranslationReviewPrompts({ mode, promptLabel, source, reference, studentText }) {
  const systemPrompt = [
    "你是大学英语四级翻译批改老师。",
    "请按 source/reference/student 三者严格对照批改。",
    "你必须只返回 JSON，不要 Markdown，不要额外解释。",
    "输出 JSON 字段固定为：",
    "{",
    "  \"overall_score\": number,",
    "  \"cet4_score_15\": number,",
    "  \"summary\": string,",
    "  \"major_issues\": string[],",
    "  \"sentence_feedback\": [{\"issue\":\"\", \"suggestion\":\"\", \"reason\":\"\"}],",
    "  \"improved_translation\": string,",
    "  \"action_plan\": string[]",
    "}",
    "评分规则：忠实准确40%，英语表达30%，语法与拼写20%，连贯性10%。",
  ].join("\n");

  const userPrompt = [
    `模式: ${mode === "corpus" ? "题库真题对照" : "自定义题目批改"}`,
    `题目标识: ${promptLabel}`,
    "中文原文:",
    source,
    "参考译文:",
    reference || "（无参考译文，按语义完整与英语地道程度评估）",
    "学生译文:",
    studentText,
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}

function parseAiJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  const direct = tryParseJson(raw);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }

  const fenced = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const fencedObj = tryParseJson(fenced);
  if (fencedObj && typeof fencedObj === "object" && !Array.isArray(fencedObj)) {
    return fencedObj;
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = raw.slice(start, end + 1);
    const obj = tryParseJson(candidate);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return obj;
    }
  }

  return null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function normalizeTranslationScore(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const overall = Number(parsed.overall_score);
  if (Number.isFinite(overall) && overall >= 0 && overall <= 100) {
    return Number(overall.toFixed(2));
  }

  const cet4 = Number(parsed.cet4_score_15);
  if (Number.isFinite(cet4) && cet4 >= 0 && cet4 <= 15) {
    return Number(((cet4 / 15) * 100).toFixed(2));
  }

  return null;
}

function formatTranslationReviewForDisplay(parsed, rawText) {
  if (!parsed || typeof parsed !== "object") {
    return String(rawText || "").trim();
  }

  const lines = [];
  const overall = parsed.overall_score ?? "-";
  const cet4 = parsed.cet4_score_15 ?? "-";
  lines.push(`总分（100）: ${overall}`);
  lines.push(`四级翻译预估（15）: ${cet4}`);
  if (parsed.summary) {
    lines.push("");
    lines.push("总评:");
    lines.push(String(parsed.summary));
  }

  const issues = Array.isArray(parsed.major_issues) ? parsed.major_issues : [];
  if (issues.length) {
    lines.push("");
    lines.push("主要问题:");
    for (const item of issues.slice(0, 8)) {
      lines.push(`- ${String(item)}`);
    }
  }

  const feedback = Array.isArray(parsed.sentence_feedback) ? parsed.sentence_feedback : [];
  if (feedback.length) {
    lines.push("");
    lines.push("逐条纠错:");
    for (const row of feedback.slice(0, 8)) {
      const issue = row?.issue ? String(row.issue) : "未提供问题描述";
      const suggestion = row?.suggestion ? String(row.suggestion) : "未提供修改建议";
      const reason = row?.reason ? String(row.reason) : "未提供原因";
      lines.push(`- 问题: ${issue}`);
      lines.push(`  建议: ${suggestion}`);
      lines.push(`  原因: ${reason}`);
    }
  }

  if (parsed.improved_translation) {
    lines.push("");
    lines.push("推荐改写:");
    lines.push(String(parsed.improved_translation));
  }

  const actions = Array.isArray(parsed.action_plan) ? parsed.action_plan : [];
  if (actions.length) {
    lines.push("");
    lines.push("明日训练动作:");
    for (const item of actions.slice(0, 5)) {
      lines.push(`- ${String(item)}`);
    }
  }

  return lines.join("\n");
}

async function loadMyTranslationAttempts(forceReloadPrompts = false) {
  if (!currentSession || (currentProfile?.role !== "student" && currentProfile?.role !== "teammate")) {
    return;
  }

  if (forceReloadPrompts) {
    await loadTranslationPromptCatalog(true);
  }

  const { data, error } = await supabase
    .from("translation_attempts")
    .select("*")
    .eq("student_id", currentSession.user.id)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    showAlert(`读取翻译批改记录失败: ${error.message}`, "error", 6500, true);
    return;
  }

  myTranslationAttemptCache = data ?? [];
  myTranslationReviewMap = await loadTranslationReviewMap(myTranslationAttemptCache.map((x) => x.id));
  renderMyTranslationHistory();
}

async function loadTeacherTranslationAttempts() {
  if (!currentSession || !(currentProfile?.role === "teacher" || currentProfile?.role === "teammate")) {
    return;
  }
  if (!translationPromptCache.length) {
    await loadTranslationPromptCatalog();
  }

  const date = ui["translation-teacher-date"]?.value || "";
  const studentId = ui["translation-teacher-student"]?.value || "all";
  let query = supabase
    .from("translation_attempts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(150);

  if (date) {
    const nextDate = nextIsoDate(date);
    query = query.gte("created_at", `${date}T00:00:00`).lt("created_at", `${nextDate}T00:00:00`);
  }
  if (studentId && studentId !== "all") {
    query = query.eq("student_id", studentId);
  }

  const { data, error } = await query;
  if (error) {
    showAlert(`读取翻译作答列表失败: ${error.message}`, "error", 6500, true);
    return;
  }

  teacherTranslationAttemptCache = data ?? [];
  teacherTranslationReviewMap = await loadTranslationReviewMap(teacherTranslationAttemptCache.map((x) => x.id));
  renderTeacherTranslationList();

  if (selectedTranslationAttemptId) {
    const existed = teacherTranslationAttemptCache.some((x) => x.id === selectedTranslationAttemptId);
    if (existed) {
      selectTeacherTranslationAttempt(selectedTranslationAttemptId);
    } else {
      resetTeacherTranslationEditor();
    }
  }
}

async function loadTranslationReviewMap(attemptIds) {
  const map = new Map();
  if (!attemptIds.length) {
    return map;
  }

  const { data, error } = await supabase
    .from("translation_reviews")
    .select("*")
    .in("attempt_id", attemptIds);

  if (error) {
    showAlert(`读取翻译老师复核失败: ${error.message}`, "error", 6200, true);
    return map;
  }

  for (const row of data ?? []) {
    map.set(row.attempt_id, row);
  }
  return map;
}

function renderMyTranslationHistory() {
  const holder = ui["translation-history-list"];
  if (!holder) {
    return;
  }
  holder.innerHTML = "";

  if (!myTranslationAttemptCache.length) {
    holder.innerHTML = "<p class=\"muted\">还没有翻译 AI 批改记录。</p>";
    return;
  }

  for (const row of myTranslationAttemptCache) {
    const review = myTranslationReviewMap.get(row.id);
    const prompt = translationPromptCache.find((x) => x.id === row.prompt_id);
    const title = prompt ? formatTranslationPromptLabel(prompt) : "自定义题目";
    const aiScore = row.ai_score == null ? "-" : Number(row.ai_score).toFixed(1);
    const summary = extractTranslationFeedbackSummary(row.ai_feedback);
    const teacherComment = review?.comment || "暂无老师复核";

    const card = document.createElement("article");
    card.className = "translation-attempt-card";
    card.innerHTML = `
      <div class="translation-attempt-head">
        <strong>${escapeHtml(title)}</strong>
        <span class="status-chip ${review ? "status-passed" : "status-pending"}">${review ? "已复核" : "待复核"}</span>
      </div>
      <p class="translation-attempt-meta">时间：${escapeHtml(formatDateTime(row.created_at))} · AI分：${escapeHtml(aiScore)}</p>
      <p class="translation-attempt-snippet">${escapeHtml(summary)}</p>
      <p class="translation-attempt-meta">老师评语：${escapeHtml(teacherComment)}</p>
    `;
    holder.appendChild(card);
  }
}

function renderTeacherTranslationList() {
  const holder = ui["translation-teacher-list"];
  if (!holder) {
    return;
  }
  holder.innerHTML = "";

  if (!teacherTranslationAttemptCache.length) {
    holder.innerHTML = "<p class=\"muted\">当前筛选下没有翻译作答记录。</p>";
    return;
  }

  for (const row of teacherTranslationAttemptCache) {
    const review = teacherTranslationReviewMap.get(row.id);
    const prompt = translationPromptCache.find((x) => x.id === row.prompt_id);
    const title = prompt ? formatTranslationPromptLabel(prompt) : "自定义题目";
    const aiScore = row.ai_score == null ? "-" : Number(row.ai_score).toFixed(1);
    const summary = extractTranslationFeedbackSummary(row.ai_feedback);
    const card = document.createElement("article");
    card.className = "translation-attempt-card";
    if (row.id === selectedTranslationAttemptId) {
      card.classList.add("active");
    }
    card.innerHTML = `
      <div class="translation-attempt-head">
        <strong>${escapeHtml(displayName(row.student_id))}</strong>
        <span class="status-chip ${review ? "status-passed" : "status-pending"}">${review ? "已复核" : "待复核"}</span>
      </div>
      <p class="translation-attempt-meta">${escapeHtml(title)}</p>
      <p class="translation-attempt-meta">提交：${escapeHtml(formatDateTime(row.created_at))} · AI分：${escapeHtml(aiScore)}</p>
      <p class="translation-attempt-snippet">${escapeHtml(summary)}</p>
      <button class="btn btn-ghost btn-small" type="button" data-translation-attempt-id="${row.id}">选中并复核</button>
    `;
    holder.appendChild(card);
  }
}

function selectTeacherTranslationAttempt(attemptId) {
  selectedTranslationAttemptId = attemptId;
  renderTeacherTranslationList();

  const row = teacherTranslationAttemptCache.find((x) => x.id === attemptId);
  if (!row) {
    resetTeacherTranslationEditor();
    return;
  }

  const prompt = translationPromptCache.find((x) => x.id === row.prompt_id);
  const title = prompt ? formatTranslationPromptLabel(prompt) : "自定义题目";
  const review = teacherTranslationReviewMap.get(row.id);
  const aiScore = row.ai_score == null ? "-" : Number(row.ai_score).toFixed(1);
  const summary = extractTranslationFeedbackSummary(row.ai_feedback);
  ui["translation-review-target"].textContent =
    `当前复核: ${displayName(row.student_id)} · ${title} · AI分 ${aiScore}\n` +
    `译文摘要: ${summary}`;
  ui["translation-review-score"].value = review?.score ?? (row.ai_score == null ? 80 : Math.round(Number(row.ai_score)));
  ui["translation-review-comment"].value = review?.comment ?? "";
}

async function saveTeacherTranslationReview() {
  if (!selectedTranslationAttemptId) {
    showAlert("请先选择一条翻译作答。", "error", 4600, true);
    return;
  }

  const score = Number.parseInt(ui["translation-review-score"].value, 10);
  const comment = ui["translation-review-comment"].value.trim();

  if (!Number.isFinite(score) || score < 0 || score > 100) {
    showAlert("复核分数需在 0-100。", "error", 4600, true);
    return;
  }
  if (!comment) {
    showAlert("请填写老师复核评语。", "error", 4600, true);
    return;
  }

  await withButtonBusy(ui["translation-save-review-btn"], "保存中...", async () => {
    const { error } = await withTimeout(
      supabase.from("translation_reviews").upsert(
        {
          attempt_id: selectedTranslationAttemptId,
          teacher_id: currentSession.user.id,
          score,
          comment,
        },
        { onConflict: "attempt_id" }
      ),
      22000,
      "保存翻译复核超时"
    );

    if (error) {
      throw error;
    }

    showAlert("翻译复核已保存。", "info", 3000, true);
    await loadTeacherTranslationAttempts();
    if (currentProfile.role === "teammate") {
      await loadMyTranslationAttempts();
    }
  }).catch((error) => {
    showAlert(`保存翻译复核失败: ${error.message}`, "error", 6200, true);
  });
}

function extractTranslationFeedbackSummary(aiFeedback) {
  if (!aiFeedback) {
    return "暂无 AI 总评。";
  }
  if (typeof aiFeedback === "string") {
    return aiFeedback.slice(0, 180);
  }
  if (Array.isArray(aiFeedback)) {
    return aiFeedback.map((x) => String(x)).join("；").slice(0, 180);
  }
  if (typeof aiFeedback === "object") {
    const candidates = [
      aiFeedback.summary,
      aiFeedback.overall_comment,
      aiFeedback.overall,
      aiFeedback.raw_text,
    ];
    const picked = candidates.find((x) => typeof x === "string" && x.trim().length > 0);
    if (picked) {
      return picked.trim().slice(0, 200);
    }
  }
  return "已生成批改结果。";
}

function formatDateTime(isoText) {
  if (!isoText) {
    return "-";
  }
  const dt = new Date(isoText);
  if (Number.isNaN(dt.getTime())) {
    return String(isoText);
  }
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function nextIsoDate(isoDate) {
  const base = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) {
    return isoDate;
  }
  base.setDate(base.getDate() + 1);
  return toIsoDate(base);
}

function bindImagePasteZone({ zoneId, pickBtnId, inputId, appendFn, label }) {
  const zone = ui[zoneId];
  const pickBtn = ui[pickBtnId];
  const input = ui[inputId];

  if (pickBtn && input) {
    pickBtn.addEventListener("click", () => input.click());
  }
  if (!zone) {
    return;
  }

  zone.addEventListener("paste", (event) => {
    handlePasteImageEvent(event, appendFn, label);
  });

  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("drag-over");
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    zone.classList.remove("drag-over");
    const dropped = Array.from(event.dataTransfer?.files ?? []).filter((file) => file?.type?.startsWith("image/"));
    if (!dropped.length) {
      return;
    }
    appendFn(dropped);
    showAlert(`已拖拽添加 ${dropped.length} 张${label}。`, "info", 2200, true);
  });

  zone.addEventListener("input", () => {
    zone.value = "";
  });
  zone.addEventListener("keydown", (event) => {
    const key = event.key || "";
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    const allowKeys = new Set([
      "Tab",
      "Shift",
      "Control",
      "Meta",
      "Alt",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "ContextMenu",
      "F10",
    ]);
    if (allowKeys.has(key)) {
      return;
    }
    event.preventDefault();
  });
}

function getClipboardImageFiles(event) {
  const files = [];
  const clipboard = event.clipboardData;
  if (!clipboard) {
    return files;
  }

  const items = Array.from(clipboard.items ?? []);
  for (const item of items) {
    if (!item?.type?.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }

  if (files.length > 0) {
    return files;
  }

  for (const file of Array.from(clipboard.files ?? [])) {
    if (file?.type?.startsWith("image/")) {
      files.push(file);
    }
  }

  return files;
}

function handlePasteImageEvent(event, appendFn, label) {
  const files = getClipboardImageFiles(event);
  if (!files.length) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  appendFn(files);
  showAlert(`已从剪贴板添加 ${files.length} 张${label}。`, "info", 2200, true);
}

async function onPickImages(event) {
  const picked = Array.from(event.target.files ?? []);
  appendStudyImageFiles(picked);
}

function appendStudyImageFiles(picked) {
  if (!picked.length) {
    return;
  }

  for (const file of picked) {
    if (!file.type.startsWith("image/")) {
      showAlert(`已跳过非图片: ${file.name}`, "error");
      continue;
    }

    if (file.size > MAX_RAW_IMAGE_SIZE) {
      showAlert(`图片过大（>${Math.floor(MAX_RAW_IMAGE_SIZE / 1024 / 1024)}MB）: ${file.name}`, "error");
      continue;
    }

    const nowCount = existingImages.length + pendingImages.length;
    if (nowCount >= MAX_IMAGE_COUNT_TOTAL) {
      showAlert(`最多 ${MAX_IMAGE_COUNT_TOTAL} 张图。`, "error");
      break;
    }

    pendingImages.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    });
  }

  ui["study-images"].value = "";
  renderPendingImages();
  scheduleSubmissionDraftSync();
}

async function onStudentSlotChanged() {
  scheduleSubmissionDraftSync();
  await loadCurrentSubmissionImages();
}

function removePendingImage(pendingId) {
  const index = pendingImages.findIndex((x) => x.id === pendingId);
  if (index < 0) {
    return;
  }
  URL.revokeObjectURL(pendingImages[index].previewUrl);
  pendingImages.splice(index, 1);
  renderPendingImages();
  scheduleSubmissionDraftSync();
}

function removeExistingImage(index) {
  if (!existingImages[index]) {
    return;
  }

  if (!confirmAction("删除这张已上传图片？提交后才会真正生效。")) {
    return;
  }

  const target = existingImages[index];
  if (target.storagePath) {
    removedStoragePaths.push(target.storagePath);
  }
  existingImages.splice(index, 1);
  renderExistingImages();
  scheduleSubmissionDraftSync();
}

function renderPendingImages() {
  const holder = ui["pending-images"];
  if (!pendingImages.length) {
    holder.innerHTML = "<span class=\"muted\">暂无待上传图片</span>";
    return;
  }

  holder.innerHTML = pendingImages
    .map((item) => {
      const src = escapeAttr(item.previewUrl);
      return `<div class=\"thumb-edit\">
        <img class=\"thumb-img\" src=\"${src}\" alt=\"pending\" />
        <button type=\"button\" class=\"thumb-remove-btn\" data-remove-pending-id=\"${item.id}\" title=\"删除\">×</button>
      </div>`;
    })
    .join("");
}

function renderExistingImages() {
  const holder = ui["existing-images"];
  if (!existingImages.length) {
    holder.innerHTML = "<span class=\"muted\">当天该模块暂无已上传图片</span>";
    return;
  }

  holder.innerHTML = existingImages
    .map((item, index) => {
      const src = escapeAttr(item.url);
      return `<div class=\"thumb-edit\">
        <a href=\"${src}\" target=\"_blank\" rel=\"noreferrer\">
          <img class=\"thumb-img\" src=\"${src}\" alt=\"existing\" />
        </a>
        <button type=\"button\" class=\"thumb-remove-btn\" data-remove-existing-index=\"${index}\" title=\"删除\">×</button>
      </div>`;
    })
    .join("");
}

function showUploadProgress({ text = "", ratio = 0, meta = "", status = "active" } = {}) {
  const normalized = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const percent = Math.round(normalized * 100);

  const panel = ui["upload-progress-panel"];
  if (panel) {
    panel.classList.remove("hidden");
    if (ui["upload-progress-text"]) {
      ui["upload-progress-text"].textContent = text;
    }
    if (ui["upload-progress-percent"]) {
      ui["upload-progress-percent"].textContent = `${percent}%`;
    }
    if (ui["upload-progress-bar"]) {
      ui["upload-progress-bar"].style.width = `${percent}%`;
    }
    const track = panel.querySelector(".upload-progress-track");
    if (track) {
      track.setAttribute("aria-valuenow", String(percent));
    }
    if (ui["upload-progress-meta"]) {
      ui["upload-progress-meta"].textContent = meta;
    }
  }

  const sticky = ui["upload-sticky-banner"];
  if (sticky) {
    sticky.classList.remove("hidden", "is-success", "is-error");
    sticky.classList.add("show");
    if (status === "success") {
      sticky.classList.add("is-success");
    } else if (status === "error") {
      sticky.classList.add("is-error");
    }

    if (ui["upload-sticky-text"]) {
      ui["upload-sticky-text"].textContent = text;
    }
    if (ui["upload-sticky-percent"]) {
      ui["upload-sticky-percent"].textContent = `${percent}%`;
    }
    if (ui["upload-sticky-bar"]) {
      ui["upload-sticky-bar"].style.width = `${percent}%`;
    }
    const stickyTrack = sticky.querySelector(".upload-sticky-track");
    if (stickyTrack) {
      stickyTrack.setAttribute("aria-valuenow", String(percent));
    }
    if (ui["upload-sticky-meta"]) {
      ui["upload-sticky-meta"].textContent = meta;
    }
  }
}

function hideUploadProgress() {
  const panel = ui["upload-progress-panel"];
  if (panel) {
    panel.classList.add("hidden");
    if (ui["upload-progress-text"]) {
      ui["upload-progress-text"].textContent = "准备上传...";
    }
    if (ui["upload-progress-percent"]) {
      ui["upload-progress-percent"].textContent = "0%";
    }
    if (ui["upload-progress-bar"]) {
      ui["upload-progress-bar"].style.width = "0%";
    }
    const track = panel.querySelector(".upload-progress-track");
    if (track) {
      track.setAttribute("aria-valuenow", "0");
    }
    if (ui["upload-progress-meta"]) {
      ui["upload-progress-meta"].textContent = "系统将先压缩再并发上传。";
    }
  }

  const sticky = ui["upload-sticky-banner"];
  if (sticky) {
    sticky.classList.remove("show", "is-success", "is-error");
    sticky.classList.add("hidden");
    if (ui["upload-sticky-text"]) {
      ui["upload-sticky-text"].textContent = "上传准备中...";
    }
    if (ui["upload-sticky-percent"]) {
      ui["upload-sticky-percent"].textContent = "0%";
    }
    if (ui["upload-sticky-bar"]) {
      ui["upload-sticky-bar"].style.width = "0%";
    }
    const stickyTrack = sticky.querySelector(".upload-sticky-track");
    if (stickyTrack) {
      stickyTrack.setAttribute("aria-valuenow", "0");
    }
    if (ui["upload-sticky-meta"]) {
      ui["upload-sticky-meta"].textContent = "上传进度将在此持续显示。";
    }
  }
}

function renderUploadProgress(event) {
  if (!event) {
    return;
  }

  if (event.phase === "prepare") {
    const total = Math.max(1, event.total || 1);
    const failed = Math.max(0, event.failed || 0);
    const ratio = ((event.done || 0) / total) * 0.35;
    const raw = formatBytes(event.rawBytes || 0);
    const packed = formatBytes(event.preparedBytes || 0);
    showUploadProgress({
      text: `压缩图片 ${Math.min(event.done || 0, total)}/${total}`,
      ratio,
      meta: `压缩体积 ${raw} -> ${packed}（失败 ${failed}）`,
      status: "active",
    });
    return;
  }

  if (event.phase === "prepare-file-failed") {
    const total = Math.max(1, event.total || 1);
    const failed = Math.max(1, event.failed || 1);
    const ratio = Math.min(0.33, ((event.done || 0) / total) * 0.35);
    showUploadProgress({
      text: `图片预处理失败（${failed} 张）`,
      ratio,
      meta: `${event.currentName || "图片"} 预处理失败，将跳过并继续上传其他图片。`,
      status: "active",
    });
    return;
  }

  if (event.phase === "upload-start") {
    const total = Math.max(1, event.total || 1);
    const active = Math.max(1, event.active || 1);
    const failed = Math.max(0, event.failed || 0);
    const ratio = Math.min(0.92, 0.35 + ((event.done || 0) + active * 0.35) / total * 0.58);
    showUploadProgress({
      text: `正在上传 ${Math.min(event.done || 0, total)}/${total}`,
      ratio,
      meta: `进行中 ${active} 张：${event.currentName || "图片"}...（失败 ${failed}）`,
      status: "active",
    });
    return;
  }

  if (event.phase === "retry") {
    const total = Math.max(1, event.total || 1);
    const active = Math.max(1, event.active || 1);
    const ratio = Math.min(0.92, 0.35 + ((event.done || 0) + active * 0.22) / total * 0.58);
    const timeoutSec = Math.max(1, Math.round((event.timeoutMs || UPLOAD_TIMEOUT_MIN_MS) / 1000));
    showUploadProgress({
      text: `网络波动，重试中 ${event.currentName || "图片"}（第 ${event.attempt}/${event.maxAttempts} 次）`,
      ratio,
      meta: `已完成 ${Math.min(event.done || 0, total)}/${total}，单次超时阈值 ${timeoutSec}s。`,
      status: "active",
    });
    return;
  }

  if (event.phase === "retry-compress") {
    const total = Math.max(1, event.total || 1);
    const active = Math.max(1, event.active || 1);
    const ratio = Math.min(0.9, 0.35 + ((event.done || 0) + active * 0.16) / total * 0.58);
    showUploadProgress({
      text: `网络较慢，已自动加强压缩：${event.currentName || "图片"}`,
      ratio,
      meta: `新体积约 ${formatBytes(event.compressedSize || 0)}，继续自动重试上传。`,
      status: "active",
    });
    return;
  }

  if (event.phase === "upload") {
    const total = Math.max(1, event.total || 1);
    const active = Math.max(0, event.active || 0);
    const failed = Math.max(0, event.failed || 0);
    const ratio = Math.min(0.92, 0.35 + ((event.done || 0) + active * 0.2) / total * 0.58);
    const uploaded = formatBytes(event.uploadedBytes || 0);
    const packedTotal = formatBytes(event.preparedBytesTotal || 0);
    const concurrency = Math.max(1, event.concurrency || UPLOAD_CONCURRENCY);
    showUploadProgress({
      text: `上传图片 ${Math.min(event.done || 0, total)}/${total}`,
      ratio,
      meta: `已上传 ${uploaded} / ${packedTotal}（并发 ${concurrency}，失败 ${failed}）`,
      status: "active",
    });
    return;
  }

  if (event.phase === "upload-file-failed") {
    const total = Math.max(1, event.total || 1);
    const active = Math.max(0, event.active || 0);
    const failed = Math.max(1, event.failed || 1);
    const ratio = Math.min(0.92, 0.35 + ((event.done || 0) + active * 0.2) / total * 0.58);
    showUploadProgress({
      text: `部分图片上传失败（${failed} 张）`,
      ratio,
      meta: `${event.currentName || "图片"} 上传失败，系统继续上传其余图片。失败图片会保留供重试。`,
      status: "active",
    });
    return;
  }

  if (event.phase === "done") {
    const raw = formatBytes(event.rawBytes || 0);
    const packed = formatBytes(event.preparedBytesTotal || 0);
    const failed = Math.max(0, event.failed || 0);
    showUploadProgress({
      text: failed > 0 ? "图片上传完成（存在失败），正在保存提交记录..." : "图片上传完成，正在保存提交记录...",
      ratio: 0.96,
      meta: `上传体积 ${packed}（原图 ${raw}，失败 ${failed}）`,
      status: "active",
    });
  }
}

function clearPendingImages() {
  for (const item of pendingImages) {
    URL.revokeObjectURL(item.previewUrl);
  }
  pendingImages = [];
  if (ui["study-images"]) {
    ui["study-images"].value = "";
  }
  renderPendingImages();
}

function setPendingImagesFromFiles(files) {
  clearPendingImages();
  if (!files?.length) {
    scheduleSubmissionDraftSync();
    return;
  }

  const allowed = Math.max(0, MAX_IMAGE_COUNT_TOTAL - existingImages.length);
  pendingImages = files
    .filter((file) => file?.type?.startsWith("image/"))
    .slice(0, allowed)
    .map((file) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

  if (ui["study-images"]) {
    ui["study-images"].value = "";
  }
  renderPendingImages();
  scheduleSubmissionDraftSync();
}

function resetStudentImageState() {
  clearPendingImages();
  existingImages = [];
  removedStoragePaths = [];
  renderExistingImages();
  hideUploadProgress();
}

async function loadCurrentSubmissionImages() {
  if (!currentSession || (currentProfile?.role !== "student" && currentProfile?.role !== "teammate")) {
    return;
  }

  const studentId = currentSession.user.id;
  const studyDate = ui["study-date"].value;
  const module = ui["study-module"].value;

  if (!studyDate || !module) {
    return;
  }

  const { data, error } = await supabase
    .from("submissions")
    .select("image_urls")
    .eq("student_id", studentId)
    .eq("study_date", studyDate)
    .eq("module", module)
    .maybeSingle();

  if (error) {
    showAlert(`读取已上传图片失败: ${error.message}`, "error");
    return;
  }

  existingImages = (data?.image_urls ?? []).map((url) => ({
    url,
    storagePath: extractSubmissionStoragePath(url),
  }));
  removedStoragePaths = [];
  if (ui["existing-images-panel"]) {
    ui["existing-images-panel"].open = false;
  }
  renderExistingImages();
  renderPendingImages();
}

async function saveSubmission() {
  const submitBtn = ui["submission-form"].querySelector("button[type='submit']");
  let usedUploadPanel = false;

  await withButtonBusy(submitBtn, "提交中...", async () => {
    const studentId = currentSession.user.id;
    const studyDate = ui["study-date"].value;
    const module = ui["study-module"].value;
    const content = ui["study-content"].value.trim();
    const wordSummary = ui["word-summary"].value.trim();
    const mistakeSummary = ui["mistake-summary"].value.trim();

    if (!studyDate || !module || !content) {
      throw new Error("请填写日期、模块、核心内容。");
    }

    const totalAfterSubmit = existingImages.length + pendingImages.length;
    if (totalAfterSubmit > MAX_IMAGE_COUNT_TOTAL) {
      throw new Error(`图片总数不能超过 ${MAX_IMAGE_COUNT_TOTAL} 张。`);
    }

    const pickedFiles = pendingImages.map((x) => x.file);
    const hasNewImages = pickedFiles.length > 0;
    usedUploadPanel = hasNewImages;
    if (hasNewImages) {
      showUploadProgress({
        text: `准备处理 ${pickedFiles.length} 张图片`,
        ratio: 0,
        meta: `单图目标 ${formatBytes(TARGET_UPLOAD_SIZE)}，PNG 会自动转 JPG 以加速上传。`,
      });
    } else {
      hideUploadProgress();
    }

    let uploadResult = {
      urls: [],
      paths: [],
      failed: [],
      stats: {
        rawBytes: 0,
        preparedBytes: 0,
        totalFiles: 0,
        failedFiles: 0,
      },
    };
    try {
      if (hasNewImages) {
        uploadResult = await uploadSubmissionImages(
          studentId,
          studyDate,
          module,
          pickedFiles,
          (event) => renderUploadProgress(event)
        );
      }
    } catch (error) {
      const reason = toErrorMessage(error);
      showUploadProgress({
        text: "图片上传失败，可直接重试",
        ratio: 0,
        meta: `失败原因：${reason}`,
        status: "error",
      });
      throw new Error(`图片上传失败: ${reason}`);
    }

    const finalImageUrls = [...existingImages.map((x) => x.url), ...uploadResult.urls];
    const upsertPayload = {
      student_id: studentId,
      study_date: studyDate,
      module,
      content,
      word_summary: wordSummary,
      mistake_summary: mistakeSummary,
      image_urls: finalImageUrls,
      review_status: "pending",
    };

    const writeResult = await saveSubmissionRecordWithVerification(upsertPayload, hasNewImages);
    if (writeResult.error) {
      if (uploadResult.paths.length > 0) {
        await supabase.storage.from(SUBMISSION_BUCKET).remove(uploadResult.paths);
      }
      throw writeResult.error;
    }

    if (removedStoragePaths.length > 0) {
      const uniquePaths = [...new Set(removedStoragePaths)].filter(Boolean);
      if (uniquePaths.length > 0) {
        const { error: removeErr } = await supabase.storage.from(SUBMISSION_BUCKET).remove(uniquePaths);
        if (removeErr) {
          showAlert(`提交成功，但旧图删除失败: ${removeErr.message}`, "error", 5200);
        }
      }
    }

    const failedUploads = (uploadResult.failed ?? []).filter((item) => item?.file);
    const failedFiles = failedUploads.map((item) => item.file).filter(Boolean);
    const failedCount = failedFiles.length;
    const successFiles = uploadResult.urls.length;
    if (hasNewImages) {
      const raw = formatBytes(uploadResult.stats.rawBytes || 0);
      const packed = formatBytes(uploadResult.stats.preparedBytes || 0);
      const allFailed = failedCount > 0 && successFiles === 0;
      showUploadProgress({
        text: allFailed ? "文字已提交，图片待重传" : failedCount > 0 ? "提交成功（部分图片待重传）" : "提交成功",
        ratio: 1,
        meta: `上传成功 ${successFiles} 张，失败 ${failedCount} 张，体积 ${raw} -> ${packed}`,
        status: failedCount > 0 ? "error" : "success",
      });
      window.setTimeout(() => {
        hideUploadProgress();
      }, failedCount > 0 ? 4200 : 2600);
    }

    if (failedCount > 0) {
      existingImages = finalImageUrls.map((url) => ({
        url,
        storagePath: extractSubmissionStoragePath(url),
      }));
      removedStoragePaths = [];
      setPendingImagesFromFiles(failedFiles);
      if (ui["existing-images-panel"]) {
        ui["existing-images-panel"].open = true;
      }
      const first = failedUploads[0];
      showAlert(
        `已提交文字内容；仍有 ${failedCount} 张图片未传成功（示例：${first?.name || "图片"}）。可直接点“提交本模块”重试失败图片。${writeResult.recovered ? " 本次写入已自动校验成功。" : ""}`,
        "error",
        7600
      );
    } else {
      existingImages = finalImageUrls.map((url) => ({
        url,
        storagePath: extractSubmissionStoragePath(url),
      }));
      removedStoragePaths = [];
      clearPendingImages();
      renderExistingImages();
      hideUploadProgress();
      if (ui["existing-images-panel"]) {
        ui["existing-images-panel"].open = false;
      }
      showAlert(writeResult.recovered ? "提交成功，网络较慢但系统已自动校验写入成功。" : "提交成功。", "info");
    }
    await syncSubmissionDraftNow();
    await loadStudentData();
  }).catch((error) => {
    if (usedUploadPanel) {
      showUploadProgress({
        text: "提交失败，可重试",
        ratio: 0,
        meta: toErrorMessage(error),
        status: "error",
      });
    }
    showAlert(error.message || "提交失败", "error");
  });
}

async function saveSubmissionRecordWithVerification(payload, hasNewImages) {
  const response = await runWithRetry(
    async (attempt, maxAttempts) => {
      if (attempt > 0 && hasNewImages) {
        showUploadProgress({
          text: `写入提交记录重试 ${attempt + 1}/${maxAttempts}`,
          ratio: 0.97,
          meta: "图片已上传，正在写入数据库。",
          status: "active",
        });
      }
      return await withTimeout(
        supabase
          .from("submissions")
          .upsert(payload, { onConflict: "student_id,study_date,module" })
          .select("*")
          .maybeSingle(),
        22000,
        "写入提交记录超时"
      );
    },
    {
      retries: UPSERT_MAX_RETRY,
      baseDelayMs: 700,
      shouldRetry: (error) => isRetryableError(error),
    }
  );

  if (!response?.error) {
    return { data: response.data ?? null, recovered: false, error: null };
  }

  const verified = await verifySubmissionRecord(payload);
  if (verified) {
    return { data: verified, recovered: true, error: null };
  }
  return { data: null, recovered: false, error: response.error };
}

async function verifySubmissionRecord(payload) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await withTimeout(
      supabase
        .from("submissions")
        .select("*")
        .eq("student_id", payload.student_id)
        .eq("study_date", payload.study_date)
        .eq("module", payload.module)
        .maybeSingle(),
      12000,
      "校验提交记录超时"
    ).catch((queryError) => ({ data: null, error: queryError }));

    if (!error && submissionMatchesPayload(data, payload)) {
      return data;
    }
    await sleep(420 * (attempt + 1));
  }
  return null;
}

function submissionMatchesPayload(row, payload) {
  if (!row || !payload) {
    return false;
  }

  return (
    row.student_id === payload.student_id
    && row.study_date === payload.study_date
    && row.module === payload.module
    && String(row.content || "").trim() === String(payload.content || "").trim()
    && String(row.word_summary || "") === String(payload.word_summary || "")
    && String(row.mistake_summary || "") === String(payload.mistake_summary || "")
    && String(row.review_status || "pending") === String(payload.review_status || "pending")
    && arraysEqual(row.image_urls ?? [], payload.image_urls ?? [])
  );
}

async function saveReviewRecordWithVerification(payload) {
  const response = await runWithRetry(
    () =>
      withTimeout(
        supabase
          .from("reviews")
          .upsert(payload, { onConflict: "submission_id" })
          .select("*")
          .maybeSingle(),
        22000,
        "保存批改记录超时"
      ),
    {
      retries: UPSERT_MAX_RETRY,
      baseDelayMs: 680,
      shouldRetry: (error) => isRetryableError(error),
    }
  );

  if (!response?.error) {
    return { data: response.data ?? null, recovered: false, error: null };
  }

  const verified = await verifyReviewRecord(payload);
  if (verified) {
    return { data: verified, recovered: true, error: null };
  }
  return { data: null, recovered: false, error: response.error };
}

async function verifyReviewRecord(payload) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await withTimeout(
      supabase
        .from("reviews")
        .select("*")
        .eq("submission_id", payload.submission_id)
        .maybeSingle(),
      12000,
      "校验批改记录超时"
    ).catch((queryError) => ({ data: null, error: queryError }));

    if (!error && reviewMatchesPayload(data, payload)) {
      return data;
    }
    await sleep(420 * (attempt + 1));
  }
  return null;
}

function reviewMatchesPayload(row, payload) {
  if (!row || !payload) {
    return false;
  }

  return (
    row.submission_id === payload.submission_id
    && row.teacher_id === payload.teacher_id
    && Number(row.score) === Number(payload.score)
    && String(row.status || "") === String(payload.status || "")
    && String(row.comment || "").trim() === String(payload.comment || "").trim()
  );
}

async function updateSubmissionReviewStatusWithVerification(submissionId, status) {
  const response = await runWithRetry(
    () =>
      withTimeout(
        supabase
          .from("submissions")
          .update({ review_status: status })
          .eq("id", submissionId)
          .select("id,review_status")
          .maybeSingle(),
        22000,
        "Update submission status timed out"
      ),
    {
      retries: UPSERT_MAX_RETRY,
      baseDelayMs: 680,
      shouldRetry: (error) => isRetryableError(error),
    }
  );

  if (!response?.error) {
    return { data: response.data ?? null, recovered: false, error: null };
  }

  const verified = await verifySubmissionStatus(submissionId, status);
  if (verified) {
    return { data: verified, recovered: true, error: null };
  }
  return { data: null, recovered: false, error: response.error };
}

async function verifySubmissionStatus(submissionId, status) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await withTimeout(
      supabase
        .from("submissions")
        .select("id,review_status")
        .eq("id", submissionId)
        .maybeSingle(),
      12000,
      "Verify submission status timed out"
    ).catch((queryError) => ({ data: null, error: queryError }));

    if (!error && data?.id === submissionId && data?.review_status === status) {
      return data;
    }
    await sleep(420 * (attempt + 1));
  }
  return null;
}

async function saveAnnotationRecordWithVerification(payload, options = {}) {
  const isEdit = Boolean(options.annotationId);
  const response = await runWithRetry(
    () =>
      withTimeout(
        isEdit
          ? supabase
              .from("image_annotations")
              .update({
                source_image_url: payload.source_image_url,
                annotated_image_url: payload.annotated_image_url,
                note: payload.note,
              })
              .eq("id", options.annotationId)
              .select("*")
              .maybeSingle()
          : supabase
              .from("image_annotations")
              .insert(payload)
              .select("*")
              .maybeSingle(),
        22000,
        isEdit ? "Update annotation record timed out" : "Insert annotation record timed out"
      ),
    {
      retries: UPSERT_MAX_RETRY,
      baseDelayMs: 680,
      shouldRetry: (error) => isRetryableError(error),
    }
  );

  if (!response?.error) {
    return { data: response.data ?? null, recovered: false, error: null };
  }

  const verified = await verifyAnnotationRecord(payload, options);
  if (verified) {
    return { data: verified, recovered: true, error: null };
  }
  return { data: null, recovered: false, error: response.error };
}

async function verifyAnnotationRecord(payload, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (options.annotationId) {
      const { data, error } = await withTimeout(
        supabase
          .from("image_annotations")
          .select("*")
          .eq("id", options.annotationId)
          .maybeSingle(),
        12000,
        "Verify annotation record timed out"
      ).catch((queryError) => ({ data: null, error: queryError }));

      if (!error && annotationMatchesPayload(data, payload, options)) {
        return data;
      }
    } else {
      const { data, error } = await withTimeout(
        supabase
          .from("image_annotations")
          .select("*")
          .eq("submission_id", payload.submission_id)
          .eq("teacher_id", payload.teacher_id)
          .eq("annotated_image_url", payload.annotated_image_url)
          .order("created_at", { ascending: false })
          .limit(3),
        12000,
        "Verify annotation record timed out"
      ).catch((queryError) => ({ data: [], error: queryError }));

      if (!error) {
        const row = (Array.isArray(data) ? data : []).find((item) => annotationMatchesPayload(item, payload, options));
        if (row) {
          return row;
        }
      }
    }

    await sleep(420 * (attempt + 1));
  }
  return null;
}

function annotationMatchesPayload(row, payload, options = {}) {
  if (!row || !payload) {
    return false;
  }

  if (options.annotationId && String(row.id) !== String(options.annotationId)) {
    return false;
  }

  return (
    row.submission_id === payload.submission_id
    && row.teacher_id === payload.teacher_id
    && String(row.source_image_url || "") === String(payload.source_image_url || "")
    && String(row.annotated_image_url || "") === String(payload.annotated_image_url || "")
    && String(row.note || "").trim() === String(payload.note || "").trim()
  );
}

async function uploadSubmissionImages(studentId, studyDate, module, files, onProgress = () => {}) {
  if (!files.length) {
    return {
      urls: [],
      paths: [],
      failed: [],
      stats: {
        rawBytes: 0,
        preparedBytes: 0,
        totalFiles: 0,
        failedFiles: 0,
      },
    };
  }

  const preparedFiles = new Array(files.length);
  const uploadedPaths = [];
  const rawBytes = files.reduce((sum, file) => sum + (file?.size || 0), 0);
  let preparedRawBytes = 0;
  let preparedBytes = 0;
  let preparedDone = 0;
  let uploadedCount = 0;
  let failedCount = 0;
  let prepareNextIndex = 0;
  let activeUploads = 0;
  const failedItems = [];
  const prepareWorkerCount = getAdaptivePrepareConcurrency(files.length);

  const prepareWorkers = Array.from(
    { length: Math.min(prepareWorkerCount, files.length) },
    async () => {
      while (true) {
        const idx = prepareNextIndex;
        prepareNextIndex += 1;
        if (idx >= files.length) {
          return;
        }

        const rawFile = files[idx];
        try {
          const prepared = await prepareImageForUpload(rawFile);
          preparedFiles[idx] = prepared;
          preparedDone += 1;
          preparedRawBytes += rawFile.size || 0;
          preparedBytes += prepared.size || 0;

          onProgress({
            phase: "prepare",
            done: preparedDone,
            failed: failedCount,
            total: files.length,
            rawBytes: preparedRawBytes,
            preparedBytes,
          });
          await yieldToUi();
        } catch (error) {
          failedCount += 1;
          const userName = fileLabelForUser(rawFile.name, idx);
          failedItems.push({
            index: idx,
            name: userName,
            rawName: rawFile.name,
            file: rawFile,
            message: toErrorMessage(error),
          });
          onProgress({
            phase: "prepare-file-failed",
            done: preparedDone,
            failed: failedCount,
            total: files.length,
            currentName: userName,
            error: toErrorMessage(error),
          });
          await yieldToUi();
        }
      }
    }
  );

  await Promise.all(prepareWorkers);

  const preparedQueue = preparedFiles
    .map((prepared, index) => ({ prepared, index }))
    .filter((item) => Boolean(item.prepared));

  if (!preparedQueue.length) {
    onProgress({
      phase: "done",
      rawBytes,
      preparedBytesTotal: preparedBytes,
      failed: failedCount,
    });
    return {
      urls: [],
      paths: [],
      failed: failedItems,
      stats: {
        rawBytes,
        preparedBytes,
        totalFiles: files.length,
        failedFiles: failedCount,
      },
    };
  }

  const uploadedUrls = new Array(files.length);
  const batchStamp = Date.now();
  let nextQueueIndex = 0;
  let uploadedBytes = 0;
  const workerCount = Math.min(getAdaptiveUploadConcurrency(preparedQueue.length), preparedQueue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const queueIndex = nextQueueIndex;
      nextQueueIndex += 1;
      if (queueIndex >= preparedQueue.length) {
        return;
      }

      const { prepared, index } = preparedQueue[queueIndex];
      const safeName = prepared.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${studentId}/${studyDate}/${module}_${batchStamp}_${index}_${safeName}`;
      activeUploads += 1;
      onProgress({
        phase: "upload-start",
        done: uploadedCount,
        failed: failedCount,
        total: files.length,
        active: activeUploads,
        concurrency: workerCount,
        currentName: fileLabelForUser(prepared.name, index),
      });

      try {
        await uploadFileWithRetry(path, prepared, {
          getDone: () => uploadedCount,
          getActive: () => activeUploads,
          total: files.length,
          onProgress,
        });
      } catch (error) {
        activeUploads = Math.max(0, activeUploads - 1);
        failedCount += 1;
        const fallbackName = fileLabelForUser(prepared.name, index);
        failedItems.push({
          index,
          name: fallbackName,
          rawName: prepared.name,
          file: files[index] ?? prepared,
          message: toErrorMessage(error),
        });
        onProgress({
          phase: "upload-file-failed",
          done: uploadedCount,
          failed: failedCount,
          total: files.length,
          active: activeUploads,
          concurrency: workerCount,
          currentName: fallbackName,
          error: toErrorMessage(error),
        });
        await yieldToUi();
        continue;
      }

      uploadedPaths.push(path);
      const { data } = supabase.storage.from(SUBMISSION_BUCKET).getPublicUrl(path);
      uploadedUrls[index] = data.publicUrl;
      uploadedCount += 1;
      uploadedBytes += prepared.size || 0;
      activeUploads = Math.max(0, activeUploads - 1);

      onProgress({
        phase: "upload",
        done: uploadedCount,
        failed: failedCount,
        total: files.length,
        active: activeUploads,
        uploadedBytes,
        preparedBytesTotal: preparedBytes,
        concurrency: workerCount,
      });
      await yieldToUi();
    }
  });

  await Promise.all(workers);

  onProgress({
    phase: "done",
    rawBytes,
    preparedBytesTotal: preparedBytes,
    failed: failedCount,
  });

  return {
    urls: uploadedUrls.filter(Boolean),
    paths: uploadedPaths,
    failed: failedItems,
    stats: {
      rawBytes,
      preparedBytes,
      totalFiles: files.length,
      failedFiles: failedCount,
    },
  };
}

async function uploadFileWithRetry(path, file, context) {
  let attempt = 1;
  let lastError = null;
  const maxAttempts = UPLOAD_MAX_RETRY + 1;
  let fileToUpload = file;
  let emergencyCompressed = false;

  while (attempt <= maxAttempts) {
    const timeoutMs = getUploadTimeoutMs(fileToUpload.size || 0, attempt);
    const { error } = await withTimeout(
      supabase.storage
        .from(SUBMISSION_BUCKET)
        .upload(path, fileToUpload, { upsert: false, contentType: fileToUpload.type }),
      timeoutMs,
      `上传超时: ${fileLabelForUser(file.name)}`
    );

    if (!error) {
      return;
    }
    if (isPathAlreadyExistsError(error)) {
      return;
    }

    lastError = error;
    if (attempt >= maxAttempts) {
      break;
    }

    if (!emergencyCompressed && isTimeoutLikeError(error) && fileToUpload.type.startsWith("image/")) {
      try {
        const smaller = await compressImageToTarget(
          fileToUpload,
          Math.min(EMERGENCY_UPLOAD_SIZE, Math.floor((fileToUpload.size || EMERGENCY_UPLOAD_SIZE) * 0.78))
        );
        if (smaller.size < (fileToUpload.size || 0) * 0.95) {
          fileToUpload = smaller;
          emergencyCompressed = true;
          context.onProgress?.({
            phase: "retry-compress",
            done: context.getDone?.() ?? 0,
            total: context.total,
            active: context.getActive?.() ?? 1,
            currentName: fileLabelForUser(file.name),
            compressedSize: smaller.size || 0,
          });
        }
      } catch (_error) {
        // Ignore fallback compression errors and continue normal retry.
      }
    }

    context.onProgress?.({
      phase: "retry",
      done: context.getDone?.() ?? 0,
      total: context.total,
      active: context.getActive?.() ?? 1,
      currentName: fileLabelForUser(file.name),
      attempt: attempt + 1,
      maxAttempts,
      timeoutMs,
    });
    const waitMs = UPLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 220);
    await sleep(waitMs);
    attempt += 1;
  }

  let message = toErrorMessage(lastError);
  const lower = message.toLowerCase();
  if (lower.includes("payload too large") || lower.includes("entity too large") || lower.includes("413")) {
    message = `${message}（单图仍过大，建议再裁剪或降低清晰度后重试）`;
  }
  throw new Error(`${fileLabelForUser(file.name)}: ${message}`);
}

async function prepareImageForUpload(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`不是图片文件: ${file.name}`);
  }

  if (file.type === "image/gif") {
    if (file.size > TARGET_UPLOAD_SIZE) {
      throw new Error(`GIF 体积过大，请换小图: ${file.name}`);
    }
    return file;
  }

  const type = String(file.type || "").toLowerCase();
  const shouldReencodeNonJpeg =
    (type === "image/png" || type === "image/webp" || type === "image/bmp") &&
    file.size >= NON_JPEG_REENCODE_MIN_SIZE;
  const needCompressBySize = file.size > TARGET_UPLOAD_SIZE;
  if (!needCompressBySize && !shouldReencodeNonJpeg) {
    return file;
  }

  const targetBytes = needCompressBySize
    ? TARGET_UPLOAD_SIZE
    : Math.min(TARGET_UPLOAD_SIZE, Math.max(300 * 1024, Math.floor(file.size * 0.8)));
  const compressed = await compressImageToTarget(file, targetBytes);
  if (compressed.size > MAX_POST_COMPRESS_SIZE) {
    throw new Error(`压缩后仍过大: ${fileLabelForUser(file.name)}`);
  }

  return compressed;
}

async function compressImageToTarget(file, targetBytes) {
  const image = await loadImageFromFile(file);
  const ow = image.naturalWidth || image.width;
  const oh = image.naturalHeight || image.height;
  const maxSide = Math.max(ow, oh);

  // Heuristic: estimate a smaller initial canvas for very large originals to reduce iterations.
  const sizeRatio = Math.min(1, Math.sqrt(targetBytes / Math.max(file.size || targetBytes, 1)) * 1.15);
  let scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(maxSide, 1), Math.max(0.34, sizeRatio));
  let quality = START_JPEG_QUALITY;
  let bestBlob = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let round = 0; round < 3; round += 1) {
    const width = Math.max(1, Math.round(ow * scale));
    const height = Math.max(1, Math.round(oh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, width, height);

    for (let i = 0; i < 6; i += 1) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!blob) {
        throw new Error("压缩失败");
      }

      const score = Math.abs(blob.size - targetBytes);
      if (score < bestScore || bestBlob === null) {
        bestBlob = blob;
        bestScore = score;
      }
      if (blob.size <= targetBytes) {
        break;
      }
      quality = Math.max(MIN_JPEG_QUALITY, quality - 0.08);
    }

    if (bestBlob && bestBlob.size <= targetBytes) {
      break;
    }

    scale *= 0.78;
    quality = START_JPEG_QUALITY;
  }

  if (!bestBlob) {
    throw new Error("压缩失败");
  }

  return new File([bestBlob], `${stripFileExtension(file.name)}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

function stripFileExtension(name) {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) {
    return name;
  }
  return name.slice(0, idx);
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片读取失败"));
    };

    img.src = objectUrl;
  });
}

function loadImageFromUrl(url, useCrossOrigin = true) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCrossOrigin) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = url;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function extractSubmissionStoragePath(url) {
  try {
    const parsed = new URL(url);
    const idx = parsed.pathname.indexOf(SUBMISSION_PUBLIC_MARKER);
    if (idx < 0) {
      return null;
    }
    return decodeURIComponent(parsed.pathname.slice(idx + SUBMISSION_PUBLIC_MARKER.length));
  } catch (_error) {
    return null;
  }
}

function extractAnnotationStoragePath(url) {
  try {
    const parsed = new URL(url);
    const idx = parsed.pathname.indexOf(ANNOT_PUBLIC_MARKER);
    if (idx < 0) {
      return null;
    }
    return decodeURIComponent(parsed.pathname.slice(idx + ANNOT_PUBLIC_MARKER.length));
  } catch (_error) {
    return null;
  }
}

async function loadStudentData() {
  const uid = currentSession.user.id;

  const submissionsResp = await supabase
    .from("submissions")
    .select("*")
    .eq("student_id", uid)
    .order("study_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);

  if (submissionsResp.error) {
    showAlert(`读取提交失败: ${submissionsResp.error.message}`, "error");
    return;
  }

  const submissions = submissionsResp.data ?? [];
  const submissionIds = submissions.map((x) => x.id);

  const reviewMap = await loadReviewMap(submissionIds);
  annotationMapBySubmission = await loadAnnotationMap(submissionIds);
  mySubmissionCache = submissions;
  myReviewMap = reviewMap;
  myAnnotationMap = annotationMapBySubmission;
  if (historyHighlightedSubmissionId && !mySubmissionCache.some((item) => item.id === historyHighlightedSubmissionId)) {
    historyHighlightedSubmissionId = "";
  }
  renderStudentDatePicker();
  renderHistoryModuleTabs();
  renderHistoryList();
  if (selectedStudentReviewId) {
    if (findSubmissionRecord(selectedStudentReviewId)) {
      renderStudentReviewModal(selectedStudentReviewId);
    } else {
      closeStudentReviewModal();
    }
  }
}

async function loadReviewMap(submissionIds) {
  const map = new Map();
  if (!submissionIds.length) {
    return map;
  }

  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .in("submission_id", submissionIds);

  if (error) {
    showAlert(`读取批改失败: ${error.message}`, "error");
    return map;
  }

  for (const review of data ?? []) {
    map.set(review.submission_id, review);
  }

  return map;
}

async function loadAnnotationMap(submissionIds) {
  const map = new Map();
  if (!submissionIds.length) {
    return map;
  }

  const { data, error } = await supabase
    .from("image_annotations")
    .select("*")
    .in("submission_id", submissionIds)
    .order("created_at", { ascending: false });

  if (error) {
    showAlert(`读取图片批注失败: ${error.message}`, "error");
    return map;
  }

  for (const row of data ?? []) {
    if (!map.has(row.submission_id)) {
      map.set(row.submission_id, []);
    }
    map.get(row.submission_id).push(row);
  }

  return map;
}
function clearHistoryFocus() {
  historyHighlightedSubmissionId = "";
}

function applyStudentStudyDate(isoDate) {
  if (!isoDate) {
    return;
  }
  ui["study-date"].value = isoDate;
  syncStudentDateQuickCursor();
  void onStudentSlotChanged();
}

function syncStudentDateQuickCursor() {
  const pickedDate = ui["study-date"]?.value || toIsoDate(new Date());
  studentSubmissionCursor = startOfWeek(pickedDate);
  renderStudentDatePicker();
}

function renderStudentDatePicker() {
  const holder = ui["student-date-chip-list"];
  if (!holder) {
    return;
  }

  const selectedDate = ui["study-date"]?.value || toIsoDate(new Date());
  const today = toIsoDate(new Date());
  const countMap = buildSubmissionCountMap(mySubmissionCache);
  const days = Array.from({ length: 7 }, (_item, index) => addDays(studentSubmissionCursor, index));

  holder.innerHTML = days
    .map((date) => {
      const iso = toIsoDate(date);
      const count = countMap.get(iso) || 0;
      const classes = [
        "date-chip",
        iso === selectedDate ? "active" : "",
        iso === today ? "is-today" : "",
        count > 0 ? "has-record" : "",
      ].filter(Boolean).join(" ");
      const monthDay = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
      const meta = count > 0 ? `已交 ${count} 项` : "暂无记录";
      return `<button type="button" class="${classes}" data-study-quick-date="${iso}" title="切换到 ${iso}">
        <span class="date-chip-weekday">${formatWeekdayShort(date)}</span>
        <span class="date-chip-day">${monthDay}</span>
        <span class="date-chip-meta">${meta}</span>
      </button>`;
    })
    .join("");
}

function getFilteredHistoryRows() {
  let rows = mySubmissionCache.slice();
  if (historyModuleFilter !== "all") {
    rows = rows.filter((item) => item.module === historyModuleFilter);
  }
  if (historyDateFilter) {
    rows = rows.filter((item) => item.study_date === historyDateFilter);
  }
  return rows;
}

function renderHistoryFilterState(rows = getFilteredHistoryRows()) {
  const holder = ui["history-filter-state"];
  if (!holder) {
    return;
  }

  const dateText = historyDateFilter || "全部日期";
  const moduleText = historyModuleFilter === "all" ? "全部模块" : (MODULE_LABELS[historyModuleFilter] ?? historyModuleFilter);
  const focusText = historyHighlightedSubmissionId ? " · 已定位到消息对应记录" : "";
  holder.textContent = `当前查看：${dateText} · ${moduleText} · 共 ${rows.length} 条${focusText}`;
}

function setHistoryDateFilter(nextDate, options = {}) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(nextDate || "")) ? String(nextDate) : "";
  historyDateFilter = normalized;
  if (ui["history-date-filter"]) {
    ui["history-date-filter"].value = normalized;
  }
  renderHistoryList();

  if (normalized && options.syncCalendar !== false) {
    const targetMonth = startOfMonth(normalized);
    if (formatMonthLabel(targetMonth) !== formatMonthLabel(studentCalendarCursor)) {
      studentCalendarCursor = targetMonth;
      void loadStudentCalendarData();
      return;
    }
  }

  renderStudentCalendar();
}

function focusHistorySubmission(submissionId) {
  historyHighlightedSubmissionId = submissionId || "";
  const row = mySubmissionCache.find((item) => item.id === submissionId);
  if (!row) {
    renderHistoryList();
    return;
  }

  historyModuleFilter = "all";
  renderHistoryModuleTabs();
  setHistoryDateFilter(row.study_date);
  window.requestAnimationFrame(() => {
    const target = document.querySelector(`[data-history-row-id="${submissionId}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function findSubmissionRecord(submissionId) {
  return mySubmissionCache.find((item) => item.id === submissionId)
    || submissionCache.find((item) => item.id === submissionId)
    || null;
}

function getSubmissionImageIndex(submissionId, sourceImageUrl) {
  const row = findSubmissionRecord(submissionId);
  if (!row || !Array.isArray(row.image_urls)) {
    return -1;
  }
  return row.image_urls.findIndex((url) => url === sourceImageUrl);
}

function describeSubmissionSourceImage(submissionId, sourceImageUrl, fallback = "Image") {
  const index = getSubmissionImageIndex(submissionId, sourceImageUrl);
  if (index >= 0) {
    return `Image ${index + 1}`;
  }
  return fallback;
}

function buildSourcePreviewTitle(submissionId, sourceImageUrl) {
  const row = findSubmissionRecord(submissionId);
  const sourceLabel = describeSubmissionSourceImage(submissionId, sourceImageUrl, "Image");
  if (!row) {
    return `原图预览 · ${sourceLabel}`;
  }
  return `原图预览 · ${displayName(row.student_id)} · ${row.study_date} · ${MODULE_LABELS[row.module] ?? row.module} · ${sourceLabel}`;
}

function buildAnnotationContextText(submissionId, sourceImageUrl) {
  const row = findSubmissionRecord(submissionId);
  const sourceLabel = describeSubmissionSourceImage(submissionId, sourceImageUrl, "Image");
  if (!row) {
    return sourceLabel;
  }
  return `${displayName(row.student_id)} · ${row.study_date} · ${MODULE_LABELS[row.module] ?? row.module} · ${sourceLabel}`;
}

function getAnnotationSourceMap(submissionId) {
  const map = new Map();
  const rows = annotationMapBySubmission.get(submissionId) ?? [];
  for (const row of rows) {
    const key = String(row.source_image_url || "");
    if (!key) {
      continue;
    }
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
  }
  return map;
}

function getAnnotationCoverage(submissionId, urls = []) {
  const sourceMap = getAnnotationSourceMap(submissionId);
  const totalImages = urls.length;
  const annotatedSources = urls.filter((url) => sourceMap.has(url)).length;
  const totalAnnotations = [...sourceMap.values()].reduce((sum, rows) => sum + rows.length, 0);
  let state = "none";
  if (totalImages === 0) {
    state = "empty";
  } else if (annotatedSources === totalImages) {
    state = "full";
  } else if (annotatedSources > 0) {
    state = "partial";
  }
  return {
    totalImages,
    annotatedSources,
    totalAnnotations,
    sourceMap,
    state,
  };
}

function renderReviewPlaceholder(message) {
  return `<div class="teacher-review-placeholder">${escapeHtml(message)}</div>`;
}

function isTodayDate(value) {
  return String(value || "") === toIsoDate(new Date());
}

function renderTodayBadge(value, label = "Today") {
  if (!isTodayDate(value)) {
    return "";
  }
  return `<span class="today-badge">${escapeHtml(label)}</span>`;
}

function buildReviewSelectionStatsMarkup(item) {
  if (!item) {
    return '<span class="teacher-review-empty-pill">先在左侧选择一条作业</span>';
  }

  const review = teacherReviewMap.get(item.id);
  const status = review?.status ?? item.review_status ?? "pending";
  const coverage = getAnnotationCoverage(item.id, item.image_urls ?? []);
  const pills = [
    `<span class="teacher-review-pill teacher-review-pill-strong">${escapeHtml(displayName(item.student_id))}</span>`,
    `<span class="teacher-review-pill">${escapeHtml(MODULE_LABELS[item.module] ?? item.module)}</span>`,
    `<span class="teacher-review-pill">Images ${escapeHtml(String(coverage.totalImages))}</span>`,
    `<span class="teacher-review-pill ${coverage.state === "full" ? "is-good" : coverage.state === "none" ? "is-warn" : "is-mid"}">Annotated ${escapeHtml(String(coverage.annotatedSources))}/${escapeHtml(String(coverage.totalImages))}</span>`,
    `<span class="teacher-review-pill">Marks ${escapeHtml(String(coverage.totalAnnotations))}</span>`,
    `<span class="status-chip ${statusClass(status)}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>`,
  ];

  const todayBadge = renderTodayBadge(item.study_date);
  if (todayBadge) {
    pills.push(todayBadge);
  }

  return pills.join("");
}

function summarizeText(text, limit = 88) {
  const raw = String(text || "").trim().replace(/\s+/g, " ");
  if (!raw) {
    return "";
  }
  return raw.length > limit ? `${raw.slice(0, limit).trimEnd()}…` : raw;
}

function buildReviewActionButton(action, label, submissionId, extraAttrs = {}, className = "btn btn-ghost btn-small") {
  const attrs = Object.entries(extraAttrs)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}="${escapeAttr(String(value))}"`)
    .join(" ");
  const attrText = attrs ? ` ${attrs}` : "";
  return `<button type="button" class="${escapeAttr(className)}" data-review-action="${escapeAttr(action)}" data-submission-id="${escapeAttr(submissionId)}"${attrText}>${escapeHtml(label)}</button>`;
}

function buildStudentSummaryGrid(row) {
  const items = [];
  if (row.word_summary) {
    items.push({ label: "词句总结", value: row.word_summary });
  }
  if (row.mistake_summary) {
    items.push({ label: "错因提醒", value: row.mistake_summary });
  }
  if (!items.length) {
    return "";
  }

  return `<div class="review-summary-grid">${items
    .map(
      (item) => `<div class="review-summary-item">
        <span class="review-summary-label">${escapeHtml(item.label)}</span>
        <strong class="review-summary-value">${escapeHtml(item.value)}</strong>
      </div>`
    )
    .join("")}</div>`;
}

function buildStudentHistoryCard(row, options = {}) {
  const review = myReviewMap.get(row.id);
  const annotations = myAnnotationMap.get(row.id) ?? [];
  const status = review?.status ?? row.review_status ?? "pending";
  const hasReview = Boolean(review) || annotations.length > 0;
  const scoreText = review?.score == null ? "Pending" : `${review.score}`;
  const createdAt = formatDateTime(row.created_at);
  const reviewedAt = review ? formatDateTime(review.updated_at || review.created_at) : "Waiting for teacher review";
  const comment = review?.comment || (hasReview ? "Processed, comment is empty for now." : "Teacher review details will appear here later.");
  const submissionExcerpt = summarizeText(row.content, hasReview ? 78 : 96) || "This entry was mostly image-based.";
  const summaryGrid = buildStudentSummaryGrid(row);
  const firstImage = row.image_urls?.[0];
  const firstAnnot = annotations[0]?.annotated_image_url;
  const previewBase = `${row.study_date} · ${MODULE_LABELS[row.module] ?? row.module}`;
  const todayBadge = renderTodayBadge(row.study_date);
  const actions = [
    buildReviewActionButton("open-detail", hasReview ? "Open Review" : "Open Work", row.id, {}, hasReview ? "btn btn-primary btn-small" : "btn btn-ghost btn-small"),
    firstAnnot
      ? buildReviewActionButton(
          "preview-annot",
          "Marked Image",
          row.id,
          {
            "data-source-url": encodeURIComponent(firstAnnot),
            "data-preview-title": `Teacher Markup · ${previewBase}` ,
            "data-preview-tip": "This is the teacher-marked image.",
          }
        )
      : "",
    firstImage
      ? buildReviewActionButton(
          "preview-origin",
          "Original",
          row.id,
          {
            "data-source-url": encodeURIComponent(firstImage),
            "data-preview-title": `Original Image · ${previewBase}` ,
            "data-preview-tip": "This is the original submission image.",
          }
        )
      : "",
  ].filter(Boolean).join("");

  return `
    <article class="history-card ${hasReview ? "reviewed" : "pending"}${options.active ? " active" : ""}${isTodayDate(row.study_date) ? " is-today" : ""}" data-history-row-id="${escapeAttr(row.id)}">
      <div class="history-card-head">
        <div>
          <p class="history-card-kicker">${hasReview ? "Teacher Reviewed" : "Waiting for Review"}</p>
          <div class="history-card-title-row">
            <h3 class="history-card-title">${escapeHtml(row.study_date)} · ${escapeHtml(MODULE_LABELS[row.module] ?? row.module)}</h3>
            ${todayBadge}
          </div>
          <p class="history-card-submeta">Submitted ${escapeHtml(createdAt)} · ${hasReview ? `Teacher updated ${escapeHtml(reviewedAt)}` : "Teacher has not handled it yet"}</p>
        </div>
        <span class="status-chip ${statusClass(status)}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>
      </div>
      <div class="history-card-stats">
        <span class="history-stat-pill">Score ${escapeHtml(scoreText)}</span>
        <span class="history-stat-pill">Images ${(row.image_urls ?? []).length}</span>
        <span class="history-stat-pill">Marks ${annotations.length}</span>
      </div>
      <div>
        <p class="history-card-section-label">Teacher Comment</p>
        <blockquote class="history-card-quote">${escapeHtml(comment)}</blockquote>
      </div>
      ${summaryGrid || ""}
      <p class="history-card-submission">Submission summary: ${escapeHtml(submissionExcerpt)}</p>
      <div class="history-card-actions">${actions}</div>
    </article>
  `;
}

function buildStudentSyncCard(row) {
  const review = myReviewMap.get(row.id);
  const annotations = myAnnotationMap.get(row.id) ?? [];
  const status = review?.status ?? row.review_status ?? "pending";
  const hasReview = Boolean(review) || annotations.length > 0;
  const comment = review?.comment || (hasReview ? "Processed, comment is empty for now." : "Teacher updates will sync here later.");
  const scoreText = review?.score == null ? "Pending" : `${review.score}`;
  const syncTime = review ? formatDateTime(review.updated_at || review.created_at) : "Waiting for teacher review";
  const firstImage = row.image_urls?.[0];
  const firstAnnot = annotations[0]?.annotated_image_url;
  const previewBase = `${row.study_date} · ${MODULE_LABELS[row.module] ?? row.module}`;
  const todayBadge = renderTodayBadge(row.study_date);
  const actions = [
    buildReviewActionButton("open-detail", hasReview ? "Open Review" : "Open Work", row.id, {}, hasReview ? "btn btn-primary btn-small" : "btn btn-ghost btn-small"),
    firstAnnot
      ? buildReviewActionButton(
          "preview-annot",
          "Marked Image",
          row.id,
          {
            "data-source-url": encodeURIComponent(firstAnnot),
            "data-preview-title": `Teacher Markup · ${previewBase}` ,
            "data-preview-tip": "This is the teacher-marked image.",
          }
        )
      : "",
    firstImage
      ? buildReviewActionButton(
          "preview-origin",
          "Original",
          row.id,
          {
            "data-source-url": encodeURIComponent(firstImage),
            "data-preview-title": `Original Image · ${previewBase}` ,
            "data-preview-tip": "This is the original submission image.",
          }
        )
      : "",
  ].filter(Boolean).join("");

  return `
    <article class="sync-card ${hasReview ? "reviewed" : "pending"}${isTodayDate(row.study_date) ? " is-today" : ""}">
      <div class="sync-card-head">
        <div>
          <div class="history-card-title-row">
            <strong class="sync-card-title">${escapeHtml(row.study_date)} · ${escapeHtml(MODULE_LABELS[row.module] ?? row.module)}</strong>
            ${todayBadge}
          </div>
          <p class="sync-card-meta">Teacher updated: ${escapeHtml(syncTime)}</p>
        </div>
        <span class="status-chip ${statusClass(status)}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>
      </div>
      <div class="sync-card-pills">
        <span class="history-stat-pill">Score ${escapeHtml(scoreText)}</span>
        <span class="history-stat-pill">Images ${(row.image_urls ?? []).length}</span>
        <span class="history-stat-pill">Marks ${annotations.length}</span>
      </div>
      <p class="sync-card-comment">${escapeHtml(summarizeText(comment, 88) || "Teacher updates will show here.")}</p>
      <div class="sync-card-actions">${actions}</div>
    </article>
  `;
}

function renderStudentReviewGallery(items, type, row) {
  if (!items.length) {
    return `<div class="student-review-empty">${type === "annotation" ? "老师暂时还没有上传批注图。批改后，这里会显示可放大查看的批注图片。" : "这次提交没有图片，老师主要基于文字内容进行了批改。"}</div>`;
  }

  const previewBase = `${row.study_date} · ${MODULE_LABELS[row.module] ?? row.module}`;
  return `<div class="student-review-gallery-list">${items
    .map((item, index) => {
      const imageUrl = type === "annotation" ? item.annotated_image_url : item;
      if (!imageUrl) {
        return "";
      }
      const label = type === "annotation" ? `老师批注 ${index + 1}` : `原始作业 ${index + 1}`;
      const note = type === "annotation" && item.note
        ? `<p class="student-review-shot-note">${escapeHtml(item.note)}</p>`
        : '<p class="student-review-shot-note">点击可查看更清晰的大图预览。</p>';
      const previewTitle = type === "annotation"
        ? `老师批注图 · ${previewBase} · 第 ${index + 1} 张`
        : `作业原图 · ${previewBase} · 第 ${index + 1} 张`;
      const previewTip = type === "annotation"
        ? "这是老师圈画后的批注图，可放大查看细节。"
        : "这是你提交给老师的原始作业图片。";
      return `<article class="student-review-shot">
        <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(label)}" />
        <div class="student-review-shot-meta">
          <strong>${escapeHtml(label)}</strong>
          <span>${type === "annotation" ? "批注图" : "原图"}</span>
        </div>
        ${note}
        ${buildReviewActionButton(
          type === "annotation" ? "preview-annot" : "preview-origin",
          "查看大图",
          row.id,
          {
            "data-source-url": encodeURIComponent(imageUrl),
            "data-preview-title": previewTitle,
            "data-preview-tip": previewTip,
          }
        )}
      </article>`;
    })
    .join("")}</div>`;
}

function renderStudentReviewModalContent(row) {
  const review = myReviewMap.get(row.id);
  const annotations = myAnnotationMap.get(row.id) ?? [];
  const status = review?.status ?? row.review_status ?? "pending";
  const hasReview = Boolean(review) || annotations.length > 0;
  const comment = review?.comment || (hasReview ? "老师已处理，暂未填写详细评语。" : "老师还没开始处理这条作业，后续这里会显示评语、分数和批注图。");
  const scoreText = review?.score == null ? "待评分" : `${review.score} 分`;
  const submittedAt = formatDateTime(row.created_at);
  const reviewedAt = review ? formatDateTime(review.updated_at || review.created_at) : "待老师处理";
  const summaryGrid = buildStudentSummaryGrid(row);

  return `
    <div class="student-review-hero">
      <section class="student-review-panel student-review-panel-accent">
        <div class="student-review-section-head">
          <div>
            <p class="student-review-section-kicker">老师反馈</p>
            <h4>评语与建议</h4>
          </div>
          <span class="status-chip ${statusClass(status)}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>
        </div>
        <p class="student-review-comment">${escapeHtml(comment)}</p>
        ${summaryGrid || '<div class="student-review-empty">这次老师还没有填写词句总结或错因提醒。</div>'}
      </section>
      <section class="student-review-panel">
        <div class="student-review-section-head">
          <div>
            <p class="student-review-section-kicker">作业概览</p>
            <h4>批改信息</h4>
          </div>
        </div>
        <div class="student-review-scoreboard">
          <div class="student-review-stat">
            <span>处理状态</span>
            <strong>${escapeHtml(STATUS_LABELS[status] ?? status)}</strong>
          </div>
          <div class="student-review-stat">
            <span>老师评分</span>
            <strong>${escapeHtml(scoreText)}</strong>
          </div>
          <div class="student-review-stat">
            <span>提交时间</span>
            <strong>${escapeHtml(submittedAt)}</strong>
          </div>
          <div class="student-review-stat">
            <span>老师处理</span>
            <strong>${escapeHtml(reviewedAt)}</strong>
          </div>
          <div class="student-review-stat">
            <span>原始图片</span>
            <strong>${escapeHtml(String((row.image_urls ?? []).length))} 张</strong>
          </div>
          <div class="student-review-stat">
            <span>批注图片</span>
            <strong>${escapeHtml(String(annotations.length))} 张</strong>
          </div>
        </div>
      </section>
    </div>
    <section class="student-review-panel">
      <div class="student-review-section-head">
        <div>
          <p class="student-review-section-kicker">你的提交</p>
          <h4>作业正文</h4>
        </div>
      </div>
      <p class="student-review-content">${escapeHtml(row.content || "这次没有填写文字内容，老师主要依据图片进行了批改。")}</p>
    </section>
    <section class="student-review-panel">
      <div class="student-review-section-head">
        <div>
          <p class="student-review-section-kicker">原始材料</p>
          <h4>你提交给老师的图片</h4>
        </div>
      </div>
      ${renderStudentReviewGallery(row.image_urls ?? [], "original", row)}
    </section>
    <section class="student-review-panel">
      <div class="student-review-section-head">
        <div>
          <p class="student-review-section-kicker">老师批注</p>
          <h4>可放大查看的批注图</h4>
        </div>
      </div>
      ${renderStudentReviewGallery(annotations, "annotation", row)}
    </section>
  `;
}

function renderStudentReviewModal(submissionId) {
  const row = findSubmissionRecord(submissionId);
  if (!row) {
    closeStudentReviewModal();
    return;
  }
  const review = myReviewMap.get(submissionId);
  const annotations = myAnnotationMap.get(submissionId) ?? [];
  const hasReview = Boolean(review) || annotations.length > 0;
  ui["student-review-kicker"].textContent = hasReview ? "老师批改详情" : "作业详情";
  ui["student-review-title"].textContent = `${row.study_date} · ${MODULE_LABELS[row.module] ?? row.module}`;
  ui["student-review-subtitle"].textContent = hasReview
    ? `提交时间：${formatDateTime(row.created_at)} · 老师处理：${formatDateTime(review?.updated_at || review?.created_at)}`
    : `提交时间：${formatDateTime(row.created_at)} · 老师尚未处理`;
  ui["student-review-body"].innerHTML = renderStudentReviewModalContent(row);
}

function openStudentReviewModal(submissionId) {
  if (!findSubmissionRecord(submissionId)) {
    return;
  }
  selectedStudentReviewId = submissionId;
  if (historyHighlightedSubmissionId !== submissionId) {
    historyHighlightedSubmissionId = submissionId;
    renderHistoryList();
  }
  renderStudentReviewModal(submissionId);
  ui["student-review-modal"].classList.remove("hidden");
}

function closeStudentReviewModal() {
  selectedStudentReviewId = null;
  if (!ui["student-review-modal"]) {
    return;
  }
  ui["student-review-kicker"].textContent = "老师批改详情";
  ui["student-review-title"].textContent = "-";
  ui["student-review-subtitle"].textContent = "-";
  ui["student-review-body"].innerHTML = "";
  ui["student-review-modal"].classList.add("hidden");
}

function handleStudentReviewActionClick(event) {
  const actionBtn = event.target.closest("[data-review-action]");
  if (!actionBtn) {
    return;
  }
  event.preventDefault();
  const submissionId = actionBtn.dataset.submissionId;
  if (!submissionId) {
    return;
  }

  if (actionBtn.dataset.reviewAction === "open-detail") {
    openStudentReviewModal(submissionId);
    return;
  }

  const sourceUrl = actionBtn.dataset.sourceUrl;
  if (!sourceUrl) {
    return;
  }
  openImagePreview(submissionId, decodeURIComponent(sourceUrl), {
    allowAnnotate: false,
    enableTransforms: false,
    title: actionBtn.dataset.previewTitle || "图片预览",
    tip: actionBtn.dataset.previewTip || "这里只提供放大预览，不会修改原图。",
  });
}

function renderHistorySyncBoard(rows = getFilteredHistoryRows()) {
  const holder = ui["history-sync-list"];
  const stats = ui["history-sync-stats"];
  if (!holder || !stats) {
    return;
  }

  const reviewedCount = rows.filter((item) => myReviewMap.has(item.id)).length;
  const annotatedCount = rows.filter((item) => (myAnnotationMap.get(item.id) ?? []).length > 0).length;
  stats.innerHTML = [
    `<span class="history-sync-stat">共 ${rows.length} 条</span>`,
    `<span class="history-sync-stat">已处理 ${reviewedCount}</span>`,
    `<span class="history-sync-stat">待处理 ${Math.max(0, rows.length - reviewedCount)}</span>`,
    `<span class="history-sync-stat">有批注 ${annotatedCount}</span>`,
  ].join("");

  if (!rows.length) {
    holder.innerHTML = '<p class="muted">当前筛选下暂无同步记录。</p>';
    return;
  }

  holder.innerHTML = rows
    .slice()
    .sort((a, b) => {
      const leftReview = myReviewMap.get(a.id);
      const rightReview = myReviewMap.get(b.id);
      const leftKey = String(leftReview?.updated_at || leftReview?.created_at || a.created_at || "");
      const rightKey = String(rightReview?.updated_at || rightReview?.created_at || b.created_at || "");
      return rightKey.localeCompare(leftKey);
    })
    .map((row) => buildStudentSyncCard(row))
    .join("");
}

function renderHistoryModuleTabs() {
  const wrap = ui["history-module-tabs"];
  if (!wrap) {
    return;
  }
  const buttons = wrap.querySelectorAll("button[data-module]");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-module") === historyModuleFilter);
  });
}

function renderHistoryList() {
  const holder = ui["history-list"];
  if (!holder) {
    return;
  }
  holder.innerHTML = "";

  const rows = getFilteredHistoryRows();
  renderHistoryFilterState(rows);
  renderHistorySyncBoard(rows);

  if (!rows.length) {
    holder.innerHTML = '<p class="muted">当前筛选下暂无提交记录。</p>';
    return;
  }

  holder.innerHTML = rows
    .slice()
    .sort((a, b) => {
      if (a.study_date !== b.study_date) {
        return b.study_date.localeCompare(a.study_date);
      }
      return String(b.created_at).localeCompare(String(a.created_at));
    })
    .map((row) => buildStudentHistoryCard(row, { active: row.id === historyHighlightedSubmissionId }))
    .join("");
}

async function loadTeacherData(keepSelection = false) {
  const day = ui["teacher-date"].value;
  const module = ui["teacher-module"].value;

  let query = supabase
    .from("submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(120);

  if (day) {
    query = query.eq("study_date", day);
  }
  if (module && module !== "all") {
    query = query.eq("module", module);
  }

  const { data, error } = await query;
  if (error) {
    showAlert(`读取提交列表失败: ${error.message}`, "error");
    return;
  }

  submissionCache = data ?? [];
  annotationMapBySubmission = await loadAnnotationMap(submissionCache.map((x) => x.id));
  teacherReviewMap = await loadReviewMap(submissionCache.map((x) => x.id));

  renderTeacherSubmissionList();
  renderTeacherSavedReviewList();
  renderTeacherCalendarStudentOptions();

  if (selectedSubmissionId) {
    const exists = submissionCache.some((x) => x.id === selectedSubmissionId);
    if (exists) {
      await selectSubmissionForReview(selectedSubmissionId, keepSelection);
    } else {
      clearReviewEditor();
    }
    return;
  }

  clearReviewEditor();
}

function renderTeacherSubmissionList() {
  const list = ui["teacher-review-list"];
  list.innerHTML = "";

  if (!submissionCache.length) {
    list.innerHTML = `<p class="muted">当前筛选条件下还没有待批改作业。</p>`;
    return;
  }

  const byDay = new Map();
  for (const row of submissionCache) {
    if (!byDay.has(row.study_date)) {
      byDay.set(row.study_date, []);
    }
    byDay.get(row.study_date).push(row);
  }

  const today = toIsoDate(new Date());
  const dayEntries = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  for (const [day, rows] of dayEntries) {
    const isToday = day === today;
    const dayWrap = document.createElement("details");
    dayWrap.className = `submission-day${isToday ? " is-today" : ""}`;
    if (isToday || rows.some((x) => x.id === selectedSubmissionId)) {
      dayWrap.open = true;
    }

    const passed = rows.filter((x) => x.review_status === "passed").length;
    const returned = rows.filter((x) => x.review_status === "returned").length;
    const pending = rows.length - passed - returned;

    const daySummary = document.createElement("summary");
    daySummary.className = "submission-day-summary";
    daySummary.innerHTML = `
      <span class="submission-day-title"><strong>${day}</strong>${renderTodayBadge(day)}</span>
      <span class="submission-day-metrics">通过 ${passed} / 退回 ${returned} / 待处理 ${pending}</span>
    `;
    dayWrap.appendChild(daySummary);

    const dayItems = document.createElement("div");
    dayItems.className = "submission-day-items";

    for (const row of rows) {
      const fold = document.createElement("details");
      fold.className = "submission-fold";
      if (row.id === selectedSubmissionId) {
        fold.open = true;
      }

      const coverage = getAnnotationCoverage(row.id, row.image_urls ?? []);
      const imgCount = coverage.totalImages;
      const snippet = summarizeText(row.content, 200) || "No text content.";
      const coverageText = imgCount === 0
        ? "No image"
        : coverage.annotatedSources === 0
        ? "Not annotated"
        : coverage.annotatedSources === imgCount
        ? `Annotated ${coverage.annotatedSources}/${imgCount}`
        : `Partial ${coverage.annotatedSources}/${imgCount}`;
      const coverageTone = coverage.state === "full" ? "is-full" : coverage.state === "none" ? "is-none" : "is-partial";
      const deleteBtn = isAdminUser()
        ? `<button class="btn btn-danger btn-small" type="button" data-delete-submission-id="${row.id}" title="Delete this submission">Delete</button>`
        : "";

      fold.innerHTML = `
        <summary class="submission-fold-summary">
          <div class="submission-fold-main">
            <span><strong>${escapeHtml(displayName(row.student_id))}</strong> · ${MODULE_LABELS[row.module] ?? row.module}</span>
            <div class="submission-fold-pills">
              <span class="submission-mini-pill">Images ${imgCount}</span>
              <span class="submission-mini-pill ${coverageTone}">${escapeHtml(coverageText)}</span>
              ${renderTodayBadge(row.study_date)}
            </div>
          </div>
          <span class="status-chip ${statusClass(row.review_status)}">${STATUS_LABELS[row.review_status] ?? row.review_status}</span>
        </summary>
        <div class="submission-fold-body">
          <p class="submission-meta">${imgCount > 0 ? `Annotated sources ${coverage.annotatedSources}/${imgCount}` : "No image to annotate"} · Mark files ${coverage.totalAnnotations}</p>
          <p class="submission-content">${escapeHtml(snippet)}</p>
          ${renderImageThumbs(row.image_urls ?? [], true)}
          <div class="inline-actions">
            <button class="btn btn-ghost" type="button" data-review-id="${row.id}" title="Open this submission in the workbench">Open</button>
            ${deleteBtn}
          </div>
        </div>
      `;

      dayItems.appendChild(fold);
    }

    dayWrap.appendChild(dayItems);
    list.appendChild(dayWrap);
  }
}

function renderTeacherSavedReviewList() {
  const holder = ui["saved-review-list"];
  if (!holder) {
    return;
  }
  holder.innerHTML = "";

  if (!submissionCache.length || teacherReviewMap.size === 0) {
    holder.innerHTML = `<p class="muted">还没有已保存的批改记录。</p>`;
    return;
  }

  const rows = submissionCache
    .map((submission) => {
      const review = teacherReviewMap.get(submission.id);
      if (!review) {
        return null;
      }
      if (review.teacher_id && review.teacher_id !== currentSession.user.id) {
        return null;
      }
      return { submission, review };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const at = String(a.review.updated_at || a.review.created_at || "");
      const bt = String(b.review.updated_at || b.review.created_at || "");
      return bt.localeCompare(at);
    });

  if (!rows.length) {
    holder.innerHTML = `<p class="muted">当前筛选条件下没有已保存记录。</p>`;
    return;
  }

  for (const row of rows.slice(0, 80)) {
    const review = row.review;
    const submission = row.submission;
    const savedTime = formatDateTime(review.updated_at || review.created_at);
    const status = review.status || submission.review_status || "pending";
    const score = Number.isFinite(Number(review.score)) ? Number(review.score) : "-";
    const snippet = String(review.comment || "").trim().slice(0, 120);
    const isToday = isTodayDate(submission.study_date);

    const item = document.createElement("article");
    item.className = "translation-attempt-card";
    if (submission.id === selectedSubmissionId) {
      item.classList.add("active");
    }
    if (isToday) {
      item.classList.add("is-today");
    }
    item.innerHTML = `
      <div class="translation-attempt-head">
        <div>
          <strong>${escapeHtml(displayName(submission.student_id))}</strong>
          <p class="translation-attempt-meta">${escapeHtml(submission.study_date)} · ${escapeHtml(MODULE_LABELS[submission.module] ?? submission.module)} · Score ${escapeHtml(String(score))}</p>
        </div>
        <div class="inline-actions">
          ${renderTodayBadge(submission.study_date)}
          <span class="status-chip ${statusClass(status)}">${STATUS_LABELS[status] ?? status}</span>
        </div>
      </div>
      <p class="translation-attempt-snippet">${escapeHtml(snippet || "(No comment)")}</p>
      <div class="inline-actions">
        <span class="muted">Saved at: ${escapeHtml(savedTime)}</span>
        <button class="btn btn-ghost btn-small" type="button" data-saved-review-id="${submission.id}" title="Return to this saved review">Open</button>
      </div>
    `;
    holder.appendChild(item);
  }
}

async function selectSubmissionForReview(submissionId, keepStatus = false) {
  selectedSubmissionId = submissionId;
  renderTeacherSubmissionList();
  renderTeacherSavedReviewList();

  const item = submissionCache.find((x) => x.id === submissionId);
  if (!item) {
    clearReviewEditor();
    return;
  }

  ui["review-target"].textContent = `当前作业：${displayName(item.student_id)} · ${item.study_date} · ${MODULE_LABELS[item.module] ?? item.module}`;
  ui["review-selection-stats"].innerHTML = buildReviewSelectionStatsMarkup(item);
  ui["review-images"].innerHTML = renderReviewImageActions(item.image_urls ?? [], submissionId);
  renderReviewAnnotations(submissionId);

  if (!keepStatus) {
    ui["review-status"].value = item.review_status ?? "pending";
    ui["review-score"].value = 80;
    ui["review-comment"].value = "";
  }

  const cachedReview = teacherReviewMap.get(submissionId);
  if (cachedReview) {
    if (!keepStatus) {
      ui["review-status"].value = cachedReview.status ?? item.review_status ?? "pending";
      ui["review-score"].value = cachedReview.score ?? 80;
      ui["review-comment"].value = cachedReview.comment ?? "";
    }
    ui["review-last-saved"].textContent = `最近保存：${formatDateTime(cachedReview.updated_at || cachedReview.created_at)}`;
  } else {
    ui["review-last-saved"].textContent = "最近保存：-";
  }

  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("submission_id", submissionId)
    .maybeSingle();

  if (error) {
    showAlert(`Failed to load review history: ${error.message}`, "error");
    restoreReviewDraftForSelection();
    return;
  }

  if (data) {
    teacherReviewMap.set(submissionId, data);
    if (!keepStatus) {
      ui["review-status"].value = data.status ?? "pending";
      ui["review-score"].value = data.score ?? 80;
      ui["review-comment"].value = data.comment ?? "";
    }
    ui["review-last-saved"].textContent = `最近保存：${formatDateTime(data.updated_at || data.created_at)}`;
    renderTeacherSavedReviewList();
  }

  ui["review-selection-stats"].innerHTML = buildReviewSelectionStatsMarkup(item);
  restoreReviewDraftForSelection();
}

function renderReviewImageActions(urls, submissionId) {
  if (!urls.length) {
    return renderReviewPlaceholder("这条作业没有上传图片。");
  }

  const sourceMap = getAnnotationSourceMap(submissionId);
  return `<div class="review-source-grid">${urls
    .map((url, index) => {
      const safe = escapeAttr(url);
      const encoded = encodeURIComponent(url);
      const related = sourceMap.get(url) ?? [];
      const label = `Image ${index + 1}`;
      const statusLabel = related.length ? `已批注 ${related.length}` : "Pending";
      const noteText = related.length
        ? summarizeText(related.map((item) => item.note).filter(Boolean).join("; "), 48) || "Already marked. You can continue editing."
        : "这张图还没有批注，可以直接进入批注工作台。";
      return `<article class="review-source-card ${related.length ? "is-annotated" : "is-pending"}">
        <div class="review-source-media">
          <img class="review-source-img" src="${safe}" alt="${escapeAttr(label)}" />
          <span class="review-source-index">${label}</span>
          <span class="review-source-state ${related.length ? "done" : "pending"}">${statusLabel}</span>
        </div>
        <div class="review-source-body">
          <div class="review-source-meta">
            <strong>${label}</strong>
            <span>${related.length ? "继续批注" : "待开始"}</span>
          </div>
          <p class="review-source-note">${escapeHtml(noteText)}</p>
          <div class="thumb-tool-row review-source-actions">
            <button
              type="button"
              class="btn btn-ghost btn-small annot-btn"
              data-open-preview="1"
              data-submission-id="${submissionId}"
              data-source-url="${encoded}"
              title="仅查看原图大图"
            >Preview</button>
            <button
              type="button"
              class="btn btn-ghost btn-small annot-btn"
              data-open-annot="1"
              data-submission-id="${submissionId}"
              data-source-url="${encoded}"
              title="进入图片批注工作台"
            >${related.length ? "Annotate More" : "Annotate"}</button>
          </div>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function renderReviewAnnotations(submissionId) {
  const holder = ui["review-annotations"];
  const list = annotationMapBySubmission.get(submissionId) ?? [];

  if (!list.length) {
    holder.innerHTML = renderReviewPlaceholder("已保存的批注图会显示在这里。");
    return;
  }

  holder.innerHTML = renderAnnotationThumbs(list, false, {
    editable: currentProfile?.role === "teacher" || currentProfile?.role === "teammate",
    submissionId,
  });
}

function clearReviewEditor() {
  selectedSubmissionId = null;
  ui["review-target"].textContent = "当前还没有选中作业";
  ui["review-selection-stats"].innerHTML = `<span class="teacher-review-empty-pill">先在左侧选择一条作业</span>`;
  ui["review-images"].innerHTML = renderReviewPlaceholder("Choose a submission to see image status here.");
  ui["review-annotations"].innerHTML = renderReviewPlaceholder("已保存的批注图会显示在这里。");
  ui["review-status"].value = "pending";
  ui["review-score"].value = 80;
  ui["review-comment"].value = "";
  ui["review-last-saved"].textContent = "最近保存：-";
  updateReviewDraftState(null);
}

async function saveReview() {
  if (!selectedSubmissionId) {
    showAlert("请先选择一条提交。", "error", 5200, true);
    return;
  }

  if (!confirmAction("确认保存本条批改？")) {
    return;
  }

  await withButtonBusy(ui["save-review-btn"], "保存中...", async () => {
    const score = Number.parseInt(ui["review-score"].value, 10);
    const status = ui["review-status"].value;
    const comment = ui["review-comment"].value.trim();

    if (!Number.isInteger(score) || score < 0 || score > 100) {
      throw new Error("分数必须在 0-100 之间。");
    }
    if (!comment) {
      throw new Error("请填写评语。");
    }

    showAlert("正在保存批改（写入评语与状态）...", "info", 1800, true);
    const reviewPayload = {
      submission_id: selectedSubmissionId,
      teacher_id: currentSession.user.id,
      score,
      status,
      comment,
    };
    const reviewResult = await saveReviewRecordWithVerification(reviewPayload);
    if (reviewResult.error) {
      throw reviewResult.error;
    }

    const statusResult = await updateSubmissionReviewStatusWithVerification(selectedSubmissionId, status);
    if (statusResult.error) {
      throw statusResult.error;
    }

    const idx = submissionCache.findIndex((item) => item.id === selectedSubmissionId);
    if (idx >= 0) {
      submissionCache[idx] = {
        ...submissionCache[idx],
        review_status: status,
      };
    }
    const savedReview = reviewResult.data || {
      submission_id: selectedSubmissionId,
      teacher_id: currentSession.user.id,
      score,
      status,
      comment,
      updated_at: new Date().toISOString(),
    };
    teacherReviewMap.set(selectedSubmissionId, savedReview);
    renderTeacherSubmissionList();
    renderTeacherSavedReviewList();
    ui["review-last-saved"].textContent =
      `最近提交：${formatDateTime(savedReview.updated_at || savedReview.created_at || new Date().toISOString())}`;
    clearReviewDraftBySubmission(selectedSubmissionId);

    // Keep UX responsive: run full refresh in background.
    void loadTeacherData(true);
    showAlert(
      reviewResult.recovered || statusResult.recovered
        ? "批改保存成功，网络较慢但系统已自动校验写入成功。"
        : "批改保存成功，已进入“已提交批改记录”。",
      "info",
      3400,
      true
    );
  }).catch((error) => {
    showAlert(`批改保存失败: ${error.message}`, "error", 6500, true);
  });
}

async function deleteSubmissionAsAdmin(submissionId) {
  if (!isAdminUser()) {
    showAlert("仅管理员账号可删除提交记录。", "error", 4600, true);
    return;
  }

  const row = submissionCache.find((x) => x.id === submissionId);
  if (!row) {
    showAlert("未找到该提交记录，请先刷新列表。", "error", 4200, true);
    return;
  }

  const title = `${displayName(row.student_id)} · ${row.study_date} · ${MODULE_LABELS[row.module] ?? row.module}`;
  if (!confirmAction(`确认删除这条提交记录？\n${title}\n删除后无法恢复。`)) {
    return;
  }

  await withButtonBusy(ui["teacher-load-btn"], "删除中...", async () => {
    const paths = (row.image_urls ?? [])
      .map((url) => extractSubmissionStoragePath(url))
      .filter(Boolean);
    if (paths.length) {
      const uniquePaths = [...new Set(paths)];
      const { error: removeErr } = await supabase.storage.from(SUBMISSION_BUCKET).remove(uniquePaths);
      if (removeErr) {
        showAlert(`图片清理失败（已继续删除记录）: ${removeErr.message}`, "error", 5200, true);
      }
    }

    const { error } = await withTimeout(
      supabase
        .from("submissions")
        .delete()
        .eq("id", submissionId),
      22000,
      "删除提交记录超时"
    );

    if (error) {
      throw error;
    }

    if (selectedSubmissionId === submissionId) {
      clearReviewEditor();
    }
    showAlert("提交记录已删除。", "info", 3200, true);
    await loadTeacherData();
  }).catch((error) => {
    showAlert(`删除提交记录失败: ${error.message}`, "error", 6500, true);
  });
}

async function saveStudentReflection() {
  await withButtonBusy(ui["save-reflection-btn"], "提交中...", async () => {
    const date = ui["reflection-date"].value;
    const focus = ui["reflection-focus"].value.trim();
    const content = ui["reflection-content"].value.trim();

    if (!date || !content) {
      throw new Error("请填写复盘日期和复盘内容。");
    }

    const { error } = await supabase.from("daily_reflections").upsert(
      {
        student_id: currentSession.user.id,
        reflection_date: date,
        focus,
        content,
      },
      { onConflict: "student_id,reflection_date" }
    );

    if (error) {
      throw error;
    }

    ui["reflection-content"].value = "";
    showAlert("复盘提交成功。", "info");
    await loadStudentReflections();
  }).catch((error) => {
    showAlert(`复盘提交失败: ${error.message}`, "error");
  });
}

async function loadStudentReflections() {
  const studentId = currentSession.user.id;
  const { data, error } = await supabase
    .from("daily_reflections")
    .select("*")
    .eq("student_id", studentId)
    .order("reflection_date", { ascending: false })
    .limit(45);

  if (error) {
    showAlert(`读取复盘失败: ${error.message}`, "error");
    return;
  }

  const reflections = data ?? [];
  const ids = reflections.map((x) => x.id);
  const commentMap = await loadReflectionCommentMap(ids);

  const holder = ui["student-reflection-list"];
  holder.innerHTML = "";

  if (!reflections.length) {
    holder.innerHTML = "<p class=\"muted\">还没有复盘记录。</p>";
    return;
  }

  for (const row of reflections) {
    const commentRow = commentMap.get(row.id);
    const card = document.createElement("article");
    card.className = "reflection-card";
    card.innerHTML = `
      <div class="reflection-head">
        <strong>${row.reflection_date}</strong>
        <span>${escapeHtml(row.focus || "未填写重点")}</span>
      </div>
      <div class="reflection-body">${escapeHtml(row.content)}</div>
      <div class="reflection-teacher-note">
        <strong>老师批注：</strong>${escapeHtml(commentRow?.comment || "暂无批注")}
      </div>
    `;
    holder.appendChild(card);
  }
}

async function loadTeacherReflections() {
  const date = ui["reflection-filter-date"].value;
  const studentId = ui["reflection-filter-student"].value;

  let query = supabase
    .from("daily_reflections")
    .select("*")
    .order("reflection_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(120);

  if (date) {
    query = query.eq("reflection_date", date);
  }
  if (studentId && studentId !== "all") {
    query = query.eq("student_id", studentId);
  }

  const { data, error } = await query;
  if (error) {
    showAlert(`读取复盘列表失败: ${error.message}`, "error");
    return;
  }

  reflectionCache = data ?? [];
  reflectionCommentMap = await loadReflectionCommentMap(reflectionCache.map((x) => x.id));
  renderTeacherReflectionList();

  if (selectedReflectionId) {
    const stillExists = reflectionCache.some((x) => x.id === selectedReflectionId);
    if (stillExists) {
      selectTeacherReflection(selectedReflectionId);
    } else {
      selectedReflectionId = null;
      ui["reflection-target"].textContent = "当前未选择复盘";
      ui["reflection-comment"].value = "";
    }
  }
}

async function loadReflectionCommentMap(reflectionIds) {
  const map = new Map();
  if (!reflectionIds.length) {
    return map;
  }

  const { data, error } = await supabase
    .from("reflection_comments")
    .select("*")
    .in("reflection_id", reflectionIds);

  if (error) {
    showAlert(`读取复盘批注失败: ${error.message}`, "error");
    return map;
  }

  for (const row of data ?? []) {
    map.set(row.reflection_id, row);
  }

  return map;
}

function renderTeacherReflectionList() {
  const holder = ui["teacher-reflection-list"];
  holder.innerHTML = "";

  if (!reflectionCache.length) {
    holder.innerHTML = "<p class=\"muted\">当前筛选下没有复盘。</p>";
    return;
  }

  for (const row of reflectionCache) {
    const comment = reflectionCommentMap.get(row.id);
    const card = document.createElement("article");
    card.className = "submission-card";
    if (row.id === selectedReflectionId) {
      card.classList.add("active");
    }

    const snippet = summarizeText(row.content, 180) || "No reflection content.";
    card.innerHTML = `
      <div class="submission-head">
        <strong>${escapeHtml(displayName(row.student_id))}</strong>
        <span class="submission-meta">${row.reflection_date}</span>
      </div>
      <p class="submission-meta">重点：${escapeHtml(row.focus || "未填写")}</p>
      <p class="submission-content">${escapeHtml(snippet)}</p>
      <p class="muted">批注状态：${comment ? "已批注" : "待批注"}</p>
      <button type="button" class="btn btn-ghost" data-reflection-id="${row.id}" title="选中这条复盘并在下方保存老师批注">选中并批注</button>
    `;

    holder.appendChild(card);
  }
}

function selectTeacherReflection(reflectionId) {
  selectedReflectionId = reflectionId;
  renderTeacherReflectionList();

  const row = reflectionCache.find((x) => x.id === reflectionId);
  if (!row) {
    return;
  }

  const comment = reflectionCommentMap.get(reflectionId);
  ui["reflection-target"].textContent = `当前批注: ${displayName(row.student_id)} · ${row.reflection_date}`;
  ui["reflection-comment"].value = comment?.comment ?? "";
}

async function saveReflectionComment() {
  if (!selectedReflectionId) {
    showAlert("请先选择一条复盘。", "error", 4600, true);
    return;
  }

  const comment = ui["reflection-comment"].value.trim();
  if (!comment) {
    showAlert("请填写复盘批注。", "error", 4600, true);
    return;
  }

  await withButtonBusy(ui["save-reflection-comment-btn"], "保存中...", async () => {
    const { error } = await withTimeout(
      supabase.from("reflection_comments").upsert(
      {
        reflection_id: selectedReflectionId,
        teacher_id: currentSession.user.id,
        comment,
      },
      { onConflict: "reflection_id" }
      ),
      22000,
      "保存复盘批注超时"
    );

    if (error) {
      throw error;
    }

    showAlert("复盘批注保存成功。", "info", 3000, true);
    await loadTeacherReflections();
  }).catch((error) => {
    showAlert(`保存复盘批注失败: ${error.message}`, "error", 6200, true);
  });
}

async function reopenAnnotationForEdit(submissionId, annotationId) {
  const list = annotationMapBySubmission.get(submissionId) ?? [];
  const row = list.find((item) => item.id === annotationId);
  if (!row) {
    showAlert("未找到这条批注记录，请先刷新。", "error", 5200, true);
    return;
  }

  await openAnnotationModal(submissionId, row.source_image_url, {
    annotationId: row.id,
    baseImageUrl: row.annotated_image_url,
    note: row.note || "",
    originalAnnotatedPath: extractAnnotationStoragePath(row.annotated_image_url),
  });
}

async function openAnnotationModal(submissionId, sourceImageUrl, editOptions = null) {
  if (currentProfile.role !== "teacher" && currentProfile.role !== "teammate") {
    showAlert("只有老师或互改同学可以批注图片。", "error");
    return;
  }

  const canvas = ui["annot-canvas"];
  const ctx = canvas.getContext("2d");

  try {
    const isEdit = Boolean(editOptions?.annotationId);
    const baseImageUrl = isEdit ? String(editOptions.baseImageUrl || sourceImageUrl) : sourceImageUrl;
    const image = await loadImageFromUrl(baseImageUrl, true);
    const maxW = Math.min(window.innerWidth * 0.86, 940);
    const maxH = Math.min(window.innerHeight * 0.62, 560);
    const scale = Math.min(1, maxW / image.width, maxH / image.height);
    const width = Math.max(1, Math.floor(image.width * scale));
    const height = Math.max(1, Math.floor(image.height * scale));
    const sourceLabel = describeSubmissionSourceImage(submissionId, sourceImageUrl, "Image");

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    annotState.open = true;
    annotState.submissionId = submissionId;
    annotState.sourceImageUrl = sourceImageUrl;
    annotState.annotationId = isEdit ? String(editOptions.annotationId) : null;
    annotState.originalAnnotatedPath = isEdit ? editOptions.originalAnnotatedPath || null : null;
    annotState.drawing = false;
    annotState.moved = false;
    annotState.history = [canvas.toDataURL("image/png")];

    ui["annot-note"].value = isEdit ? String(editOptions.note || "") : "";
    ui["annot-context"].textContent = buildAnnotationContextText(submissionId, sourceImageUrl);
    ui["annot-modal-title"].textContent = isEdit ? `Annotate · ${sourceLabel} · Edit` : `Annotate · ${sourceLabel}`;
    ui["annot-modal-tip"].textContent = isEdit
      ? "Edit mode overwrites the current annotation and keeps you in the same workbench item."
      : "Draw and save here. After saving, you stay on the same selected submission.";
    ui["annot-save-btn"].textContent = isEdit ? "Update" : "Save";
    ui["annot-save-btn"].title = isEdit ? "Overwrite this annotation" : "Save this annotation";
    ui["annot-modal"].classList.remove("hidden");
  } catch (error) {
    showAlert(`Failed to open annotator: ${error.message}`, "error");
  }
}

function closeAnnotationModal() {
  annotState.open = false;
  annotState.submissionId = null;
  annotState.sourceImageUrl = "";
  annotState.annotationId = null;
  annotState.originalAnnotatedPath = null;
  annotState.drawing = false;
  annotState.moved = false;
  annotState.history = [];
  ui["annot-context"].textContent = "No image locked";
  ui["annot-modal-title"].textContent = "Image Annotation";
  ui["annot-modal-tip"].textContent = "Draw and save here. After saving, you stay on the same selected submission.";
  ui["annot-save-btn"].textContent = "Save";
  ui["annot-save-btn"].title = "Save this annotation";
  ui["annot-modal"].classList.add("hidden");
}

function applyAnnotView() {
  const canvas = ui["annot-canvas"];
  if (!canvas || !canvas.width || !canvas.height) {
    ui["annot-zoom-label"].textContent = "100%";
    return;
  }
  annotState.zoom = Math.min(4, Math.max(0.35, Number(annotState.zoom) || 1));
  canvas.style.width = `${Math.max(1, Math.round(canvas.width * annotState.zoom))}px`;
  canvas.style.height = `${Math.max(1, Math.round(canvas.height * annotState.zoom))}px`;
  ui["annot-zoom-label"].textContent = `${Math.round(annotState.zoom * 100)}%`;
}

function adjustAnnotZoom(delta) {
  if (!annotState.open) {
    return;
  }
  annotState.zoom = Math.min(4, Math.max(0.35, annotState.zoom + delta));
  applyAnnotView();
}

function fitAnnotCanvas() {
  if (!annotState.open) {
    return;
  }
  const canvas = ui["annot-canvas"];
  const wrap = canvas.closest(".annot-canvas-wrap");
  if (!wrap || !canvas.width || !canvas.height) {
    return;
  }
  const styles = window.getComputedStyle(wrap);
  const padX = Number.parseFloat(styles.paddingLeft || "0") + Number.parseFloat(styles.paddingRight || "0");
  const padY = Number.parseFloat(styles.paddingTop || "0") + Number.parseFloat(styles.paddingBottom || "0");
  const availableWidth = Math.max(240, (wrap.clientWidth || Math.floor(window.innerWidth * 0.84)) - padX - 12);
  const availableHeight = Math.max(240, (wrap.clientHeight || Math.floor(window.innerHeight * 0.58)) - padY - 12);
  const fitZoom = Math.min(2, availableWidth / canvas.width, availableHeight / canvas.height);
  annotState.fitZoom = Math.min(2, Math.max(0.35, fitZoom || 1));
  annotState.zoom = annotState.fitZoom;
  applyAnnotView();
}

function pushAnnotHistorySnapshot() {
  const canvas = ui["annot-canvas"];
  if (!canvas || !canvas.width || !canvas.height) {
    return;
  }
  annotState.history.push(canvas.toDataURL("image/png"));
  if (annotState.history.length > 25) {
    annotState.history.splice(1, annotState.history.length - 25);
  }
}
async function transformAnnotationCanvas(transformer, options = {}) {
  if (!annotState.open) {
    return;
  }
  const canvas = ui["annot-canvas"];
  if (!canvas.width || !canvas.height) {
    return;
  }
  const snapshot = canvas.toDataURL("image/png");
  const image = await loadImageFromUrl(snapshot, false);
  const nextCanvas = document.createElement("canvas");
  await transformer(image, nextCanvas);
  const width = Math.max(1, nextCanvas.width || image.width);
  const height = Math.max(1, nextCanvas.height || image.height);
  const ctx = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(nextCanvas, 0, 0, width, height);
  if (options.pushHistory !== false) {
    pushAnnotHistorySnapshot();
  }
  applyAnnotView();
}

async function rotateAnnotation(degrees, options = {}) {
  const normalized = ((degrees % 360) + 360) % 360;
  if (!normalized) {
    return;
  }
  await transformAnnotationCanvas((image, nextCanvas) => {
    const quarterTurn = normalized === 90 || normalized === 270;
    nextCanvas.width = quarterTurn ? image.height : image.width;
    nextCanvas.height = quarterTurn ? image.width : image.height;
    const ctx = nextCanvas.getContext("2d");
    ctx.translate(nextCanvas.width / 2, nextCanvas.height / 2);
    ctx.rotate((normalized * Math.PI) / 180);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
  }, options);
}

async function flipAnnotation(axis, options = {}) {
  if (axis !== "x" && axis !== "y") {
    return;
  }
  await transformAnnotationCanvas((image, nextCanvas) => {
    nextCanvas.width = image.width;
    nextCanvas.height = image.height;
    const ctx = nextCanvas.getContext("2d");
    if (axis === "x") {
      ctx.translate(image.width, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, image.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(image, 0, 0, image.width, image.height);
  }, options);
}

function getAnnotPos(event) {
  const rect = ui["annot-canvas"].getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function onAnnotPointerDown(event) {
  if (!annotState.open) {
    return;
  }

  event.preventDefault();
  const { x, y } = getAnnotPos(event);
  annotState.drawing = true;
  annotState.moved = false;
  annotState.lastX = x;
  annotState.lastY = y;
  ui["annot-canvas"].setPointerCapture(event.pointerId);
}

function onAnnotPointerMove(event) {
  if (!annotState.open || !annotState.drawing) {
    return;
  }

  event.preventDefault();
  const { x, y } = getAnnotPos(event);
  const ctx = ui["annot-canvas"].getContext("2d");

  ctx.strokeStyle = "#d90429";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(annotState.lastX, annotState.lastY);
  ctx.lineTo(x, y);
  ctx.stroke();

  annotState.lastX = x;
  annotState.lastY = y;
  annotState.moved = true;
}

function onAnnotPointerUp(event) {
  if (!annotState.open || !annotState.drawing) {
    return;
  }

  event.preventDefault();
  annotState.drawing = false;

  if (annotState.moved) {
    annotState.history.push(ui["annot-canvas"].toDataURL("image/png"));
    if (annotState.history.length > 25) {
      annotState.history.shift();
    }
  }
}

async function undoAnnotation() {
  if (!annotState.open || annotState.history.length <= 1) {
    return;
  }

  annotState.history.pop();
  const last = annotState.history[annotState.history.length - 1];
  await restoreCanvasSnapshot(last);
}

async function clearAnnotation() {
  if (!annotState.open || annotState.history.length === 0) {
    return;
  }

  const first = annotState.history[0];
  annotState.history = [first];
  await restoreCanvasSnapshot(first);
}

async function restoreCanvasSnapshot(dataUrl) {
  const canvas = ui["annot-canvas"];
  const ctx = canvas.getContext("2d");
  const image = await loadImageFromUrl(dataUrl, false);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

async function saveAnnotationImage() {
  if (!annotState.open || !annotState.submissionId || !annotState.sourceImageUrl) {
    showAlert("There is no image ready to save.", "error", 4600, true);
    return;
  }

  await withButtonBusy(ui["annot-save-btn"], "Saving...", async () => {
    const canvas = ui["annot-canvas"];
    const submissionId = annotState.submissionId;
    const sourceImageUrl = annotState.sourceImageUrl;
    const editingAnnotationId = annotState.annotationId;
    const previousAnnotatedPath = annotState.originalAnnotatedPath;
    const isEdit = Boolean(editingAnnotationId);
    showAlert("正在保存批注（1/3 生成图片）...", "info", 1800, true);
    let contentType = "image/jpeg";
    let ext = "jpg";
    let blob = await canvasToBlob(canvas, contentType, ANNOT_JPEG_QUALITY);
    if (!blob) {
      contentType = "image/png";
      ext = "png";
      blob = await canvasToBlob(canvas, contentType, 0.92);
    }

    if (!blob || blob.size <= 0) {
      throw new Error("Failed to create the annotated image.");
    }

    const stamp = Date.now();
    const path = `${currentSession.user.id}/${submissionId}/${stamp}_annot.${ext}`;
    showAlert("正在保存批注（2/3 上传文件）...", "info", 1800, true);
    await uploadAnnotationBlobWithRetry(path, blob, contentType);

    const { data } = supabase.storage.from(ANNOT_BUCKET).getPublicUrl(path);
    const note = ui["annot-note"].value.trim();
    const payload = {
      submission_id: submissionId,
      teacher_id: currentSession.user.id,
      source_image_url: sourceImageUrl,
      annotated_image_url: data.publicUrl,
      note,
    };

    showAlert("正在保存批注（3/3 写入记录）...", "info", 1800, true);
    const writeResult = await saveAnnotationRecordWithVerification(payload, {
      annotationId: editingAnnotationId,
    });
    if (writeResult.error) {
      throw writeResult.error;
    }

    const savedRow = writeResult.data || {
      ...payload,
      id: editingAnnotationId || `local_${stamp}`,
      created_at: new Date().toISOString(),
    };
    const prev = annotationMapBySubmission.get(submissionId) ?? [];
    if (isEdit) {
      const next = prev.map((item) => (item.id === editingAnnotationId ? { ...item, ...savedRow } : item));
      const found = next.some((item) => item.id === editingAnnotationId);
      annotationMapBySubmission.set(submissionId, found ? next : [savedRow, ...next]);
      if (previousAnnotatedPath && previousAnnotatedPath !== path) {
        void supabase.storage.from(ANNOT_BUCKET).remove([previousAnnotatedPath]);
      }
    } else {
      annotationMapBySubmission.set(submissionId, [savedRow, ...prev]);
    }

    renderTeacherSubmissionList();
    renderTeacherSavedReviewList();
    const selectedRow = findSubmissionRecord(submissionId);
    if (selectedSubmissionId === submissionId && selectedRow) {
      ui["review-images"].innerHTML = renderReviewImageActions(selectedRow.image_urls ?? [], submissionId);
      renderReviewAnnotations(submissionId);
      ui["review-selection-stats"].innerHTML = buildReviewSelectionStatsMarkup(selectedRow);
    }

    closeAnnotationModal();
    showAlert(
      writeResult.recovered
        ? (isEdit ? "批注已更新，虽然网络较慢，但系统已经校验保存成功。" : "批注已保存，虽然网络较慢，但系统已经校验保存成功。")
        : (isEdit ? "批注已更新。" : "批注已保存。"),
      "info",
      3200,
      true
    );

    void loadTeacherData(true);
  }).catch((error) => {
    showAlert(`Failed to save annotation: ${error.message}`, "error", 6500, true);
  });
}

function renderAnnotationThumbs(rows, compact = false, options = {}) {
  if (!rows.length) {
    return renderReviewPlaceholder("还没有已保存的批注文件。");
  }

  const editable = Boolean(options.editable) && !compact;
  const submissionId = String(options.submissionId || "");
  const limit = compact ? 3 : rows.length;
  const picked = rows.slice(0, limit);
  const more = rows.length > limit ? `<span class="more-badge">+${rows.length - limit}</span>` : "";

  const html = picked
    .map((row, idx) => {
      const safe = escapeAttr(row.annotated_image_url);
      const sourceLabel = describeSubmissionSourceImage(submissionId, row.source_image_url, `Image ${idx + 1}`);
      const title = escapeAttr(row.note || sourceLabel);
      const note = row.note
        ? `<span class="annot-note">${escapeHtml(row.note)}</span>`
        : `<span class="annot-note muted">暂无说明</span>`;
      const canEdit = editable && row.id && !String(row.id).startsWith("local_");
      const editBtn = canEdit
        ? `<button class="btn btn-ghost btn-small annot-edit-btn" type="button" data-edit-annot-id="${row.id}" data-submission-id="${submissionId}" title="继续编辑这条批注">继续编辑</button>`
        : "";
      return `<article class="annot-item">
        <a href="${safe}" target="_blank" rel="noreferrer" title="${title}">
          <img class="thumb-img" src="${safe}" alt="annot-${idx + 1}" />
        </a>
        <div class="annot-note-stack">
          <span class="annot-source-tag">${escapeHtml(sourceLabel)}</span>
          ${compact ? "" : note}
        </div>
        ${editBtn}
      </article>`;
    })
    .join("");

  return `<div class="review-annotation-grid">${html}${more}</div>`;
}

function renderImageThumbs(urls, compact = false) {
  if (!urls || urls.length === 0) {
    return "<span class=\"muted\">无</span>";
  }

  const limit = compact ? 3 : urls.length;
  const picked = urls.slice(0, limit);
  const more = urls.length > limit ? `<span class=\"more-badge\">+${urls.length - limit}</span>` : "";

  const html = picked
    .map((url, idx) => {
      const safe = escapeAttr(url);
      return `<a href="${safe}" target="_blank" rel="noreferrer">
        <img class="thumb-img" src="${safe}" alt="img-${idx + 1}" />
      </a>`;
    })
    .join("");

  return `<div class=\"thumb-row\">${html}${more}</div>`;
}

function displayName(userId) {
  const row = allProfiles.get(userId);
  if (!row) {
    return shortId(userId);
  }
  return describeUser(row);
}

function describeUser(profile) {
  if (!profile) {
    return "-";
  }

  const alias = (profile.full_name || "").trim();
  const email = (profile.login_email || "").trim();

  if (alias && email && alias !== email) {
    return `${alias} <${email}>`;
  }

  if (alias) {
    return alias;
  }

  if (email) {
    return email;
  }

  return shortId(profile.id);
}

function shortId(id) {
  if (!id) {
    return "-";
  }
  return `${id.slice(0, 6)}...`;
}

function statusClass(status) {
  if (status === "passed") {
    return "status-passed";
  }
  if (status === "returned") {
    return "status-returned";
  }
  return "status-pending";
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function confirmAction(message) {
  return window.confirm(message);
}

function toErrorMessage(error) {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error.message === "string") {
    return error.message;
  }
  return "未知错误";
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function arraysEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

async function yieldToUi() {
  await new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

function getAdaptivePrepareConcurrency(fileCount = 0) {
  if (fileCount >= 8) {
    return 2;
  }
  return PREPARE_CONCURRENCY;
}

function getAdaptiveUploadConcurrency(fileCount = 0) {
  const downlink = Number(window.navigator?.connection?.downlink || 0);
  if (fileCount >= 7 || (downlink > 0 && downlink < 1.5)) {
    return 1;
  }
  return UPLOAD_CONCURRENCY;
}

function openDraftDb() {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (!draftDbPromise) {
    draftDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DRAFT_DB_STORE)) {
          db.createObjectStore(DRAFT_DB_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("打开草稿缓存失败"));
    }).catch((_error) => null);
  }
  return draftDbPromise;
}

async function draftDbGet(key) {
  const db = await openDraftDb();
  if (!db || !key) {
    return null;
  }
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_DB_STORE, "readonly");
    const request = tx.objectStore(DRAFT_DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("读取草稿缓存失败"));
  }).catch(() => null);
}

async function draftDbPut(key, value) {
  const db = await openDraftDb();
  if (!db || !key) {
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_DB_STORE, "readwrite");
    tx.objectStore(DRAFT_DB_STORE).put({ key, ...value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("写入草稿缓存失败"));
  }).catch(() => null);
}

async function draftDbDelete(key) {
  const db = await openDraftDb();
  if (!db || !key) {
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_DB_STORE, "readwrite");
    tx.objectStore(DRAFT_DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("删除草稿缓存失败"));
  }).catch(() => null);
}

async function persistSubmissionDraftAssets() {
  const key = getSubmissionDraftKey();
  if (!key) {
    return;
  }
  const images = pendingImages.map((item) => ({
    id: item.id,
    name: item.file.name,
    type: item.file.type,
    lastModified: item.file.lastModified || Date.now(),
    blob: item.file,
  }));
  await draftDbPut(key, {
    updatedAt: new Date().toISOString(),
    images,
  });
}

async function loadSubmissionDraftAssets() {
  const key = getSubmissionDraftKey();
  if (!key) {
    return [];
  }
  const record = await draftDbGet(key);
  const images = Array.isArray(record?.images) ? record.images : [];
  return images
    .map((item, index) => {
      if (!item?.blob) {
        return null;
      }
      const fileName = item.name || `draft_${index + 1}.jpg`;
      return new File([item.blob], fileName, {
        type: item.type || item.blob.type || "image/jpeg",
        lastModified: item.lastModified || Date.now(),
      });
    })
    .filter(Boolean);
}

async function clearSubmissionDraftAssets() {
  const key = getSubmissionDraftKey();
  if (!key) {
    return;
  }
  await draftDbDelete(key);
}

function toDateObject(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map((item) => Number(item));
    return new Date(year, month - 1, day);
  }
  const raw = new Date(value || Date.now());
  return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
}

function startOfWeek(date) {
  const raw = toDateObject(date);
  const weekday = (raw.getDay() + 6) % 7;
  return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate() - weekday);
}

function addDays(date, diff) {
  const raw = toDateObject(date);
  return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate() + diff);
}

function startOfMonth(date) {
  const raw = toDateObject(date);
  return new Date(raw.getFullYear(), raw.getMonth(), 1);
}

function addMonths(date, diff) {
  const raw = startOfMonth(date);
  return new Date(raw.getFullYear(), raw.getMonth() + diff, 1);
}

function formatWeekdayShort(date) {
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return labels[toDateObject(date).getDay()];
}

function getMonthRange(date) {
  const start = startOfMonth(date);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return {
    start: toIsoDate(start),
    end: toIsoDate(end),
  };
}

function formatMonthLabel(date) {
  const raw = startOfMonth(date);
  return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarCells(date) {
  const monthStart = startOfMonth(date);
  const firstWeekday = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({ iso: "", day: "" });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const current = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    cells.push({ iso: toIsoDate(current), day });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ iso: "", day: "" });
  }
  return cells;
}

function buildSubmissionCountMap(rows) {
  const countMap = new Map();
  for (const row of rows) {
    const key = row.study_date;
    countMap.set(key, (countMap.get(key) || 0) + 1);
  }
  return countMap;
}

function normalizeCalendarMarkKind(kind) {
  if (kind === "ring" || kind === "done" || kind === "missed") {
    return kind;
  }
  return "none";
}

function nextCalendarMarkKind(currentKind) {
  const idx = CALENDAR_MARK_ORDER.indexOf(currentKind);
  return CALENDAR_MARK_ORDER[(idx + 1 + CALENDAR_MARK_ORDER.length) % CALENDAR_MARK_ORDER.length];
}

function messageEventTitle(eventType) {
  if (eventType === "submission") {
    return "有新的作业提交";
  }
  if (eventType === "review") {
    return "老师已批改作业";
  }
  return "消息提醒";
}

function messagePageLabel(page) {
  if (page === "teacher-review" || page === "teammate-review") {
    return "去批改页";
  }
  if (page === "student-history" || page === "teammate-history") {
    return "去提交记录";
  }
  return "打开";
}

function isMessageSchemaError(error) {
  const msg = toErrorMessage(error);
  return (
    msg.includes("Could not find the table 'public.messages'") ||
    msg.includes("recipient_id") ||
    msg.includes("event_type") ||
    msg.includes("read_at") ||
    msg.includes("link_page")
  );
}

function isCalendarSchemaError(error) {
  const msg = toErrorMessage(error);
  return msg.includes("calendar_marks");
}

function isPathAlreadyExistsError(error) {
  const msg = toErrorMessage(error).toLowerCase();
  return msg.includes("already exists") || msg.includes("duplicate key");
}

function fileLabelForUser(name, index = -1) {
  const raw = String(name || "").trim();
  if (!raw) {
    return index >= 0 ? `第${index + 1}张图片` : "图片";
  }
  const looksRandom = /^[a-f0-9]{20,}\.(png|jpe?g|webp|bmp)$/i.test(raw);
  if (looksRandom) {
    return index >= 0 ? `第${index + 1}张图片` : "图片";
  }
  if (raw.length <= 36) {
    return raw;
  }
  const extIdx = raw.lastIndexOf(".");
  if (extIdx > 0) {
    const ext = raw.slice(extIdx);
    return `${raw.slice(0, 24)}...${ext}`;
  }
  return `${raw.slice(0, 28)}...`;
}

function isTimeoutLikeError(error) {
  const msg = toErrorMessage(error).toLowerCase();
  return msg.includes("超时") || msg.includes("timeout") || msg.includes("timed out");
}

function getUploadTimeoutMs(fileSize = 0, attempt = 1) {
  const mb = Math.max(0.2, Number(fileSize || 0) / (1024 * 1024));
  const baseMs = 32000 + mb * 42000 + (attempt - 1) * 12000;
  return Math.min(UPLOAD_TIMEOUT_MAX_MS, Math.max(UPLOAD_TIMEOUT_MIN_MS, Math.round(baseMs)));
}

function getAnnotationUploadTimeoutMs(fileSize = 0, attempt = 1) {
  const mb = Math.max(0.1, Number(fileSize || 0) / (1024 * 1024));
  const baseMs = 16000 + mb * 26000 + (attempt - 1) * 9000;
  return Math.min(ANNOT_UPLOAD_TIMEOUT_MAX_MS, Math.max(ANNOT_UPLOAD_TIMEOUT_MIN_MS, Math.round(baseMs)));
}

async function uploadAnnotationBlobWithRetry(path, blob, contentType) {
  let attempt = 1;
  let lastError = null;
  const maxAttempts = ANNOT_UPLOAD_MAX_RETRY + 1;

  while (attempt <= maxAttempts) {
    const timeoutMs = getAnnotationUploadTimeoutMs(blob?.size || 0, attempt);
    const { error } = await withTimeout(
      supabase.storage.from(ANNOT_BUCKET).upload(path, blob, {
        upsert: false,
        contentType,
      }),
      timeoutMs,
      `上传批注图超时（第${attempt}次）`
    );

    if (!error || isPathAlreadyExistsError(error)) {
      return;
    }

    lastError = error;
    if (attempt >= maxAttempts || !isRetryableError(error)) {
      break;
    }
    const waitMs = 520 * 2 ** (attempt - 1) + Math.floor(Math.random() * 180);
    await sleep(waitMs);
    attempt += 1;
  }

  throw lastError || new Error("批注图上传失败");
}

function isRetryableError(error) {
  const msg = toErrorMessage(error).toLowerCase();
  return (
    msg.includes("超时") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("temporarily")
  );
}

async function runWithRetry(fn, options = {}) {
  const retries = Math.max(0, options.retries ?? 0);
  const baseDelayMs = Math.max(120, options.baseDelayMs ?? 500);
  const shouldRetry = typeof options.shouldRetry === "function" ? options.shouldRetry : () => true;

  let attempt = 0;
  let lastResult = null;
  while (attempt <= retries) {
    let result;
    try {
      result = await fn(attempt, retries + 1);
    } catch (error) {
      result = { error };
    }
    lastResult = result;
    if (!result?.error || attempt >= retries || !shouldRetry(result.error)) {
      return result;
    }
    const waitMs = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 180);
    await sleep(waitMs);
    attempt += 1;
  }
  return lastResult;
}

function withTimeout(promise, ms, label = "请求超时") {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label}（>${Math.round(ms / 1000)}秒）`));
    }, ms);

    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

async function withButtonBusy(button, busyText, fn) {
  const original = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = busyText;
  }

  try {
    return await fn();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

let alertTimer = null;
function showAlert(message, type = "info", duration = 4600, popup = false) {
  let msg = String(message ?? "");
  if (
    msg.includes("Could not find the table 'public.daily_reflections'") ||
    msg.includes("Could not find the table 'public.reflection_comments'") ||
    msg.includes("Could not find the table 'public.image_annotations'") ||
    msg.includes("Could not find the table 'public.calendar_marks'") ||
    msg.includes("Could not find the table 'public.translation_prompts'") ||
    msg.includes("Could not find the table 'public.translation_attempts'") ||
    msg.includes("Could not find the table 'public.translation_reviews'")
  ) {
    msg = "数据库缺少新表（daily_reflections / reflection_comments / image_annotations / calendar_marks / translation_prompts / translation_attempts / translation_reviews）。请去 Supabase SQL Editor 重新执行最新 schema.sql。";
  } else if (
    msg.includes("function public.set_profile_label") ||
    msg.includes("set_profile_label(")
  ) {
    msg = "数据库缺少 set_profile_label 函数。请去 Supabase SQL Editor 重新执行最新 schema.sql。";
  } else if (
    msg.includes("recipient_id") ||
    msg.includes("event_type") ||
    msg.includes("read_at") ||
    msg.includes("link_page")
  ) {
    msg = "数据库里的 messages 表还是旧结构。请去 Supabase SQL Editor 重新执行最新 schema.sql。";
  } else if (msg.includes("Failed to fetch")) {
    msg = "网络请求失败：可能是 API 地址错误、网络不可达或被浏览器跨域策略拦截。";
  }

  const variant = type === "error" ? "error" : "info";
  const alert = ui["alert"];
  if (alert) {
    alert.textContent = msg;
    alert.classList.remove("hidden", "info", "error");
    alert.classList.add(variant);
  }

  const banner = ui["global-banner"];
  const bannerText = ui["global-banner-text"];
  const bannerIcon = ui["global-banner-icon"];
  if (banner && bannerText && bannerIcon) {
    bannerText.textContent = msg;
    banner.classList.remove("hidden", "info", "error", "show");
    banner.classList.add(variant);
    bannerIcon.textContent = variant === "error" ? "!" : "i";
    // Force reflow for repeated same banner animation.
    void banner.offsetWidth;
    banner.classList.add("show");
  }

  if (alertTimer) {
    clearTimeout(alertTimer);
  }

  alertTimer = setTimeout(() => {
    if (alert) {
      alert.classList.add("hidden");
    }
    if (banner) {
      banner.classList.remove("show");
      setTimeout(() => {
        banner.classList.add("hidden");
      }, 200);
    }
  }, duration);

  // Keep de-dup tracking for high-frequency errors.
  const now = Date.now();
  const tooSoonSameMsg = msg === lastPopupMsg && now - lastPopupAt < 900;
  if (!tooSoonSameMsg) {
    lastPopupMsg = msg;
    lastPopupAt = now;
  }
}
