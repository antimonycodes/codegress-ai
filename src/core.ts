import fs from "fs/promises";
import path from "path";
import { Config, TasksData, Task, ModuleTasks } from "./types";
import {
  getDirectories,
  writeJson,
  writeMd,
  readFile,
  logSuccess,
  logError,
  getProjectVision,
  fileExists,
  getGeminiClient,
} from "./utils";

const CONFIG_DIR = ".codegress";
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const TASKS_JSON_PATH = "tasks.json";
const TASKS_MD_PATH = "tasks.md";
const README_PATH = "README.md";

const BADGE = (percent: number) =>
  `![Codegress Progress](https://img.shields.io/badge/codegress-${percent}%25-${
    percent >= 90 ? "brightgreen" : percent >= 50 ? "yellow" : "red"
  })`;

// Project maturity detection
interface ProjectMaturity {
  isNew: boolean;
  maturityLevel: "empty" | "skeleton" | "developing" | "mature";
  totalFiles: number;
  hasPackageJson: boolean;
  hasTests: boolean;
  hasDependencies: boolean;
  estimatedCompletion: number;
}

async function detectProjectMaturity(): Promise<ProjectMaturity> {
  let totalFiles = 0;
  let hasTests = false;
  let hasPackageJson = false;
  let hasDependencies = false;

  try {
    // Check package.json
    const pkgPath = path.join(process.cwd(), "package.json");
    if (await fileExists(pkgPath)) {
      hasPackageJson = true;
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
      hasDependencies = Object.keys(pkg.dependencies || {}).length > 0;
    }

    // Count all project files
    const allFiles = await getAllFilesRecursive(process.cwd());
    totalFiles = allFiles.length;
    hasTests = allFiles.some(
      (f) =>
        f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__")
    );
  } catch (e) {}

  let maturityLevel: ProjectMaturity["maturityLevel"] = "empty";
  let estimatedCompletion = 0;
  let isNew = true;

  if (totalFiles === 0) {
    maturityLevel = "empty";
    estimatedCompletion = 0;
    isNew = true;
  } else if (totalFiles < 5 && !hasDependencies) {
    maturityLevel = "skeleton";
    estimatedCompletion = 10;
    isNew = true;
  } else if (totalFiles < 20 && !hasTests) {
    maturityLevel = "developing";
    estimatedCompletion = 40;
    isNew = false;
  } else {
    maturityLevel = "mature";
    estimatedCompletion = hasTests ? 70 : 50;
    isNew = false;
  }

  return {
    isNew,
    maturityLevel,
    totalFiles,
    hasPackageJson,
    hasTests,
    hasDependencies,
    estimatedCompletion,
  };
}

// Deep module analysis
interface ModuleAnalysis {
  files: string[];
  fileTypes: Record<string, number>;
  hasTests: boolean;
  hasComponents: boolean;
  hasAPI: boolean;
  hasModels: boolean;
  hasConfig: boolean;
  hasStyles: boolean;
  hasDocs: boolean;
  totalFiles: number;
  codePatterns: string[];
  isEmpty: boolean;
}

async function analyzeModule(modulePath: string): Promise<ModuleAnalysis> {
  const analysis: ModuleAnalysis = {
    files: [],
    fileTypes: {},
    hasTests: false,
    hasComponents: false,
    hasAPI: false,
    hasModels: false,
    hasConfig: false,
    hasStyles: false,
    hasDocs: false,
    totalFiles: 0,
    codePatterns: [],
    isEmpty: true,
  };

  try {
    const allFiles = await getAllFilesRecursive(modulePath);
    analysis.files = allFiles.map((f) => path.relative(modulePath, f));
    analysis.totalFiles = allFiles.length;
    analysis.isEmpty = allFiles.length === 0;

    for (const file of allFiles) {
      const ext = path.extname(file);
      const basename = path.basename(file).toLowerCase();
      const content = await fs.readFile(file, "utf-8").catch(() => "");

      // Count file types
      analysis.fileTypes[ext] = (analysis.fileTypes[ext] || 0) + 1;

      // Detect patterns
      if (basename.includes("test") || basename.includes("spec"))
        analysis.hasTests = true;
      if (basename.includes("readme") || basename.includes("doc"))
        analysis.hasDocs = true;
      if (ext === ".css" || ext === ".scss" || ext === ".sass")
        analysis.hasStyles = true;
      if (basename.includes("config") || basename === ".env")
        analysis.hasConfig = true;

      // Code analysis
      if ([".ts", ".tsx", ".js", ".jsx"].includes(ext) && content.length > 50) {
        if (
          content.includes("Component") ||
          content.includes("useState") ||
          content.includes("useEffect")
        ) {
          analysis.hasComponents = true;
          analysis.codePatterns.push("React Component");
        }
        if (
          content.includes("app.get") ||
          content.includes("app.post") ||
          content.includes("router.")
        ) {
          analysis.hasAPI = true;
          analysis.codePatterns.push("API Endpoint");
        }
        if (
          content.includes("Schema") ||
          content.includes("model") ||
          content.includes("interface")
        ) {
          analysis.hasModels = true;
          analysis.codePatterns.push("Data Model");
        }

        // Extract function/class names
        const functions = content.match(
          /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g
        );
        const classes = content.match(/(?:export\s+)?class\s+(\w+)/g);
        if (functions) analysis.codePatterns.push(...functions.slice(0, 2));
        if (classes) analysis.codePatterns.push(...classes.slice(0, 2));
      }
    }
  } catch (error) {
    console.error(`Failed to analyze ${modulePath}`);
  }

  return analysis;
}

async function getAllFilesRecursive(dir: string): Promise<string[]> {
  const ignoreDirs = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".codegress",
  ];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (ignoreDirs.includes(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await getAllFilesRecursive(fullPath)));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  } catch {
    return [];
  }
}

// Get comprehensive project context
async function getProjectContext(): Promise<string> {
  const context: string[] = [];

  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

    const deps = Object.keys(pkg.dependencies || {});
    const devDeps = Object.keys(pkg.devDependencies || {});

    // Detect tech stack
    const techStack: string[] = [];
    if (deps.includes("react")) techStack.push("React");
    if (deps.includes("vue")) techStack.push("Vue");
    if (deps.includes("express")) techStack.push("Express");
    if (deps.includes("next")) techStack.push("Next.js");
    if (deps.some((d) => d.includes("spotify"))) techStack.push("Spotify API");
    if (deps.includes("mongoose") || deps.includes("mongodb"))
      techStack.push("MongoDB");
    if (deps.includes("typescript")) techStack.push("TypeScript");

    context.push(`Tech Stack: ${techStack.join(", ") || "Vanilla JS"}`);
    context.push(`Key Dependencies: ${deps.slice(0, 6).join(", ")}`);

    if (pkg.scripts) {
      context.push(`Available Scripts: ${Object.keys(pkg.scripts).join(", ")}`);
    }
  } catch (e) {
    context.push("No package.json - likely a new project");
  }

  try {
    const readme = await fs.readFile(README_PATH, "utf-8");
    const lines = readme
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"));
    if (lines.length > 0) {
      context.push(`Project Info: ${lines.slice(0, 2).join(" ")}`);
    }
  } catch (e) {}

  return context.join("\n");
}

// SMART AI task generation - adapts to project state
async function generateAITasks(
  moduleName: string,
  vision: string
): Promise<string[]> {
  const genAI = getGeminiClient();
  if (!genAI) return [];

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
      },
    });

    // Gather intelligence
    const projectMaturity = await detectProjectMaturity();
    const modulePath = path.join(process.cwd(), moduleName);
    const moduleAnalysis = await analyzeModule(modulePath);
    const projectContext = await getProjectContext();

    // Build smart prompt based on project state
    let prompt = "";

    if (projectMaturity.isNew && moduleAnalysis.isEmpty) {
      // NEW PROJECT - suggest foundational tasks
      prompt = `You are setting up a NEW project from scratch.

Project Vision: ${vision}
${projectContext}

Module: "${moduleName}" (currently EMPTY)
Project Status: ${projectMaturity.maturityLevel.toUpperCase()} - estimated ${
        projectMaturity.estimatedCompletion
      }% complete

Suggest 3-5 foundational tasks to START building this module:
- Initial file structure setup
- Basic configuration
- Core functionality scaffolding
- Essential dependencies

One task per line, no numbering. Be specific and actionable.`;
    } else {
      // EXISTING PROJECT - suggest next steps
      const statusLines = [
        `Total files: ${moduleAnalysis.totalFiles}`,
        `File types: ${Object.entries(moduleAnalysis.fileTypes)
          .map(([ext, count]) => `${ext}(${count})`)
          .join(", ")}`,
        `✓ Tests: ${moduleAnalysis.hasTests ? "YES" : "NO"}`,
        `✓ Components: ${moduleAnalysis.hasComponents ? "YES" : "NO"}`,
        `✓ API Routes: ${moduleAnalysis.hasAPI ? "YES" : "NO"}`,
        `✓ Data Models: ${moduleAnalysis.hasModels ? "YES" : "NO"}`,
        `✓ Documentation: ${moduleAnalysis.hasDocs ? "YES" : "NO"}`,
      ];

      if (moduleAnalysis.codePatterns.length > 0) {
        statusLines.push(
          `Code found: ${moduleAnalysis.codePatterns.slice(0, 5).join(", ")}`
        );
      }

      prompt = `You are analyzing an EXISTING project to suggest improvements.

Project Vision: ${vision}
${projectContext}

Module: "${moduleName}"
Project Status: ${projectMaturity.maturityLevel.toUpperCase()} - estimated ${
        projectMaturity.estimatedCompletion
      }% complete

Current Module State:
${statusLines.join("\n")}

Sample files:
${moduleAnalysis.files.slice(0, 8).join("\n")}

Based on what EXISTS and what's MISSING, suggest 3-5 specific NEXT tasks:
${
  !moduleAnalysis.hasTests && moduleAnalysis.totalFiles > 0
    ? "- Priority: Add tests!"
    : ""
}
${
  !moduleAnalysis.hasDocs && moduleAnalysis.totalFiles > 5
    ? "- Priority: Add documentation!"
    : ""
}
- Focus on gaps, improvements, and missing best practices
- Suggest refactoring if code exists but needs cleanup
- Recommend integration points

One task per line, no numbering. Be specific and actionable.`;
    }

    console.log(
      `\nGenerating tasks for ${
        projectMaturity.isNew ? "NEW" : "EXISTING"
      } project...`
    );
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    if (!text || text.length === 0) {
      throw new Error("AI returned empty response");
    }

    console.log("AI Response:", text);

    return text
      .split("\n")
      .map((line) => line.replace(/^\d+\.\s*|-\s*|\*\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch (error: any) {
    console.error("AI generation failed:", error.message);

    // Intelligent fallback
    const modulePath = path.join(process.cwd(), moduleName);
    const moduleAnalysis = await analyzeModule(modulePath);
    const projectMaturity = await detectProjectMaturity();

    return generateIntelligentFallback(
      moduleName,
      moduleAnalysis,
      projectMaturity.isNew
    );
  }
}

// Intelligent fallback tasks
function generateIntelligentFallback(
  moduleName: string,
  analysis: ModuleAnalysis,
  isNewProject: boolean
): string[] {
  const tasks: string[] = [];

  if (isNewProject || analysis.isEmpty) {
    // New project tasks
    return [
      `Create initial folder structure for ${moduleName}`,
      `Set up entry point file (index.ts/js) in ${moduleName}`,
      `Add basic configuration files`,
      `Create README.md with module documentation`,
      `Set up initial exports and module interface`,
    ];
  }

  // Existing project - focus on gaps
  if (!analysis.hasTests && analysis.totalFiles > 0) {
    tasks.push(`Add comprehensive unit tests for ${moduleName}`);
    if (analysis.hasAPI)
      tasks.push(`Write integration tests for API endpoints`);
    if (analysis.hasComponents)
      tasks.push(`Add component tests with testing library`);
  }

  if (!analysis.hasDocs) {
    tasks.push(`Document public APIs and functions in ${moduleName}`);
    tasks.push(`Add JSDoc comments to main exports`);
  }

  if (analysis.totalFiles > 0 && !analysis.hasConfig) {
    tasks.push(`Add configuration management for ${moduleName} settings`);
  }

  if (analysis.hasAPI && !analysis.hasModels) {
    tasks.push(`Define data models and validation schemas`);
  }

  if (analysis.totalFiles > 5) {
    tasks.push(`Refactor ${moduleName} for better code organization`);
    tasks.push(
      `Add error handling and input validation throughout ${moduleName}`
    );
    tasks.push(`Implement logging and monitoring in ${moduleName}`);
  }

  return tasks.slice(0, 5);
}

export async function autoInitialize(): Promise<void> {
  try {
    const configExists = await fileExists(CONFIG_PATH);
    if (configExists) {
      logSuccess("Already initialized.");
      return;
    }

    console.log("Codegress: Getting project vision...");
    const vision = await getProjectVision();
    console.log(`Codegress: Vision = "${vision}"`);

    // Detect project state
    const maturity = await detectProjectMaturity();
    console.log(
      `Codegress: Detected ${maturity.isNew ? "NEW" : "EXISTING"} project (${
        maturity.maturityLevel
      }, ~${maturity.estimatedCompletion}% complete)`
    );

    const genAI = getGeminiClient();
    const config: Config = {
      projectVision: vision,
      ignoredFolders: ["node_modules", ".git", "dist", ".codegress"],
      autoAI: !!genAI,
    };

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await writeJson(CONFIG_PATH, config);
    logSuccess("Config created.");

    const tasksData = await generateInitialTasks(config);
    await updateTasksMd(tasksData);
    await injectBadgeIntoReadme(tasksData);
    logSuccess("AI tasks generated.");
  } catch (err) {
    console.error("Codegress: FATAL ERROR in autoInitialize:", err);
    process.exit(1);
  }
}

async function generateInitialTasks(config: Config): Promise<TasksData> {
  const modules: Record<string, ModuleTasks> = {};
  const rootDirs = await getDirectories(".", config.ignoredFolders);

  for (const dirPath of rootDirs) {
    const moduleName = path.basename(dirPath);
    const modulePath = path.join(process.cwd(), moduleName);
    const analysis = await analyzeModule(modulePath);

    // Smart base tasks that auto-detect completion
    const baseTasks: Task[] = [];

    baseTasks.push({
      task: `Set up ${moduleName} folder structure`,
      done: !analysis.isEmpty,
    });

    baseTasks.push({
      task: `Implement core functionality in ${moduleName}`,
      done:
        analysis.hasComponents || analysis.hasAPI || analysis.totalFiles > 3,
    });

    baseTasks.push({
      task: `Add error handling and validation in ${moduleName}`,
      done: false, // Rarely truly complete
    });

    baseTasks.push({
      task: `Write tests for ${moduleName}`,
      done: analysis.hasTests,
    });

    let allTasks = baseTasks;

    // Add AI-generated tasks
    if (config.autoAI) {
      const aiTasks = await generateAITasks(moduleName, config.projectVision);
      allTasks = [
        ...baseTasks,
        ...aiTasks.map((t) => ({ task: t, done: false })),
      ];
    }

    modules[moduleName] = {
      tasks: allTasks,
      progress: calculateModuleProgress(allTasks),
    };
  }

  const tasksData: TasksData = {
    modules,
    overallProgress: calculateOverallProgress(modules),
  };
  await writeJson(TASKS_JSON_PATH, tasksData);
  return tasksData;
}

export async function updateTasks(): Promise<void> {
  const config = await loadConfig();
  const tasksData = await loadTasks();

  for (const [moduleName, module] of Object.entries(tasksData.modules)) {
    const modulePath = path.join(".", moduleName);
    try {
      const analysis = await analyzeModule(modulePath);

      module.tasks.forEach((task) => {
        const taskLower = task.task.toLowerCase();

        // Intelligent task completion detection
        if (taskLower.includes("set up") || taskLower.includes("structure")) {
          task.done = !analysis.isEmpty;
        }
        if (
          taskLower.includes("core") ||
          taskLower.includes("implement") ||
          taskLower.includes("functionality")
        ) {
          task.done =
            analysis.hasComponents ||
            analysis.hasAPI ||
            analysis.totalFiles > 3;
        }
        if (taskLower.includes("test")) {
          task.done = analysis.hasTests;
        }
        if (taskLower.includes("component")) {
          task.done = analysis.hasComponents;
        }
        if (taskLower.includes("api") || taskLower.includes("endpoint")) {
          task.done = analysis.hasAPI;
        }
        if (taskLower.includes("model") || taskLower.includes("schema")) {
          task.done = analysis.hasModels;
        }
        if (taskLower.includes("doc") || taskLower.includes("readme")) {
          task.done = analysis.hasDocs;
        }
        if (taskLower.includes("config")) {
          task.done = analysis.hasConfig;
        }
      });

      module.progress = calculateModuleProgress(module.tasks);
    } catch {
      // Module no longer exists
    }
  }

  tasksData.overallProgress = calculateOverallProgress(tasksData.modules);
  await writeJson(TASKS_JSON_PATH, tasksData);
}

export async function updateAndRefresh(): Promise<void> {
  await updateTasks();
  const tasksData = await loadTasks();
  await updateTasksMd(tasksData);
  await injectBadgeIntoReadme(tasksData);
}

async function updateTasksMd(tasksData: TasksData): Promise<void> {
  let mdContent = "# Codegress Tasks\n\n";
  mdContent += `Overall Progress: ${tasksData.overallProgress}%\n\n`;

  for (const [moduleName, module] of Object.entries(tasksData.modules)) {
    mdContent += `## ${moduleName} (${module.progress}%)\n`;
    module.tasks.forEach((task) => {
      mdContent += `- [${task.done ? "x" : " "}] ${task.task}\n`;
    });
    mdContent += "\n";
  }

  await writeMd(TASKS_MD_PATH, mdContent);
}

async function injectBadgeIntoReadme(tasksData: TasksData): Promise<void> {
  const badge = BADGE(tasksData.overallProgress);

  let readme = "";
  try {
    readme = await readFile(README_PATH);
  } catch {
    readme = "# My Project\n\n";
  }

  const cleanReadme = readme.replace(/!\[Codegress Progress\].*\n/g, "");
  const newReadme = badge + "\n\n" + cleanReadme.trim() + "\n";

  await writeMd(README_PATH, newReadme);
}

async function loadConfig(): Promise<Config> {
  if (!(await fileExists(CONFIG_PATH))) throw new Error("Run init first.");
  const content = await readFile(CONFIG_PATH);
  return JSON.parse(content);
}

async function loadTasks(): Promise<TasksData> {
  if (!(await fileExists(TASKS_JSON_PATH)))
    throw new Error("No tasks; run init.");
  const content = await readFile(TASKS_JSON_PATH);
  return JSON.parse(content);
}

function calculateModuleProgress(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  const doneCount = tasks.filter((t) => t.done).length;
  return Math.round((doneCount / tasks.length) * 100);
}

function calculateOverallProgress(
  modules: Record<string, ModuleTasks>
): number {
  const progs = Object.values(modules).map((m) => m.progress);
  if (progs.length === 0) return 0;
  return Math.round(progs.reduce((a, b) => a + b, 0) / progs.length);
}
