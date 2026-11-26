// 共道推荐的条目：src/_recommends/<id>.json（由网站上的“推荐”表单经后台写入仓库）
// 新的在前。status: listed 已收录 | joined 已入驻道场
import { readdir, readFile } from "node:fs/promises";

export default async function () {
  const dir = new URL("../_recommends/", import.meta.url);
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const list = await Promise.all(files.map(async (f) => JSON.parse(await readFile(new URL(f, dir), "utf8"))));
  return list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
