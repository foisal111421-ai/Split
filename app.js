/* ========================================
   SplitLedger — Application Logic
   ======================================== */

(function () {
    'use strict';

    // ───────── Data Layer ─────────

    const STORAGE_KEYS = {
        users: 'sl_users',
        transactions: 'sl_transactions',
        settings: 'sl_settings',
        reminders: 'sl_reminders',
        deletedUsers: 'sl_deleted_users'
    };

    const CATEGORY_ICONS = {
        food: '🍕', transport: '🚗', shopping: '🛒', entertainment: '🎬',
        utilities: '💡', rent: '🏠', health: '💊', education: '📚',
        travel: '✈️', other: '📦'
    };

    const DEFAULT_SETTINGS = {
        bkashNumber: '',
        bkashName: '',
        reminderMessage: 'Hi {name}, you have an outstanding balance of ৳{amount} BDT. Please settle via bKash to {bkash_number} ({bkash_name}). Thank you!',
        reminderDays: 7,
        autoSend: false
    };

    const DEFAULT_USERS = [
        { id: uid(), name: 'Alice Johnson', email: 'alice@example.com', phone: '+880 1711-000101', color: '#6C63FF' },
        { id: uid(), name: 'Bob Smith', email: 'bob@example.com', phone: '+880 1711-000102', color: '#48CFCB' },
        { id: uid(), name: 'Charlie Davis', email: 'charlie@example.com', phone: '+880 1711-000103', color: '#FF6B6B' },
        { id: uid(), name: 'Diana Lee', email: 'diana@example.com', phone: '+880 1711-000104', color: '#FFA94D' },
        { id: uid(), name: 'Ethan Brown', email: 'ethan@example.com', phone: '+880 1711-000105', color: '#51CF66' },
        { id: uid(), name: 'Fiona Garcia', email: 'fiona@example.com', phone: '+880 1711-000106', color: '#FF8ED4' },
        { id: uid(), name: 'George Wilson', email: 'george@example.com', phone: '+880 1711-000107', color: '#339AF0' },
        { id: uid(), name: 'Hannah Martinez', email: 'hannah@example.com', phone: '+880 1711-000108', color: '#FCC419' },
        { id: uid(), name: 'Ivan Taylor', email: 'ivan@example.com', phone: '+880 1711-000109', color: '#6C63FF' },
        { id: uid(), name: 'Julia Anderson', email: 'julia@example.com', phone: '+880 1711-000110', color: '#48CFCB' },
    ];

    let users = loadData(STORAGE_KEYS.users) || JSON.parse(JSON.stringify(DEFAULT_USERS));
    let transactions = loadData(STORAGE_KEYS.transactions) || [];
    let settings = Object.assign({}, DEFAULT_SETTINGS, loadData(STORAGE_KEYS.settings) || {});
    let reminders = loadData(STORAGE_KEYS.reminders) || {};
    let deletedUsers = loadData(STORAGE_KEYS.deletedUsers) || [];

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    }

    function loadData(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    function saveData() {
        localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(users));
        localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
        localStorage.setItem(STORAGE_KEYS.deletedUsers, JSON.stringify(deletedUsers));
        if (!suppressSharedSync) syncSharedState();
    }

    function saveSettings() {
        localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
        if (!suppressSharedSync) syncSharedState();
    }

    function saveReminders() {
        localStorage.setItem(STORAGE_KEYS.reminders, JSON.stringify(reminders));
        syncSharedState();
    }

    // Shared realtime backend. LocalStorage remains an offline cache until Supabase is configured.
    const sharedConfig = window.SPLITLEDGEr_SUPABASE || {};
    const sharedClient = sharedConfig.url && sharedConfig.anonKey && window.supabase
        ? window.supabase.createClient(sharedConfig.url, sharedConfig.anonKey) : null;
    let suppressSharedSync = false;
    let syncTimer;
    function syncSharedState() {
        if (!sharedClient) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(async () => {
            const payload = { room_id: sharedConfig.roomId || 'splitledger-main', users, transactions, settings, reminders, deleted_users: deletedUsers, updated_at: new Date().toISOString() };
            const { error } = await sharedClient.from('splitledger_state').upsert(payload, { onConflict: 'room_id' });
            if (error) console.warn('Shared sync failed:', error.message);
        }, 250);
    }
    async function startSharedSync() {
        if (!sharedClient) return;
        const roomId = sharedConfig.roomId || 'splitledger-main';
        const { data, error } = await sharedClient.from('splitledger_state').select('*').eq('room_id', roomId).maybeSingle();
        if (!error && data) {
            deletedUsers = Array.from(new Set([...deletedUsers, ...(data.deleted_users || [])]));
            users = (data.users || users).filter(u => !deletedUsers.includes(u.id));
            transactions = (data.transactions || transactions).filter(tx => !deletedUsers.includes(tx.paidBy) && !(tx.splitAmong || []).some(id => deletedUsers.includes(id)));
            settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {}); reminders = data.reminders || reminders;
            saveData(); renderDashboard();
        } else if (!error) syncSharedState();
        sharedClient.channel('splitledger-live').on('postgres_changes', { event: '*', schema: 'public', table: 'splitledger_state', filter: `room_id=eq.${roomId}` }, ({ new: next }) => {
            if (!next) return;
            suppressSharedSync = true;
            deletedUsers = Array.from(new Set([...deletedUsers, ...(next.deleted_users || [])]));
            users = (next.users || users).filter(u => !deletedUsers.includes(u.id));
            transactions = (next.transactions || transactions).filter(tx => !deletedUsers.includes(tx.paidBy) && !(tx.splitAmong || []).some(id => deletedUsers.includes(id)));
            settings = Object.assign({}, DEFAULT_SETTINGS, next.settings || {}); reminders = next.reminders || reminders;
            saveData(); saveSettings(); saveReminders(); suppressSharedSync = false;
            renderDashboard();
        }).subscribe();
    }

    function getInitials(name) {
        return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    }

    function formatCurrency(amount) {
        const absVal = Math.abs(amount);
        // Format with commas (South Asian / international style)
        const parts = absVal.toFixed(2).split('.');
        const intPart = parts[0];
        const decPart = parts[1];
        // Add commas for thousands
        const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return '৳' + formatted + '.' + decPart;
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function getUserById(id) {
        return users.find(u => u.id === id);
    }

    // Compute balances: positive = owed money, negative = owes money
    function computeBalances() {
        const balances = {};
        users.forEach(u => balances[u.id] = 0);

        transactions.forEach(tx => {
            const perPerson = tx.amount / tx.splitAmong.length;
            tx.splitAmong.forEach(userId => {
                if (userId === tx.paidBy) return;
                if (balances[userId] !== undefined) balances[userId] -= perPerson;
                if (balances[tx.paidBy] !== undefined) balances[tx.paidBy] += perPerson;
            });
        });

        return balances;
    }

    // Compute simplified settlements
    function computeSettlements() {
        const balances = computeBalances();
        const settlements = [];

        let debtors = [];
        let creditors = [];

        Object.entries(balances).forEach(([userId, bal]) => {
            if (bal < -0.01) debtors.push({ userId, amount: -bal });
            else if (bal > 0.01) creditors.push({ userId, amount: bal });
        });

        debtors.sort((a, b) => b.amount - a.amount);
        creditors.sort((a, b) => b.amount - a.amount);

        let i = 0, j = 0;
        while (i < debtors.length && j < creditors.length) {
            const settle = Math.min(debtors[i].amount, creditors[j].amount);
            if (settle > 0.01) {
                settlements.push({
                    from: debtors[i].userId,
                    to: creditors[j].userId,
                    amount: Math.round(settle * 100) / 100
                });
            }
            debtors[i].amount -= settle;
            creditors[j].amount -= settle;
            if (debtors[i].amount < 0.01) i++;
            if (creditors[j].amount < 0.01) j++;
        }

        return settlements;
    }

    // Get a unique key for a settlement pair
    function settlementKey(fromId, toId) {
        return `${fromId}_to_${toId}`;
    }

    // Get oldest transaction date
    function getOldestTransactionDate() {
        if (transactions.length === 0) return null;
        const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
        return new Date(sorted[0].date);
    }

    // ───────── Email / Reminder System ─────────

    function composeReminderEmail(fromUser, toUser, amount) {
        if (!toUser.email) {
            showToast(`No email address for ${toUser.name}. Please add one in User Management.`, 'error');
            return;
        }

        const subject = 'Settlement Reminder - SplitLedger';
        let body = settings.reminderMessage
            .replace(/\{name\}/g, toUser.name)
            .replace(/\{amount\}/g, formatCurrency(amount).replace('৳', ''))
            .replace(/\{bkash_number\}/g, settings.bkashNumber || '(not set)')
            .replace(/\{bkash_name\}/g, settings.bkashName || '(not set)');

        // Add bKash details if available
        if (settings.bkashNumber) {
            body += '\n\nbKash Number: ' + settings.bkashNumber;
            if (settings.bkashName) {
                body += '\nAccount Name: ' + settings.bkashName;
            }
        }

        body += '\n\n— SplitLedger';

        const mailtoUrl = `mailto:${encodeURIComponent(toUser.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.open(mailtoUrl, '_blank');

        // Record the reminder
        const key = settlementKey(fromUser.id, toUser.id);
        if (!reminders[key]) {
            reminders[key] = { lastSent: null, count: 0 };
        }
        reminders[key].lastSent = new Date().toISOString();
        reminders[key].count += 1;
        saveReminders();

        showToast(`Reminder email composed for ${toUser.name}`, 'success');
    }

    function sendAllReminders() {
        const settlements = computeSettlements();
        if (settlements.length === 0) {
            showToast('No outstanding settlements to send reminders for', 'info');
            return;
        }

        if (!settings.bkashNumber) {
            showToast('Please set your bKash number in Settings first', 'error');
            return;
        }

        let sentCount = 0;
        settlements.forEach((s, idx) => {
            const fromUser = getUserById(s.from);
            const toUser = getUserById(s.to);
            if (fromUser && toUser && toUser.email) {
                // Stagger openings to prevent popup blockers
                setTimeout(() => {
                    composeReminderEmail(fromUser, toUser, s.amount);
                }, idx * 500);
                sentCount++;
            }
        });

        if (sentCount === 0) {
            showToast('No users have email addresses configured', 'error');
        } else {
            showToast(`Composing ${sentCount} reminder email(s)...`, 'info');
        }
    }

    function checkAutoReminders() {
        const reminderBar = document.getElementById('reminder-bar');
        if (!reminderBar) return;

        const settlements = computeSettlements();

        if (settlements.length === 0 || !settings.autoSend) {
            reminderBar.innerHTML = '';
            reminderBar.style.display = 'none';
            return;
        }

        const oldestDate = getOldestTransactionDate();
        if (!oldestDate) {
            reminderBar.innerHTML = '';
            reminderBar.style.display = 'none';
            return;
        }

        const daysSinceOldest = Math.floor((Date.now() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
        let overdueCount = 0;

        settlements.forEach(s => {
            const key = settlementKey(s.from, s.to);
            const reminder = reminders[key];
            const lastSent = reminder ? new Date(reminder.lastSent) : null;
            const daysSinceReminder = lastSent ? Math.floor((Date.now() - lastSent.getTime()) / (1000 * 60 * 60 * 24)) : Infinity;

            if (daysSinceOldest >= settings.reminderDays && daysSinceReminder >= settings.reminderDays) {
                overdueCount++;
            }
        });

        if (overdueCount > 0) {
            reminderBar.style.display = 'block';
            reminderBar.className = 'reminder-bar';
            reminderBar.innerHTML = `
                <div class="reminder-bar-content">
                    <span class="reminder-bar-icon">⚠️</span>
                    <span><strong>${overdueCount}</strong> settlement${overdueCount !== 1 ? 's are' : ' is'} overdue (>${settings.reminderDays} days). Send reminders now!</span>
                    <button class="btn btn-sm btn-primary" id="btn-reminder-bar-send">Send All</button>
                </div>
            `;
            document.getElementById('btn-reminder-bar-send')?.addEventListener('click', sendAllReminders);
        } else {
            reminderBar.innerHTML = '';
            reminderBar.style.display = 'none';
        }
    }

    // ───────── Navigation ─────────

    const pages = {
        dashboard: document.getElementById('page-dashboard'),
        users: document.getElementById('page-users'),
        'add-expense': document.getElementById('page-add-expense'),
        transactions: document.getElementById('page-transactions'),
        settlements: document.getElementById('page-settlements'),
        settings: document.getElementById('page-settings'),
        'user-detail': document.getElementById('page-user-detail'),
    };

    function navigateTo(pageName) {
        Object.values(pages).forEach(p => { if (p) p.classList.remove('active'); });
        if (pages[pageName]) pages[pageName].classList.add('active');

        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === pageName);
        });

        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('mobile-toggle').classList.remove('active');

        // Re-render page
        switch (pageName) {
            case 'dashboard': renderDashboard(); break;
            case 'users': renderUsersTable(); break;
            case 'add-expense': renderExpenseForm(); break;
            case 'transactions': renderTransactions(); break;
            case 'settlements': renderSettlements(); break;
            case 'settings': renderSettings(); break;
        }
    }

    // Nav link clicks
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            navigateTo(link.dataset.page);
        });
    });

    // View all links
    document.querySelectorAll('.link-view-all').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            navigateTo(link.dataset.page);
        });
    });

    // Mobile toggle
    const mobileToggle = document.getElementById('mobile-toggle');
    mobileToggle.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
        mobileToggle.classList.toggle('active');
    });

    // Quick expense button
    document.getElementById('btn-quick-expense').addEventListener('click', () => navigateTo('add-expense'));

    // ───────── Dashboard ─────────

    function renderDashboard() {
        const balances = computeBalances();
        const totalExpenses = transactions.reduce((sum, tx) => sum + tx.amount, 0);
        const unsettled = Object.values(balances).filter(b => b > 0.01).reduce((s, b) => s + b, 0);

        document.getElementById('stat-total-users').textContent = users.length;
        document.getElementById('stat-total-expenses').textContent = formatCurrency(totalExpenses);
        document.getElementById('stat-total-transactions').textContent = transactions.length;
        document.getElementById('stat-unsettled').textContent = formatCurrency(unsettled);

        // Account cards
        const grid = document.getElementById('accounts-grid');
        grid.innerHTML = '';

        users.forEach(user => {
            const balance = balances[user.id] || 0;
            const txCount = transactions.filter(tx => tx.paidBy === user.id || tx.splitAmong.includes(user.id)).length;
            const balClass = balance > 0.01 ? 'balance-positive' : balance < -0.01 ? 'balance-negative' : 'balance-zero';
            const balPrefix = balance > 0.01 ? '+' : balance < -0.01 ? '-' : '';

            const card = document.createElement('div');
            card.className = 'account-card';
            card.innerHTML = `
                <div class="account-avatar" style="background:${user.color}">${getInitials(user.name)}</div>
                <div class="account-info">
                    <div class="account-name">${esc(user.name)}</div>
                    <div class="account-subtitle">${txCount} transaction${txCount !== 1 ? 's' : ''}</div>
                </div>
                <div>
                    <div class="account-balance ${balClass}">${balPrefix}${formatCurrency(balance)}</div>
                </div>
            `;
            card.addEventListener('click', () => showUserDetail(user.id));
            grid.appendChild(card);
        });

        // Recent transactions (last 5)
        const recent = document.getElementById('recent-transactions');
        const recentTx = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        recent.innerHTML = '';

        if (recentTx.length === 0) {
            recent.innerHTML = '<div class="empty-state"><p style="padding:20px 0;color:var(--text-muted);">No transactions yet. Add your first expense!</p></div>';
            return;
        }

        recentTx.forEach(tx => {
            recent.appendChild(createTransactionElement(tx));
        });
    }

    // ───────── Users Table ─────────

    function renderUsersTable() {
        const tbody = document.getElementById('users-table-body');
        const empty = document.getElementById('users-empty');
        const table = document.getElementById('users-table');
        const balances = computeBalances();

        if (users.length === 0) {
            table.style.display = 'none';
            empty.style.display = 'block';
            return;
        }

        table.style.display = 'table';
        empty.style.display = 'none';
        tbody.innerHTML = '';

        users.forEach(user => {
            const balance = balances[user.id] || 0;
            const txCount = transactions.filter(tx => tx.paidBy === user.id || tx.splitAmong.includes(user.id)).length;
            const balClass = balance > 0.01 ? 'balance-positive' : balance < -0.01 ? 'balance-negative' : 'balance-zero';
            const balPrefix = balance > 0.01 ? '+' : balance < -0.01 ? '-' : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div class="user-cell">
                        <div class="account-avatar" style="background:${user.color}">${getInitials(user.name)}</div>
                        <span>${esc(user.name)}</span>
                    </div>
                </td>
                <td>${esc(user.email || '—')}</td>
                <td>${esc(user.phone || '—')}</td>
                <td class="${balClass}" style="font-weight:700">${balPrefix}${formatCurrency(balance)}</td>
                <td>${txCount}</td>
                <td>
                    <div class="table-actions">
                        <button class="btn-icon btn-edit-user" data-id="${user.id}" title="Edit">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn-icon btn-icon-danger btn-delete-user" data-id="${user.id}" title="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Attach edit/delete listeners
        tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
            btn.addEventListener('click', () => openEditUser(btn.dataset.id));
        });
        tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
            btn.addEventListener('click', () => confirmDeleteUser(btn.dataset.id));
        });
    }

    // ───────── User Modal ─────────

    const modalUser = document.getElementById('modal-user');
    const userForm = document.getElementById('user-form');

    function openAddUser() {
        document.getElementById('modal-user-title').textContent = 'Add New User';
        document.getElementById('btn-save-user').textContent = 'Add User';
        userForm.reset();
        document.getElementById('user-edit-id').value = '';
        document.querySelector('.color-picker input[value="#6C63FF"]').checked = true;
        modalUser.classList.add('show');
    }

    function openEditUser(userId) {
        const user = getUserById(userId);
        if (!user) return;

        document.getElementById('modal-user-title').textContent = 'Edit User';
        document.getElementById('btn-save-user').textContent = 'Save Changes';
        document.getElementById('user-edit-id').value = user.id;
        document.getElementById('user-name').value = user.name;
        document.getElementById('user-email').value = user.email || '';
        document.getElementById('user-phone').value = user.phone || '';

        const colorRadio = document.querySelector(`.color-picker input[value="${user.color}"]`);
        if (colorRadio) colorRadio.checked = true;
        else document.querySelector('.color-picker input[value="#6C63FF"]').checked = true;

        modalUser.classList.add('show');
    }

    function closeUserModal() {
        modalUser.classList.remove('show');
    }

    document.getElementById('btn-add-user').addEventListener('click', openAddUser);
    document.getElementById('btn-add-user-empty').addEventListener('click', openAddUser);
    document.getElementById('modal-user-close').addEventListener('click', closeUserModal);
    document.getElementById('modal-user-cancel').addEventListener('click', closeUserModal);

    modalUser.addEventListener('click', e => {
        if (e.target === modalUser) closeUserModal();
    });

    userForm.addEventListener('submit', e => {
        e.preventDefault();
        const editId = document.getElementById('user-edit-id').value;
        const name = document.getElementById('user-name').value.trim();
        const email = document.getElementById('user-email').value.trim();
        const phone = document.getElementById('user-phone').value.trim();
        const color = document.querySelector('.color-picker input:checked').value;

        if (!name) return;

        if (editId) {
            const user = getUserById(editId);
            if (user) {
                user.name = name;
                user.email = email;
                user.phone = phone;
                user.color = color;
                showToast('User updated successfully', 'success');
            }
        } else {
            users.push({ id: uid(), name, email, phone, color });
            showToast('User created successfully', 'success');
        }

        saveData();
        closeUserModal();
        renderUsersTable();
        renderDashboard();
    });

    // Delete user
    let pendingDeleteUserId = null;
    const modalConfirm = document.getElementById('modal-confirm');

    function confirmDeleteUser(userId) {
        const user = getUserById(userId);
        if (!user) return;
        pendingDeleteUserId = userId;
        document.getElementById('confirm-message').textContent = `Delete "${user.name}"? This will also remove them from all transactions.`;
        modalConfirm.classList.add('show');
    }

    document.getElementById('modal-confirm-close').addEventListener('click', () => modalConfirm.classList.remove('show'));
    document.getElementById('modal-confirm-cancel').addEventListener('click', () => modalConfirm.classList.remove('show'));
    modalConfirm.addEventListener('click', e => { if (e.target === modalConfirm) modalConfirm.classList.remove('show'); });

    document.getElementById('modal-confirm-ok').addEventListener('click', () => {
        if (pendingDeleteUserId === '__RESET__') {
            localStorage.removeItem(STORAGE_KEYS.users);
            localStorage.removeItem(STORAGE_KEYS.transactions);
            localStorage.removeItem(STORAGE_KEYS.reminders);
            users = JSON.parse(JSON.stringify(DEFAULT_USERS));
            transactions = [];
            reminders = {};
            saveData();
            saveReminders();
            showToast('Data reset to defaults', 'info');
            navigateTo('dashboard');
        } else if (pendingDeleteUserId) {
            users = users.filter(u => u.id !== pendingDeleteUserId);
            deletedUsers = Array.from(new Set([...deletedUsers, pendingDeleteUserId]));
            transactions = transactions.filter(tx => {
                tx.splitAmong = tx.splitAmong.filter(id => id !== pendingDeleteUserId);
                if (tx.paidBy === pendingDeleteUserId || tx.splitAmong.length === 0) return false;
                return true;
            });
            saveData();
            showToast('User deleted', 'success');
            renderUsersTable();
            renderDashboard();
        }
        pendingDeleteUserId = null;
        modalConfirm.classList.remove('show');
    });

    // ───────── Expense Form ─────────

    function renderExpenseForm() {
        const paidBySelect = document.getElementById('expense-paid-by');
        const currentVal = paidBySelect.value;
        paidBySelect.innerHTML = '<option value="">Select who paid</option>';
        users.forEach(u => {
            paidBySelect.innerHTML += `<option value="${u.id}">${esc(u.name)}</option>`;
        });
        if (currentVal) paidBySelect.value = currentVal;

        const grid = document.getElementById('split-users-grid');
        grid.innerHTML = '';
        users.forEach(u => {
            const chip = document.createElement('div');
            chip.className = 'split-user-chip selected';
            chip.dataset.userId = u.id;
            chip.innerHTML = `
                <div class="chip-avatar" style="background:${u.color}">${getInitials(u.name)}</div>
                <span class="chip-name">${esc(u.name)}</span>
                <div class="chip-check"></div>
            `;
            chip.addEventListener('click', () => {
                chip.classList.toggle('selected');
                updateSplitSummary();
            });
            grid.appendChild(chip);
        });

        const dateInput = document.getElementById('expense-date');
        if (!dateInput.value) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }

        updateSplitSummary();
    }

    function updateSplitSummary() {
        const selected = document.querySelectorAll('.split-user-chip.selected');
        const amountInput = document.getElementById('expense-amount');
        const summary = document.getElementById('split-summary');
        const amount = parseFloat(amountInput.value) || 0;

        if (selected.length > 0 && amount > 0) {
            summary.style.display = 'block';
            document.getElementById('split-amount').textContent = formatCurrency(amount / selected.length);
            document.getElementById('split-count').textContent = selected.length;
        } else {
            summary.style.display = 'none';
        }
    }

    document.getElementById('expense-amount').addEventListener('input', updateSplitSummary);

    document.getElementById('btn-select-all').addEventListener('click', () => {
        document.querySelectorAll('.split-user-chip').forEach(c => c.classList.add('selected'));
        updateSplitSummary();
    });

    document.getElementById('btn-deselect-all').addEventListener('click', () => {
        document.querySelectorAll('.split-user-chip').forEach(c => c.classList.remove('selected'));
        updateSplitSummary();
    });

    document.getElementById('expense-form').addEventListener('submit', e => {
        e.preventDefault();

        const description = document.getElementById('expense-description').value.trim();
        const category = document.getElementById('expense-category').value;
        const amount = parseFloat(document.getElementById('expense-amount').value);
        const paidBy = document.getElementById('expense-paid-by').value;
        const date = document.getElementById('expense-date').value;
        const notes = document.getElementById('expense-notes').value.trim();
        const selectedChips = document.querySelectorAll('.split-user-chip.selected');
        const splitAmong = Array.from(selectedChips).map(c => c.dataset.userId);

        if (!description || !amount || !paidBy || splitAmong.length === 0) {
            showToast('Please fill all required fields and select at least one person to split', 'error');
            return;
        }

        const payer = getUserById(paidBy);
        if (!payer) {
            showToast('Invalid payer selected', 'error');
            return;
        }

        transactions.push({
            id: uid(),
            description,
            category,
            amount,
            paidBy,
            splitAmong,
            date: date || new Date().toISOString().split('T')[0],
            notes,
            createdAt: new Date().toISOString()
        });

        saveData();
        showToast(`Expense logged: ${description} — ${formatCurrency(amount)} split among ${splitAmong.length} people`, 'success');
        e.target.reset();
        document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
        renderExpenseForm();
    });

    document.getElementById('expense-form').addEventListener('reset', () => {
        setTimeout(() => {
            renderExpenseForm();
        }, 10);
    });

    // ───────── Transactions List ─────────

    function createTransactionElement(tx, showActions = true) {
        const payer = getUserById(tx.paidBy);
        const perPerson = tx.amount / tx.splitAmong.length;
        const icon = CATEGORY_ICONS[tx.category] || '📦';

        const el = document.createElement('div');
        el.className = 'transaction-item';
        el.innerHTML = `
            <div class="transaction-icon">${icon}</div>
            <div class="transaction-details">
                <div class="transaction-title">${esc(tx.description)}</div>
                <div class="transaction-meta">
                    <span>Paid by <strong>${payer ? esc(payer.name) : 'Unknown'}</strong></span>
                    <span>${formatDate(tx.date)}</span>
                </div>
            </div>
            <div>
                <div class="transaction-amount">${formatCurrency(tx.amount)}</div>
                <div class="transaction-split-info">${formatCurrency(perPerson)} × ${tx.splitAmong.length}</div>
            </div>
            ${showActions ? `
            <div class="transaction-actions">
                <button class="btn-icon btn-icon-danger btn-delete-tx" data-id="${tx.id}" title="Delete transaction">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
            ` : ''}
        `;

        if (showActions) {
            el.querySelector('.btn-delete-tx')?.addEventListener('click', () => {
                transactions = transactions.filter(t => t.id !== tx.id);
                saveData();
                showToast('Transaction deleted', 'success');
                renderTransactions();
                renderDashboard();
            });
        }

        return el;
    }

    function renderTransactions() {
        const container = document.getElementById('all-transactions');
        const empty = document.getElementById('transactions-empty');
        const search = document.getElementById('search-transactions').value.toLowerCase();
        const categoryFilter = document.getElementById('filter-category').value;

        let filtered = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

        if (search) {
            filtered = filtered.filter(tx => {
                const payer = getUserById(tx.paidBy);
                return tx.description.toLowerCase().includes(search) ||
                    (payer && payer.name.toLowerCase().includes(search));
            });
        }

        if (categoryFilter) {
            filtered = filtered.filter(tx => tx.category === categoryFilter);
        }

        container.innerHTML = '';
        if (filtered.length === 0) {
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        filtered.forEach(tx => {
            container.appendChild(createTransactionElement(tx));
        });
    }

    document.getElementById('search-transactions').addEventListener('input', renderTransactions);
    document.getElementById('filter-category').addEventListener('change', renderTransactions);
    document.getElementById('btn-add-expense-empty')?.addEventListener('click', () => navigateTo('add-expense'));

    // ───────── Settlements ─────────

    function renderSettlements() {
        const container = document.getElementById('settlements-list');
        const empty = document.getElementById('settlements-empty');
        const settlements = computeSettlements();

        // Update auto-send toggle state
        const autoToggle = document.getElementById('auto-send-toggle');
        if (autoToggle) autoToggle.checked = settings.autoSend;

        container.innerHTML = '';

        // Check auto reminders
        checkAutoReminders();

        if (settlements.length === 0) {
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        settlements.forEach(s => {
            const from = getUserById(s.from);
            const to = getUserById(s.to);
            if (!from || !to) return;

            const key = settlementKey(s.from, s.to);
            const reminderData = reminders[key];
            const lastSentStr = reminderData ? `Last sent: ${formatDate(reminderData.lastSent)} (${reminderData.count}×)` : '';

            const card = document.createElement('div');
            card.className = 'settlement-card';
            card.innerHTML = `
                <div class="settlement-from">
                    <div class="account-avatar" style="background:${from.color};width:36px;height:36px;font-size:0.8rem;">${getInitials(from.name)}</div>
                    <span style="font-weight:600;font-size:0.9rem">${esc(from.name)}</span>
                </div>
                <div class="settlement-arrow">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </div>
                <div class="settlement-to">
                    <div class="account-avatar" style="background:${to.color};width:36px;height:36px;font-size:0.8rem;">${getInitials(to.name)}</div>
                    <span style="font-weight:600;font-size:0.9rem">${esc(to.name)}</span>
                </div>
                <div class="settlement-amount">${formatCurrency(s.amount)}</div>
                <div class="settlement-action" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                    <button class="btn btn-sm btn-primary btn-settle" data-from="${s.from}" data-to="${s.to}" data-amount="${s.amount}">Settle</button>
                    <button class="btn btn-sm btn-email btn-send-email" data-from="${s.from}" data-to="${s.to}" data-amount="${s.amount}" title="Send reminder email">📧 Email</button>
                </div>
                ${lastSentStr ? `<div class="settlement-email-info"><span class="email-status sent">✓ Sent</span> <span style="font-size:0.75rem;color:var(--text-muted)">${lastSentStr}</span></div>` : ''}
            `;
            container.appendChild(card);
        });

        // Settle buttons
        container.querySelectorAll('.btn-settle').forEach(btn => {
            btn.addEventListener('click', () => {
                const fromId = btn.dataset.from;
                const toId = btn.dataset.to;
                const amount = parseFloat(btn.dataset.amount);
                const fromUser = getUserById(fromId);
                const toUser = getUserById(toId);

                transactions.push({
                    id: uid(),
                    description: `Settlement: ${fromUser.name} → ${toUser.name}`,
                    category: 'other',
                    amount: amount,
                    paidBy: fromId,
                    splitAmong: [toId],
                    date: new Date().toISOString().split('T')[0],
                    notes: 'Auto-settlement',
                    createdAt: new Date().toISOString()
                });

                saveData();
                showToast(`Settled ${formatCurrency(amount)}: ${fromUser.name} → ${toUser.name}`, 'success');
                renderSettlements();
                renderDashboard();
            });
        });

        // Email buttons
        container.querySelectorAll('.btn-send-email').forEach(btn => {
            btn.addEventListener('click', () => {
                const fromUser = getUserById(btn.dataset.from);
                const toUser = getUserById(btn.dataset.to);
                const amount = parseFloat(btn.dataset.amount);
                if (fromUser && toUser) {
                    composeReminderEmail(fromUser, toUser, amount);
                    // Re-render to show updated last-sent info
                    setTimeout(() => renderSettlements(), 300);
                }
            });
        });
    }

    // Wire up settlement page controls
    document.getElementById('btn-send-all-reminders')?.addEventListener('click', () => {
        sendAllReminders();
        setTimeout(() => renderSettlements(), 1500);
    });

    document.getElementById('auto-send-toggle')?.addEventListener('change', (e) => {
        settings.autoSend = e.target.checked;
        saveSettings();
        showToast(settings.autoSend ? 'Auto-reminders enabled' : 'Auto-reminders disabled', 'info');
        checkAutoReminders();
    });

    // ───────── Settings ─────────

    function renderSettings() {
        const bkashInput = document.getElementById('settings-bkash');
        const bkashNameInput = document.getElementById('settings-bkash-name');
        const reminderMsgInput = document.getElementById('settings-reminder-msg');
        const reminderDaysInput = document.getElementById('settings-reminder-days');

        if (bkashInput) bkashInput.value = settings.bkashNumber || '';
        if (bkashNameInput) bkashNameInput.value = settings.bkashName || '';
        if (reminderMsgInput) reminderMsgInput.value = settings.reminderMessage || DEFAULT_SETTINGS.reminderMessage;
        if (reminderDaysInput) reminderDaysInput.value = settings.reminderDays || 7;
    }

    // Settings form save
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', e => {
            e.preventDefault();

            settings.bkashNumber = document.getElementById('settings-bkash').value.trim();
            settings.bkashName = document.getElementById('settings-bkash-name').value.trim();
            settings.reminderMessage = document.getElementById('settings-reminder-msg').value.trim() || DEFAULT_SETTINGS.reminderMessage;
            settings.reminderDays = parseInt(document.getElementById('settings-reminder-days').value) || 7;

            saveSettings();
            showToast('Settings saved successfully!', 'success');
        });
    }

    // ───────── User Detail ─────────

    function showUserDetail(userId) {
        const user = getUserById(userId);
        if (!user) return;
        navigateToDetail(userId);
    }

    function navigateToDetail(userId) {
        const user = getUserById(userId);
        if (!user) return;

        Object.values(pages).forEach(p => { if (p) p.classList.remove('active'); });
        pages['user-detail'].classList.add('active');
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

        document.getElementById('detail-user-name').textContent = user.name;
        document.getElementById('detail-user-email').textContent = user.email || 'No email';

        const balances = computeBalances();
        const balance = balances[user.id] || 0;
        const userTx = transactions.filter(tx => tx.paidBy === user.id || tx.splitAmong.includes(user.id));
        const totalPaid = transactions.filter(tx => tx.paidBy === user.id).reduce((s, tx) => s + tx.amount, 0);
        const totalOwed = userTx.reduce((sum, tx) => {
            if (tx.splitAmong.includes(user.id) && tx.paidBy !== user.id) {
                return sum + (tx.amount / tx.splitAmong.length);
            }
            return sum;
        }, 0);

        const statsContainer = document.getElementById('detail-stats');
        const balClass = balance > 0.01 ? 'balance-positive' : balance < -0.01 ? 'balance-negative' : 'balance-zero';
        statsContainer.innerHTML = `
            <div class="detail-stat">
                <div class="detail-stat-label">Net Balance</div>
                <div class="detail-stat-value ${balClass}">${balance >= 0 ? '+' : '-'}${formatCurrency(balance)}</div>
            </div>
            <div class="detail-stat">
                <div class="detail-stat-label">Total Paid</div>
                <div class="detail-stat-value">${formatCurrency(totalPaid)}</div>
            </div>
            <div class="detail-stat">
                <div class="detail-stat-label">Total Owed</div>
                <div class="detail-stat-value" style="color:var(--negative)">${formatCurrency(totalOwed)}</div>
            </div>
            <div class="detail-stat">
                <div class="detail-stat-label">Transactions</div>
                <div class="detail-stat-value">${userTx.length}</div>
            </div>
        `;

        const txList = document.getElementById('detail-transactions');
        txList.innerHTML = '';

        const sortedTx = [...userTx].sort((a, b) => new Date(b.date) - new Date(a.date));

        if (sortedTx.length === 0) {
            txList.innerHTML = '<div class="empty-state" style="padding:30px"><p>No transactions for this user yet.</p></div>';
            return;
        }

        sortedTx.forEach(tx => {
            txList.appendChild(createTransactionElement(tx, false));
        });
    }

    document.getElementById('btn-back-dashboard').addEventListener('click', () => navigateTo('dashboard'));

    // ───────── Reset Data ─────────

    document.getElementById('btn-reset-data').addEventListener('click', () => {
        pendingDeleteUserId = '__RESET__';
        document.getElementById('confirm-message').textContent = 'Reset all data to defaults? This will remove all custom users, transactions, and reminders.';
        modalConfirm.classList.add('show');
    });

    // ───────── Toast ─────────

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${esc(message)}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ───────── Helpers ─────────

    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ───────── Data Export / Import ─────────

    function downloadJSON(data, filename) {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function exportAllData() {
        const allData = {
            exportDate: new Date().toISOString(),
            appName: 'SplitLedger',
            users: users,
            transactions: transactions,
            settings: settings,
            reminders: reminders
        };
        const timestamp = new Date().toISOString().split('T')[0];
        downloadJSON(allData, `splitledger_backup_${timestamp}.json`);
        showToast('All data exported successfully!', 'success');
    }

    function exportUsers() {
        downloadJSON(users, 'users.json');
        showToast('Users exported to users.json', 'success');
    }

    function exportTransactions() {
        downloadJSON(transactions, 'transactions.json');
        showToast('Transactions exported to transactions.json', 'success');
    }

    function importData(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);

                // Full backup format (has appName or multiple keys)
                if (data.users && data.transactions) {
                    users = data.users;
                    transactions = data.transactions;
                    if (data.settings) settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
                    if (data.reminders) reminders = data.reminders;
                    saveData();
                    saveSettings();
                    saveReminders();
                    showToast(`Imported full backup: ${users.length} users, ${transactions.length} transactions`, 'success');
                    navigateTo('dashboard');
                    return;
                }

                // Array format — could be users or transactions
                if (Array.isArray(data)) {
                    if (data.length > 0 && data[0].name && !data[0].description) {
                        // Looks like users (has name, no description)
                        data.forEach(u => { if (!u.id) u.id = uid(); });
                        users = data;
                        saveData();
                        showToast(`Imported ${data.length} users`, 'success');
                        navigateTo('users');
                    } else if (data.length > 0 && data[0].description) {
                        // Looks like transactions
                        transactions = data;
                        saveData();
                        showToast(`Imported ${data.length} transactions`, 'success');
                        navigateTo('transactions');
                    } else {
                        showToast('Could not determine data type from file', 'error');
                    }
                    return;
                }

                // Settings format
                if (data.bkashNumber !== undefined || data.reminderDays !== undefined) {
                    settings = Object.assign({}, DEFAULT_SETTINGS, data);
                    saveSettings();
                    showToast('Settings imported successfully', 'success');
                    navigateTo('settings');
                    return;
                }

                showToast('Unrecognized file format', 'error');
            } catch (err) {
                showToast('Error parsing file: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    }

    // Wire up export/import buttons
    document.getElementById('btn-export-data')?.addEventListener('click', exportAllData);
    document.getElementById('btn-export-users')?.addEventListener('click', exportUsers);
    document.getElementById('btn-export-transactions')?.addEventListener('click', exportTransactions);

    document.getElementById('btn-import-data')?.addEventListener('click', () => {
        document.getElementById('import-file-input').click();
    });

    document.getElementById('import-file-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importData(file);
            e.target.value = ''; // Reset so same file can be re-imported
        }
    });

    // ───────── Init ─────────

    saveData();
    saveSettings();
    renderDashboard();
    startSharedSync();

})();
