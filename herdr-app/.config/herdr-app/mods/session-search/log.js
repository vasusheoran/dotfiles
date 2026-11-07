// Mod logger. This file is duplicated verbatim into every mod folder because mods can't import siblings
// (zaksha-board/log.test.js fails if the copies drift). Lines go to <appHome>/data/logs/<mod>.log.
// fs/promises has no appendFile, stat or rename, so an append is read + write and rotation is copy + write.
import * as nodefs from "fs/promises";

export const LOG_MAX = 256 * 1024; // rotate when the file is over this; keep .1 and .2
export const logPath = (dir, mod) => `${dir}/data/logs/${mod}.log`;
export const needsRotate = (size) => size > LOG_MAX;

export function formatLine(now, level, mod, msg, data) {
  let tail = "";
  if (data !== undefined) { try { tail = ` ${JSON.stringify(data)}`; } catch { tail = " [unserialisable]"; } }
  return `${new Date(now).toISOString()} ${String(level).toUpperCase()} ${mod} ${String(msg).replace(/\n/g, " ")}${tail}\n`;
}

// makeLog("mod", { dir: appHome() }) -> log(level, msg, data?). Fire and forget; log.flush() resolves when written.
export function makeLog(mod, { dir, fs = nodefs, now = Date.now }) {
  const path = logPath(dir, mod);
  let chain = Promise.resolve();
  let made = false;
  const read = (p) => fs.readFile(p, "utf8").catch(() => null);
  const append = async (line) => {
    if (!made) { await fs.mkdir(`${dir}/data/logs`, { recursive: true }); made = true; }
    const cur = (await read(path)) ?? "";
    if (!needsRotate(cur.length)) return fs.writeFile(path, cur + line);
    const old = await read(`${path}.1`);
    if (old !== null) await fs.writeFile(`${path}.2`, old);
    await fs.writeFile(`${path}.1`, cur);
    await fs.writeFile(path, line);
  };
  const log = (level, msg, data) => {
    const line = formatLine(now(), level, mod, msg, data);
    chain = chain.then(() => append(line)).catch(() => {}); // a failed write is dropped
  };
  log.flush = () => chain;
  return log;
}
