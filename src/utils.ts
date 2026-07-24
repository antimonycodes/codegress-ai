import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { exec } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

export async function readFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function writeJson(filePath: string, data: any): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function writeMd(
  filePath: string,
  content: string
): Promise<void> {
  await fs.writeFile(filePath, content, "utf-8");
}

export async function writeHtml(
  filePath: string,
  content: string
): Promise<void> {
  await fs.writeFile(filePath, content, "utf-8");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isGitHookRun(): boolean {
  return process.env.GIT_EXEC_PATH !== undefined;
}

export function logSuccess(msg: string) {
  if (!isGitHookRun()) console.log(chalk.green(`Codegress: ${msg}`));
}

export function logError(msg: string) {
  if (!isGitHookRun()) console.log(chalk.red(`Codegress: ${msg}`));
}

export function getGeminiClient(): GoogleGenerativeAI | null {
  if (!GEMINI_API_KEY) {
    logError("AI disabled: Internal key missing.");
    return null;
  }
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

export async function execGitCommand(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch (error) {
    return "";
  }
}

export async function getDirectories(
  root: string,
  ignored: string[]
): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !ignored.includes(entry.name))
    .map((entry) => path.join(root, entry.name));
}
