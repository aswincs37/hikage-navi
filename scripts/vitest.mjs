// Vitest をドライブ文字を大文字にそろえた作業フォルダーで起動する（npm test / test:watch から使う）。
// Windows で作業フォルダーが小文字（d:\…。VS Code・Git Bash のターミナルで起こる）のまま起動すると、
// Vitest 本体がテストから別モジュールとして二重に読み込まれ、全テストが
// 「Cannot read properties of undefined (reading 'config')」で失敗する。
// 設定ファイルが読まれる時点では手遅れなので、Vitest を読み込む前の別プロセスで直す。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const cwd = process.platform === "win32" && /^[a-z]:/.test(process.cwd()) ? process.cwd()[0].toUpperCase() + process.cwd().slice(1) : process.cwd();
const cli = path.join(path.dirname(createRequire(path.join(cwd, "package.json")).resolve("vitest/package.json")), "vitest.mjs");

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { cwd, stdio: "inherit" });
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)));
