#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { spawn } from 'child_process';

const CONFIG = {
    codexDir: path.join(os.homedir(), '.codex'),
    get poolDir() { return path.join(this.codexDir, 'pool'); },
    get activeAuth() { return path.join(this.codexDir, 'auth.json'); },
    usageUrl: "https://chatgpt.com/backend-api/wham/usage"
};

// Premium CLI Color Palette
const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", inverse: "\x1b[7m",
    red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m"
};
const stripAnsi = (str: string) => String(str).replace(/\x1b\[[0-9;]*m/g, '');

// Ensure directories exist
if (!fs.existsSync(CONFIG.codexDir)) fs.mkdirSync(CONFIG.codexDir, { recursive: true });
if (!fs.existsSync(CONFIG.poolDir)) fs.mkdirSync(CONFIG.poolDir, { recursive: true });

function printBanner() { console.log(`\n${C.cyan}${C.bold}✦  Codex Auth Manager${C.reset}\n`); }

async function saveAuth(name?: string) {
    printBanner();
    if (!name) { console.error(`  ${C.red}✖${C.reset} Please provide a name (e.g., codex-auth save acc1)`); process.exit(1); }
    if (!fs.existsSync(CONFIG.activeAuth)) { console.error(`  ${C.red}✖${C.reset} Active auth file not found at ${C.dim}${CONFIG.activeAuth}${C.reset}`); process.exit(1); }
    
    await fs.promises.copyFile(CONFIG.activeAuth, path.join(CONFIG.poolDir, `${name}.json`));
    console.log(`  ${C.green}✔${C.reset} Successfully saved current auth to pool as: ${C.bold}${name}.json${C.reset}\n`);
}

async function switchAuth(name?: string) {
    printBanner();
    if (!name) {
        console.log(`  ${C.bold}Available auths in the pool:${C.reset}\n`);
        const files = (await fs.promises.readdir(CONFIG.poolDir)).filter(f => f.endsWith('.json'));
        if (files.length === 0) console.log(`    ${C.dim}(No files in the pool)${C.reset}`);
        else files.forEach(f => console.log(`    ${C.dim}•${C.reset} ${C.cyan}${f.replace('.json', '')}${C.reset}`));
        console.log(`\n  ${C.dim}Usage:${C.reset} codex-auth switch <name>\n`);
        return;
    }
    
    const targetPath = path.join(CONFIG.poolDir, `${name}.json`);
    if (!fs.existsSync(targetPath)) { console.error(`  ${C.red}✖${C.reset} Auth file '${C.bold}${name}.json${C.reset}' not found in the pool.\n`); process.exit(1); }
    
    await fs.promises.copyFile(targetPath, CONFIG.activeAuth);
    console.log(`  ${C.green}✔${C.reset} Successfully switched active auth to: ${C.bold}${name}${C.reset}\n`);
}

// -----------------------------------------------------------------------------
// API & Quota Logic
// -----------------------------------------------------------------------------

interface AuthFile { tokens?: { access_token?: string; }; account_id?: string; }
interface WindowData { used_percent?: number; reset_at?: number | string; }
interface RateLimitData { primary_window?: WindowData; primary?: WindowData; secondary_window?: WindowData; secondary?: WindowData; }
interface APIResponse { plan_type?: string; rate_limit?: RateLimitData; rate_limits?: RateLimitData; }
export interface QuotaRow { AccountRaw: string; Account: string; Plan: string; 'Primary (5h)': string; 'Secondary (1w)': string; [key: string]: string; }

async function fetchUsage(token: string, accountId: string): Promise<APIResponse | string> {
    const response = await fetch(CONFIG.usageUrl, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json", "OpenAI-Beta": "codex-1", "originator": "codex_cli_rs", "ChatGPT-Account-ID": accountId }
    });
    if (response.status === 401) return `${C.red}Expired${C.reset}`;
    if (response.status === 403) return `${C.red}Blocked${C.reset}`;
    if (!response.ok) return `${C.red}Err ${response.status}${C.reset}`;
    return await response.json() as APIResponse;
}

function formatTimeLeft(resetAt?: number | string | null): string {
    if (!resetAt) return "Unknown";
    const diff = (typeof resetAt === "string" ? new Date(resetAt) : new Date(Number(resetAt) * 1000)).getTime() - Date.now();
    if (diff <= 0) return "Ready";
    return `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`;
}

function parseWindow(windowData?: WindowData, defaultText = "-"): string {
    if (!windowData || windowData.used_percent === undefined) {
        return defaultText === "Unlimited" ? `${C.green}Unlimited${C.reset}` : defaultText;
    }
    
    const left = Math.max(0, 100 - windowData.used_percent);
    const text = `${left}%` + (windowData.reset_at ? ` ${C.dim}↻ ${formatTimeLeft(windowData.reset_at)}${C.reset}` : "");
    
    if (left <= 5) return `${C.red}${text}${C.reset}`;
    if (left <= 30) return `${C.yellow}${text}${C.reset}`;
    return `${C.green}${text}${C.reset}`;
}

async function checkSingleQuota(filePath: string, name: string): Promise<QuotaRow> {
    const mkRow = (Plan: string, p = '-', s = '-'): QuotaRow => 
        ({ AccountRaw: name, Account: name, Plan, 'Primary (5h)': p, 'Secondary (1w)': s });
    
    try {
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const data: AuthFile = JSON.parse(fileContent);
        if (!data?.tokens?.access_token) return mkRow(`${C.red}No token${C.reset}`);

        const res = await fetchUsage(data.tokens.access_token, data.account_id || "");
        if (typeof res === "string") return mkRow(res);

        const limits = res.rate_limit || res.rate_limits || {};
        return mkRow(
            `${C.magenta}${res.plan_type || "Unknown"}${C.reset}`,
            parseWindow(limits.primary_window || limits.primary, "Unlimited"),
            parseWindow(limits.secondary_window || limits.secondary, "-")
        );
    } catch {
        return mkRow(`${C.red}Error${C.reset}`);
    }
}

// -----------------------------------------------------------------------------
// UI Helpers
// -----------------------------------------------------------------------------

const spinner = {
    id: null as NodeJS.Timeout | null,
    start(text: string) {
        if (!process.stdout.isTTY) return console.log(`  ${stripAnsi(text)}`);
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let i = 0;
        process.stdout.write(`  ${C.cyan}${frames[0]}${C.reset} ${text}`);
        this.id = setInterval(() => {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`  ${C.cyan}${frames[++i % frames.length]}${C.reset} ${text}`);
        }, 80);
    },
    stop() {
        if (!this.id) return;
        clearInterval(this.id);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
    }
};

function printTable(data: QuotaRow[], selectedIndex: number = -1): void {
    if (data.length === 0) return;
    
    const keys = Object.keys(data[0]).filter(k => k !== 'AccountRaw');
    const colWidths = Object.fromEntries(keys.map(k => [k, Math.max(stripAnsi(k).length, ...data.map(row => stripAnsi(row[k] || '').length))]));
    const pad = (text: string, width: number) => `${text}${' '.repeat(width - stripAnsi(text).length)}`;
    
    let out = '  ';
    keys.forEach(k => { out += `${C.dim}${pad(k.toUpperCase(), colWidths[k])}    ${C.reset}`; });
    out += '\n';
    
    data.forEach((row, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? `${C.cyan}❯ ${C.reset}` : "  ";
        let rowStr = prefix;
        keys.forEach(k => {
            let val = row[k] || '';
            if (isSelected && k === 'Account') val = `${C.cyan}${C.bold}${stripAnsi(val)}${C.reset}`;
            else if (k === 'Account') val = `${C.bold}${val}${C.reset}`;
            rowStr += `${pad(val, colWidths[k])}    `;
        });
        out += rowStr + '\n';
    });
    
    process.stdout.write(out);
}

// -----------------------------------------------------------------------------
// Core Workflows
// -----------------------------------------------------------------------------

async function selectAccountInteractive(results: QuotaRow[]): Promise<string> {
    return new Promise((resolve) => {
        let selectedIndex = 0;
        let linesRendered = 0;
        let pendingDelete = false;

        const render = () => {
            if (linesRendered > 0) {
                readline.moveCursor(process.stdout, 0, -linesRendered);
                readline.clearScreenDown(process.stdout);
            }
            if (pendingDelete) {
                process.stdout.write(`  ${C.yellow}Delete account ${C.bold}${results[selectedIndex]?.AccountRaw}${C.reset}${C.yellow}? Press ${C.bold}Y/Enter${C.reset}${C.yellow} to confirm, or ${C.bold}N${C.reset}${C.yellow} to cancel.${C.reset}\n\n`);
            } else {
                process.stdout.write(`  ${C.dim}Use ${C.reset}⬆️ / ⬇️${C.dim} to select, ${C.reset}Enter${C.dim} to confirm, ${C.reset}Del/X${C.dim} to remove:${C.reset}\n\n`);
            }
            printTable(results, selectedIndex);
            linesRendered = 3 + results.length;
        };
        render();

        const onKeyPress = (str: string, key: readline.Key) => {
            if (key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(0);
            }

            if (pendingDelete) {
                if (str === 'y' || str === 'Y' || key.name === 'return' || key.name === 'enter') {
                    const selected = results[selectedIndex];
                    if (selected) {
                        const filePath = path.join(CONFIG.poolDir, `${selected.AccountRaw}.json`);
                        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                        results.splice(selectedIndex, 1);
                        if (selectedIndex >= results.length) selectedIndex = Math.max(0, results.length - 1);
                        if (results.length === 0) {
                            cleanup();
                            console.log(`\n  ${C.yellow}📂 All accounts have been deleted.${C.reset}`);
                            process.exit(0);
                        }
                    }
                    pendingDelete = false;
                } else if (str === 'n' || str === 'N' || key.name === 'escape') {
                    pendingDelete = false;
                }
            } else {
                if (key.name === 'up' && selectedIndex > 0) selectedIndex--;
                else if (key.name === 'down' && selectedIndex < results.length - 1) selectedIndex++;
                else if (key.name === 'return' || key.name === 'enter') {
                    cleanup();
                    return resolve(results[selectedIndex]?.AccountRaw || "");
                } else if (key.name === 'delete' || key.name === 'backspace' || str === 'x' || str === 'X' || str === 'd' || str === 'D') {
                    pendingDelete = true;
                }
            }
            render();
        };

        const cleanup = () => {
            process.stdin.removeListener('keypress', onKeyPress);
            if (process.stdin.isTTY) { process.stdin.setRawMode(false); process.stdin.pause(); }
        };

        if (process.stdin.isTTY) {
            readline.emitKeypressEvents(process.stdin);
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('keypress', onKeyPress);
        } else resolve(results[0]?.AccountRaw || "");
    });
}

async function checkAll(): Promise<QuotaRow[] | null> {
    const files = (await fs.promises.readdir(CONFIG.poolDir)).filter(f => f.endsWith('.json'));
    if (files.length === 0) { console.log(`  ${C.yellow}📂 No auth files found in the pool. Use the 'save' command first.${C.reset}\n`); return null; }

    spinner.start(`Checking quota for ${C.bold}${files.length}${C.reset} accounts...`);
    const results = await Promise.all(files.map(f => checkSingleQuota(path.join(CONFIG.poolDir, f), f.replace('.json', ''))));
    spinner.stop();
    
    return results;
}

async function defaultWorkflow(): Promise<void> {
    printBanner();
    const results = await checkAll();
    if (!results || results.length === 0) return;

    const selectedName = await selectAccountInteractive(results);
    if (!selectedName) return;

    await fs.promises.copyFile(path.join(CONFIG.poolDir, `${selectedName}.json`), CONFIG.activeAuth);
    console.log(`\n  ${C.green}✔${C.reset} Successfully switched active auth to: ${C.bold}${selectedName}${C.reset}`);
    
    const codexArgs = process.argv.slice(2).filter((arg: string) => arg !== 'start'); 
    console.log(`  ${C.cyan}🚀 Running codex...${C.reset}\n`);
    
    spawn('codex', codexArgs, { stdio: 'inherit' }).on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
            console.log(`  ${C.yellow}⚠${C.reset} The 'codex' command was not found on your system.`);
            console.log(`    ${C.dim}Auth switched successfully. You may run your AI CLI manually.${C.reset}\n`);
        } else console.error(`  ${C.red}✖${C.reset} Failed to run codex: ${err.message}\n`);
    });
}

// -----------------------------------------------------------------------------
// CLI Entry Point
// -----------------------------------------------------------------------------

const [cmd, arg1] = process.argv.slice(2);

switch (cmd) {
    case 'save': saveAuth(arg1).catch(console.error); break;
    case 'switch': switchAuth(arg1).catch(console.error); break;
    case 'check':
        printBanner();
        checkAll().then(r => { if (r) { printTable(r, -1); console.log(); } });
        break;
    case 'start':
    case undefined:
        defaultWorkflow().catch(console.error);
        break;
    default:
        printBanner();
        console.log(`  ${C.dim}Usage:${C.reset}\n    ${C.cyan}codex-auth${C.reset}                ${C.gray}Interactive select & run${C.reset}`);
        console.log(`    ${C.cyan}codex-auth save <name>${C.reset}    ${C.gray}Save active auth to pool${C.reset}`);
        console.log(`    ${C.cyan}codex-auth switch [name]${C.reset}  ${C.gray}Switch active auth manually${C.reset}`);
        console.log(`    ${C.cyan}codex-auth check${C.reset}          ${C.gray}Check quotas for all accounts${C.reset}\n`);
}
