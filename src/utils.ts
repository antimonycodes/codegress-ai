import fs from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import chalk from "chalk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

// dotenv.config();

const GEMINI_API_KEY = "";

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

export async function getProjectVision(): Promise<string> {
  try {
    const readmeContent = await readFile("README.md");
    if (readmeContent.trim()) {
      return readmeContent.split("\n").slice(0, 3).join(" ").trim();
    }
  } catch (err) {
    // Ignore — no README
  }

  // ALWAYS prompt if no README
  const { vision } = await inquirer.prompt([
    {
      type: "input",
      name: "vision",
      message: 'Enter a brief project vision (e.g., "React + Node auth app"):',
      validate: (input) => (input.trim() ? true : "Vision is required"),
    },
  ]);
  return vision.trim();
}

export function getGeminiClient(): GoogleGenerativeAI | null {
  if (!GEMINI_API_KEY) {
    logError("AI disabled: Internal key missing.");
    return null;
  }
  //   console.log(GEMINI_API_KEY);
  return new GoogleGenerativeAI(GEMINI_API_KEY);
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
