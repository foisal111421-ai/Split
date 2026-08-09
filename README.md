# SplitLedger — Smart Account Management

A modern expense splitting and account management web app built with vanilla HTML, CSS, and JavaScript.

## Features

- 🏠 **Dashboard** — Overview of all accounts with real-time balances
- 👥 **User Management** — Create, edit, and delete user accounts
- 💰 **Expense Splitting** — Log expenses and auto-split among selected users (in ৳ BDT)
- 📊 **Transaction History** — Search, filter, and manage all transactions
- 💸 **Settlements** — See who owes whom with one-click settle
- 📧 **Email Reminders** — Manual and auto email reminders with bKash payment details
- ⚙️ **Settings** — Configure bKash number, reminder templates, and auto-send
- 📁 **Data Export/Import** — Backup and restore data as JSON files

## Live Demo

Access the app at: `https://<your-username>.github.io/splitledger/`

## Tech Stack

- Pure HTML5, CSS3, JavaScript (no frameworks)
- Supabase Realtime for shared multi-client data, with LocalStorage offline fallback
- GitHub Pages for hosting

## Getting Started

1. Create a Supabase project.
2. Run `supabase-schema.sql` in Supabase SQL Editor.
3. Enable realtime for `splitledger_state` in Database > Replication.
4. Copy the project URL and anon key into `supabase-config.js`.
5. Deploy the files to GitHub Pages and share the page link.

Without Supabase credentials, the app automatically uses browser-local storage.

## License

MIT
