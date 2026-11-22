// 共道文明 · 公开账目计算
// 读取 finance.json，算出每个基金/专项的收入、支出、结余，以及可下载的 CSV。
// 金额一律按“分”整数计算，避免小数误差。
import { readFile } from "node:fs/promises";

const cents = (x) => Math.round(Number(x || 0) * 100);
const money = (c) => (c / 100).toFixed(2);

export default async function () {
  const raw = JSON.parse(await readFile(new URL("./finance.json", import.meta.url), "utf8"));
  const projects = raw.projects.map((p) => ({
    ...p,
    income: 0, expense: 0, transferIn: 0, transferOut: 0,
    byCategory: {}, entries: [],
  }));
  const bySlug = Object.fromEntries(projects.map((p) => [p.slug, p]));

  const problems = [];
  const ids = new Set();
  const entries = [...raw.entries].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)
  );

  for (const e of entries) {
    if (ids.has(e.id)) problems.push(`编号重复：${e.id}`);
    ids.add(e.id);
    const f = bySlug[e.fund];
    if (!f) { problems.push(`${e.id}：找不到基金 ${e.fund}`); continue; }
    const to = e.kind === "调拨" ? bySlug[e.to] : null;
    if (e.kind === "调拨" && !to) { problems.push(`${e.id}：调拨目标 ${e.to} 不存在`); continue; }
    const c = cents(e.amount);
    e.amountText = money(c);
    if (!e.void) {
      if (e.kind === "收入") f.income += c;
      else if (e.kind === "支出") {
        f.expense += c;
        f.byCategory[e.category] = (f.byCategory[e.category] || 0) + c;
      } else if (e.kind === "调拨") { f.transferOut += c; to.transferIn += c; }
      else problems.push(`${e.id}：未知类型 ${e.kind}`);
    }
    f.entries.push(e);
    if (to) to.entries.push(e);
  }

  for (const p of projects) {
    p.balance = p.income + p.transferIn - p.expense - p.transferOut;
    p.raisedText = money(p.income + p.transferIn);
    p.incomeText = money(p.income);
    p.expenseText = money(p.expense);
    p.balanceText = money(p.balance);
    p.categories = Object.entries(p.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([name, c]) => ({ name, amountText: money(c) }));
    if (p.target) p.percent = Math.min(100, Math.round(((p.income + p.transferIn) / cents(p.target)) * 100));
    if (p.status === "已完结" && p.balance !== 0) problems.push(`专项 ${p.name} 已标为完结，但结余不为 0`);
    delete p.byCategory;
  }

  // 每条记录在本基金中的滚动结余（显示在总表里）
  const running = {};
  for (const e of entries) {
    if (!bySlug[e.fund]) continue;
    const c = e.void ? 0 : cents(e.amount);
    running[e.fund] = (running[e.fund] || 0) + (e.kind === "收入" ? c : -c);
    if (e.kind === "调拨" && e.to) running[e.to] = (running[e.to] || 0) + c;
    e.fundBalanceText = money(running[e.fund]);
    e.fundName = bySlug[e.fund].name;
    e.toName = e.to ? bySlug[e.to]?.name : "";
  }

  const live = entries.filter((e) => !e.void);
  const sum = (k) => live.filter((e) => e.kind === k).reduce((s, e) => s + cents(e.amount), 0);
  const totals = {
    income: money(sum("收入")),
    expense: money(sum("支出")),
    balance: money(sum("收入") - sum("支出")),
    count: entries.length,
    voided: entries.length - live.length,
  };
  const general = projects.find((p) => p.type === "general");
  const adminExpense = general ? general.expense : 0;
  const projectExpense = sum("支出") - adminExpense;
  totals.adminExpense = money(adminExpense);
  totals.projectExpense = money(projectExpense);

  // CSV（带 BOM，Excel 直接打开不乱码）
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["编号", "日期", "类型", "基金/专项", "调入", "类别", "金额USD", "原币金额", "对方", "交易尾号", "说明", "凭证", "作废日期", "作废理由", "示例数据"];
  const rows = entries.map((e) => [
    e.id, e.date, e.kind, e.fundName, e.toName, e.category, e.amountText, e.original, e.party,
    e.ref, e.note, e.proof, e.void?.date, e.void?.reason, e.example ? "是" : "",
  ]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";

  if (problems.length) console.warn("[账目检查]\n  " + problems.join("\n  "));

  return {
    currency: raw.currency,
    updated: raw.updated,
    projects,
    general,
    specials: projects.filter((p) => p.type !== "general"),
    entries: [...entries].reverse(), // 最新的在前
    reconciliations: raw.reconciliations || [],
    totals,
    problems,
    hasExamples: entries.some((e) => e.example) || projects.some((p) => p.example),
    csv,
    json: JSON.stringify(raw, null, 2),
  };
}
