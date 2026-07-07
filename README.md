# Codex Auth Manager

A simple CLI to check the remaining quota of your OpenAI/Codex accounts and switch between them quickly, straight from your terminal. No heavy third-party libraries, just pure Node.js + TypeScript.

## Installation & Usage

You can run Codex Auth Manager instantly using `npx` without installing it:

```bash
npx codex-auth-manager
```

Or, install it globally via `npm` to use the `codex-auth` command anywhere:

```bash
npm install -g codex-auth-manager
codex-auth
```

## Configuration & Pool Directory

The manager stores its configurations locally in your home directory (`~/.codex/`):

- **Auth Pool Folder**: `~/.codex/pool/`
  Place all your JSON auth files here. Each file represents an account and should contain your `access_token` and `account_id`.
- **Active Auth File**: `~/.codex/auth.json`
  When you switch accounts (manually or via `auto`), the CLI will copy the chosen account from the pool into this active auth file.

### Adding Accounts to the Pool
You can manually drop `.json` files into `~/.codex/pool/`, or if you already have an active `auth.json`, save it to the pool using:
```bash
codex-auth save <account_name>
```

## How to Use

Just type `codex-auth` in your terminal. You'll see a table showing the remaining quota for all accounts stored in your pool folder (`~/.codex/pool/`).

Just use your arrow keys (**⬆️ / ⬇️**) to pick the account you want to use, then press **Enter**. The tool will automatically copy the account's JSON file to `~/.codex/auth.json` and immediately run your `codex` command.

**Other commands:**
- `codex-auth auto` (or `--auto`) — Automatically picks the account with the highest available quota (Prioritizing Primary 5h) and immediately runs it.
- `codex-auth save <account_name>` — Saves your currently active auth into the pool folder. Do this first if your pool is empty!
- `codex-auth check` — Just checks the quota for all accounts without prompting to pick one.
- `codex-auth switch <account_name>` — Manually switches the active account if you don't feel like using the interactive menu.

## Cleaning Up Dead Accounts

If you notice an account is dead (Expired/Blocked) during the check, you can quickly delete it from your pool. 

How to do it: open `codex-auth`, highlight the dead account using your arrow keys, and press **Delete** or **X**. You'll get a confirmation prompt—just press **Y** to delete it forever.
