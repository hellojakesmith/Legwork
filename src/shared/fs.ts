import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    return fallback;
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
