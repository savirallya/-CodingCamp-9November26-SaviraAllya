/* ============================================================
   js/app.js — Personal Expense Tracker
   No ES module import/export — compatible with file:// URLs.
   ============================================================ */

/* ── 1. Constants & Config ─────────────────────────────────── */

const CATEGORIES = ['Food', 'Transport', 'Bills', 'Shopping', 'Entertainment', 'Other'];

/**
 * Sort comparator functions keyed by sort option value.
 * Transactions are always sorted on a spread copy — stored order is never mutated.
 */
const SORT_OPTIONS = {
  default:        (a, b) => b.insertionIndex - a.insertionIndex,
  'amount-desc':  (a, b) => b.amount - a.amount,
  'amount-asc':   (a, b) => a.amount - b.amount,
  'category-asc': (a, b) => a.category.localeCompare(b.category),
};

/** localStorage key constants */
const LS_KEYS = {
  transactions: 'pet_transactions',
  limit:        'pet_spending_limit',
  theme:        'pet_theme',
};

/* ── 2. AppState (central source of truth) ─────────────────── */

/**
 * @typedef {Object} Transaction
 * @property {string} id             - UUID v4 generated at creation time
 * @property {string} description    - Non-empty text, user-entered
 * @property {number} amount         - Positive float
 * @property {string} category       - One of CATEGORIES
 * @property {string} date           - ISO date string 'YYYY-MM-DD'
 * @property {number} insertionIndex - Monotonically increasing integer
 */

/**
 * @typedef {Object} AppState
 * @property {Transaction[]}    transactions
 * @property {number}           spendingLimit  - 0 means disabled
 * @property {'light'|'dark'}   theme
 * @property {string}           sortOrder
 */

const AppState = {
  transactions:  [],
  spendingLimit: 0,
  theme:         'light',
  sortOrder:     'default',
};

/* ── 3. Storage module ─────────────────────────────────────── */

/**
 * Storage module — wraps localStorage with try/catch (Requirement 8.5).
 *
 * Keys used (see LS_KEYS):
 *   pet_transactions   → JSON string of Transaction[]
 *   pet_spending_limit → JSON string of number
 *   pet_theme          → JSON string of 'light' | 'dark'
 */
const Storage = {
  /**
   * Persist the relevant parts of AppState to localStorage.
   * Write errors are silently swallowed so the app never crashes on save.
   *
   * @param {{ transactions: Transaction[], spendingLimit: number, theme: string }} state
   */
  save(state) {
    try {
      localStorage.setItem(LS_KEYS.transactions, JSON.stringify(state.transactions));
    } catch (_) { /* swallow write errors silently */ }

    try {
      localStorage.setItem(LS_KEYS.limit, JSON.stringify(state.spendingLimit));
    } catch (_) { /* swallow write errors silently */ }

    try {
      localStorage.setItem(LS_KEYS.theme, JSON.stringify(state.theme));
    } catch (_) { /* swallow write errors silently */ }
  },

  /**
   * Load persisted state from localStorage.
   * Returns a Partial<AppState> on success, or null if any read fails
   * (e.g. localStorage unavailable or JSON parse error).
   *
   * If the stored theme is not 'light' or 'dark', it defaults to 'light'.
   *
   * @returns {{ transactions: Transaction[], spendingLimit: number, theme: 'light'|'dark' } | null}
   */
  load() {
    try {
      const transactions = JSON.parse(localStorage.getItem(LS_KEYS.transactions)) || [];
      const spendingLimit = JSON.parse(localStorage.getItem(LS_KEYS.limit)) || 0;
      const rawTheme = JSON.parse(localStorage.getItem(LS_KEYS.theme));
      const theme = (rawTheme === 'light' || rawTheme === 'dark') ? rawTheme : 'light';

      return { transactions, spendingLimit, theme };
    } catch (_) {
      return null;
    }
  },
};

/* ── 4. Validation module ──────────────────────────────────── */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {{ description?: string, amount?: string, category?: string, date?: string }} errors
 */

const Validation = {
  /**
   * Returns true if value is a string with at least one non-whitespace character.
   * @param {*} value
   * @returns {boolean}
   */
  isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  },

  /**
   * Returns true if parseFloat(value) is a finite, positive number
   * (not NaN, not Infinity, not <= 0).
   * @param {*} value
   * @returns {boolean}
   */
  isPositiveNumber(value) {
    const n = parseFloat(value);
    return isFinite(n) && n > 0;
  },

  /**
   * Returns true if value is one of the CATEGORIES array.
   * @param {*} value
   * @returns {boolean}
   */
  isValidCategory(value) {
    return CATEGORIES.includes(value);
  },

  /**
   * Returns true if value is a non-empty string
   * (date input already enforces format).
   * @param {*} value
   * @returns {boolean}
   */
  isValidDate(value) {
    return Validation.isNonEmptyString(value);
  },

  /**
   * Validates all transaction form fields.
   * @param {{ description: string, amount: string, category: string, date: string }} fields
   * @returns {ValidationResult}
   */
  validateTransaction(fields) {
    const errors = {};

    // Validate description
    if (!Validation.isNonEmptyString(fields.description)) {
      errors.description = 'Description is required.';
    }

    // Validate amount
    const rawAmount = typeof fields.amount === 'string' ? fields.amount.trim() : String(fields.amount ?? '');
    if (rawAmount === '') {
      errors.amount = 'Amount is required.';
    } else if (!Validation.isPositiveNumber(rawAmount)) {
      errors.amount = 'Amount must be greater than zero.';
    }

    // Validate category
    if (!Validation.isValidCategory(fields.category)) {
      errors.category = 'Please select a category.';
    }

    // Validate date
    if (!Validation.isValidDate(fields.date)) {
      errors.date = 'Date is required.';
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  },
};

/* ── 5. State mutation functions ───────────────────────────── */

/**
 * Maps form field names to their DOM input/select IDs and error span IDs.
 */
const FIELD_MAP = {
  description: { inputId: 'desc',     errorId: 'desc-error'     },
  amount:      { inputId: 'amount',   errorId: 'amount-error'   },
  category:    { inputId: 'category', errorId: 'category-error' },
  date:        { inputId: 'date',     errorId: 'date-error'     },
};

/**
 * Renders validation error messages into the DOM.
 * Adds the 'invalid' CSS class to inputs with errors, removes it from valid inputs.
 *
 * @param {{ description?: string, amount?: string, category?: string, date?: string }} errors
 */
function renderValidationErrors(errors) {
  Object.entries(FIELD_MAP).forEach(([field, { inputId, errorId }]) => {
    const input = document.getElementById(inputId);
    const errorSpan = document.getElementById(errorId);
    const message = errors[field];

    if (message) {
      if (input)     input.classList.add('invalid');
      if (errorSpan) errorSpan.textContent = message;
    } else {
      if (input)     input.classList.remove('invalid');
      if (errorSpan) errorSpan.textContent = '';
    }
  });
}

/**
 * Clears all validation error messages and removes 'invalid' CSS class from all inputs.
 */
function clearValidationErrors() {
  Object.values(FIELD_MAP).forEach(({ inputId, errorId }) => {
    const input = document.getElementById(inputId);
    const errorSpan = document.getElementById(errorId);
    if (input)     input.classList.remove('invalid');
    if (errorSpan) errorSpan.textContent = '';
  });
}

/**
 * Adds a new transaction from the given form fields.
 * Validates first; renders errors and returns early if invalid.
 * On success: pushes to AppState, persists, re-renders, and resets the form.
 *
 * @param {{ description: string, amount: string, category: string, date: string }} fields
 */
function addTransaction(fields) {
  const result = Validation.validateTransaction(fields);

  if (!result.valid) {
    renderValidationErrors(result.errors);
    return;
  }

  // Build the new Transaction object
  const transaction = {
    id:             crypto.randomUUID(),
    description:    fields.description.trim(),
    amount:         parseFloat(fields.amount),
    category:       fields.category,
    date:           fields.date,
    insertionIndex: AppState.transactions.length,
  };

  AppState.transactions.push(transaction);

  Storage.save(AppState);
  renderList();
  renderSummary();

  // Reset form fields and clear any lingering error state
  document.getElementById('desc').value     = '';
  document.getElementById('amount').value   = '';
  document.getElementById('category').value = '';
  document.getElementById('date').value     = '';
  clearValidationErrors();
}

/**
 * Deletes a transaction by id.
 * Filters out the matching transaction, persists state, and re-renders.
 *
 * @param {string} id
 */
function deleteTransaction(id) {
  AppState.transactions = AppState.transactions.filter((tx) => tx.id !== id);
  Storage.save(AppState);
  renderList();
  renderSummary();
}

/**
 * Sets the spending limit.
 * Values <= 0 or empty reset the limit to 0 (disabled).
 *
 * @param {string|number} value
 */
function setSpendingLimit(value) {
  const parsed = parseFloat(value);
  AppState.spendingLimit = (isFinite(parsed) && parsed > 0) ? parsed : 0;
  Storage.save(AppState);
  renderList();
  renderSummary();
}

/**
 * Toggles or sets the active theme ('light' | 'dark').
 * Updates the document root attribute, button label, and persists state.
 *
 * @param {'light'|'dark'} [theme]
 */
function setTheme(theme) {
  const nextTheme = (theme === 'light' || theme === 'dark')
    ? theme
    : (AppState.theme === 'dark' ? 'light' : 'dark');

  AppState.theme = nextTheme;
  document.documentElement.setAttribute('data-theme', nextTheme);

  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.textContent = nextTheme === 'dark' ? '☀️' : '🌙';
    themeBtn.setAttribute(
      'aria-label',
      nextTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
    );
  }

  Storage.save(AppState);
}

/**
 * Sets the active sort order and re-renders the transaction list.
 *
 * @param {string} order
 */
function setSort(order) {
  AppState.sortOrder = SORT_OPTIONS[order] ? order : 'default';
  renderList();
}

/* ── 6. Render functions ───────────────────────────────────── */

/**
 * Formats a numeric amount into a currency string.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Escapes HTML special characters to prevent XSS when rendering user input.
 * @param {string} text
 * @returns {string}
 */
function escapeHTML(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Renders the total spending summary and updates over-limit status indicators.
 */
function renderSummary() {
  const total = AppState.transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const isOverLimit = AppState.spendingLimit > 0 && total > AppState.spendingLimit;

  const totalEl = document.getElementById('total-display');
  if (totalEl) {
    totalEl.textContent = formatCurrency(total);
  }

  const summaryCard = document.getElementById('summary-card');
  if (summaryCard) {
    summaryCard.classList.toggle('over-limit', isOverLimit);
  }

  const warningEl = document.getElementById('limit-warning');
  if (warningEl) {
    warningEl.hidden = !isOverLimit;
  }
}

/**
 * Renders the sorted transaction list into the DOM.
 * Highlights individual transactions whose amount exceeds AppState.spendingLimit.
 */
function renderList() {
  const listEl = document.getElementById('transaction-list');
  if (!listEl) return;

  const comparator = SORT_OPTIONS[AppState.sortOrder] || SORT_OPTIONS.default;
  const sorted = [...AppState.transactions].sort(comparator);

  if (sorted.length === 0) {
    listEl.innerHTML = '<li class="empty-state">No transactions yet. Add one above!</li>';
    return;
  }

  listEl.innerHTML = sorted.map((tx) => {
    const isOverLimit = AppState.spendingLimit > 0 && tx.amount > AppState.spendingLimit;
    return `
      <li class="transaction-item${isOverLimit ? ' over-limit' : ''}" data-id="${escapeHTML(tx.id)}">
        <div class="transaction-info">
          <span class="transaction-desc">${escapeHTML(tx.description)}</span>
          <div class="transaction-meta">
            <span class="category-badge">${escapeHTML(tx.category)}</span>
            <span class="transaction-date">${escapeHTML(tx.date)}</span>
            ${isOverLimit ? '<span class="limit-badge">Over Limit</span>' : ''}
          </div>
        </div>
        <div class="transaction-actions">
          <span class="transaction-amount">${formatCurrency(tx.amount)}</span>
          <button
            type="button"
            class="delete-btn"
            data-id="${escapeHTML(tx.id)}"
            aria-label="Delete ${escapeHTML(tx.description)}"
          >Delete</button>
        </div>
      </li>
    `;
  }).join('');
}

/* ── 7. Event handlers ─────────────────────────────────────── */

/**
 * Attaches all DOM event listeners for form submission, deletion,
 * spending limit updates, sorting, and theme toggling.
 */
function bindEvents() {
  // Transaction form submission
  const formEl = document.getElementById('transaction-form');
  if (formEl) {
    formEl.addEventListener('submit', (event) => {
      event.preventDefault();
      addTransaction({
        description: document.getElementById('desc')?.value ?? '',
        amount:      document.getElementById('amount')?.value ?? '',
        category:    document.getElementById('category')?.value ?? '',
        date:        document.getElementById('date')?.value ?? '',
      });
    });
  }

  // Delegated delete button click on transaction list
  const listEl = document.getElementById('transaction-list');
  if (listEl) {
    listEl.addEventListener('click', (event) => {
      const btn = event.target.closest('.delete-btn');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (id) deleteTransaction(id);
    });
  }

  // Spending limit live input & change
  const limitInput = document.getElementById('spending-limit');
  if (limitInput) {
    limitInput.addEventListener('input', () => {
      setSpendingLimit(limitInput.value);
    });
    limitInput.addEventListener('change', () => {
      setSpendingLimit(limitInput.value);
    });
  }

  // Sort select change
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (event) => {
      setSort(event.target.value);
    });
  }

  // Dark / light theme toggle
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      setTheme();
    });
  }
}

/* ── 8. App init ───────────────────────────────────────────── */

/**
 * Bootstraps the application: loads persisted state, applies theme,
 * syncs UI controls, binds event listeners, and renders initial views.
 */
function initApp() {
  const saved = Storage.load();
  if (saved) {
    AppState.transactions  = Array.isArray(saved.transactions) ? saved.transactions : [];
    AppState.spendingLimit = typeof saved.spendingLimit === 'number' ? saved.spendingLimit : 0;
    AppState.theme         = saved.theme;
  }

  setTheme(AppState.theme);

  const limitInput = document.getElementById('spending-limit');
  if (limitInput && AppState.spendingLimit > 0) {
    limitInput.value = AppState.spendingLimit;
  }

  bindEvents();
  renderSummary();
  renderList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}