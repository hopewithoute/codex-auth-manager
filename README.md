# Codex Auth

A simple CLI to check the remaining quota of your OpenAI/Codex accounts and switch between them quickly, straight from your terminal. No heavy third-party libraries, just pure Node.js + TypeScript.

## How to Install

```bash
# Compile the typescript
npm run build

# Register the command globally
npm link
```

## How to Use

Just type `codex-auth` in your terminal. You'll see a table showing the remaining quota for all accounts stored in your pool folder (`~/.codex/pool/`).

Just use your arrow keys (**⬆️ / ⬇️**) to pick the account you want to use, then press **Enter**. The tool will automatically copy the account's JSON file to `~/.codex/auth.json` and immediately run your `codex` command.

**Other commands:**
- `codex-auth save <account_name>` — Saves your currently active auth into the pool folder. Do this first if your pool is empty!
- `codex-auth check` — Just checks the quota for all accounts without prompting to pick one.
- `codex-auth switch <account_name>` — Manually switches the active account if you don't feel like using the interactive menu.

## Cleaning Up Dead Accounts

If you notice an account is dead (Expired/Blocked) during the check, you can quickly delete it from your pool. 

How to do it: open `codex-auth`, highlight the dead account using your arrow keys, and press **Delete** or **X**. You'll get a confirmation prompt—just press **Y** to delete it forever.
