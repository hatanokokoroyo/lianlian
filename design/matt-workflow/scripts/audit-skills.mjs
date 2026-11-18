#!/usr/bin/env node
// 对账：.agents/skills/ 的已安装 skill、skills-lock.json、data/skills.js。
// 用法：node design/matt-workflow/scripts/audit-skills.mjs
// 退出码 0 表示一致；1 表示有新增、删除、改名或字段缺失。

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const skillsDir = path.join(root, ".agents/skills");
const dataFile = path.join(here, "../data/skills.js");
const lockFile = path.join(root, "skills-lock.json");

const LANES = new Set(["路由", "主干", "底座", "支路", "入口", "健康", "词汇", "独立", "工具箱"]);
const NEED = new Set(["none", "optional", "recommended", "required", "required-degradable", "human"]);
const SHARE = new Set(["team-authoritative", "repo-derived", "local-ephemeral", "secret", "none"]);
const FIELDS = ["name", "cn", "lane", "trigger", "session", "outputs", "remote", "remoteNeed", "share", "note", "source"];

const errors = [];
const warnings = [];
const fail = msg => errors.push(msg);

function readSkills() {
  if (!fs.existsSync(dataFile)) {
    fail(`缺少数据文件：${path.relative(root, dataFile)}`);
    return [];
  }
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(fs.readFileSync(dataFile, "utf8"), sandbox, { filename: dataFile });
  } catch (err) {
    fail(`data/skills.js 无法执行：${err.message}`);
    return [];
  }
  if (!Array.isArray(sandbox.window.SKILLS)) {
    fail("data/skills.js 没有导出 window.SKILLS 数组");
    return [];
  }
  return sandbox.window.SKILLS;
}

function installedSkills() {
  if (!fs.existsSync(skillsDir)) return null;
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")))
    .map(d => d.name)
    .sort();
}

function lockSkills() {
  if (!fs.existsSync(lockFile)) {
    warnings.push("没有 skills-lock.json，跳过 lock 对账");
    return null;
  }
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    return Object.keys(lock.skills || {}).sort();
  } catch (err) {
    fail(`skills-lock.json 无法解析：${err.message}`);
    return null;
  }
}

function diff(label, expected, actual) {
  const e = new Set(expected);
  const a = new Set(actual);
  const missing = [...e].filter(x => !a.has(x));
  const extra = [...a].filter(x => !e.has(x));
  if (missing.length) fail(`${label} 缺少：${missing.join(", ")}`);
  if (extra.length) fail(`${label} 多出：${extra.join(", ")}`);
}

const skills = readSkills();
const installed = installedSkills();
const locked = lockSkills();
const dataNames = skills.map(s => s.name);
const installedNames = installed ?? locked ?? [];
const sourceLabel = installed ? ".agents/skills/" : "skills-lock.json（.agents/skills 不存在）";

if (!installed) warnings.push(".agents/skills 不存在，改用 skills-lock.json 对账");

if (skills.length !== 37) fail(`data/skills.js 应为 37 条，实际 ${skills.length} 条`);

const seen = new Set();
for (const s of skills) {
  const at = `skill「${s.name || "(未命名)"}」`;
  if (!s.name) fail("存在没有 name 的记录");
  if (seen.has(s.name)) fail(`${at} 重复`);
  seen.add(s.name);

  for (const key of FIELDS) {
    if (!(key in s)) fail(`${at} 缺字段 ${key}`);
  }
  if (!LANES.has(s.lane)) fail(`${at} lane 非法：${s.lane}`);
  if (!NEED.has(s.remoteNeed)) fail(`${at} remoteNeed 非法：${s.remoteNeed}`);
  if (!SHARE.has(s.share)) fail(`${at} share 非法：${s.share}`);
  if (!Array.isArray(s.outputs)) fail(`${at} outputs 不是数组`);
  if (!Array.isArray(s.remote)) fail(`${at} remote 不是数组`);

  const want = `.agents/skills/${s.name}/SKILL.md`;
  if (s.source !== want) fail(`${at} source 应为 ${want}，实际 ${s.source}`);
  if (installed && !fs.existsSync(path.join(root, want))) fail(`${at} 原文不存在：${want}`);
}

if (installed) diff("data/skills.js ↔ .agents/skills", installedNames, dataNames);
if (locked) {
  const lockMissing = dataNames.filter(n => !locked.includes(n));
  if (lockMissing.length) fail(`skills-lock.json 缺少：${lockMissing.join(", ")}`);
  const lockExtra = locked.filter(n => !dataNames.includes(n));
  if (lockExtra.length) warnings.push(`lock 另有未纳入 deck 的 skill：${lockExtra.join(", ")}`);
}

const counts = skills.reduce((acc, s) => {
  acc[s.lane] = (acc[s.lane] || 0) + 1;
  return acc;
}, {});

if (errors.length) {
  console.error(`✗ skill 对账失败（数据源：${sourceLabel}）`);
  for (const e of errors) console.error(`  - ${e}`);
  for (const w of warnings) console.error(`  ! ${w}`);
  process.exit(1);
}

console.log(`✓ skill 对账通过：${skills.length} 条（${sourceLabel}）`);
console.log("  " + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · "));
for (const w of warnings) console.log(`  ! ${w}`);
