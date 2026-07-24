import fs from "fs/promises";
import path from "path";
import { Config, DashboardData, CommitActivity } from "./types";
import {
  writeJson,
  writeHtml,
  readFile,
  logSuccess,
  logError,
  fileExists,
  getGeminiClient,
  execGitCommand,
} from "./utils";

const CONFIG_DIR = ".codegress";
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DASHBOARD_JSON_PATH = path.join(CONFIG_DIR, "dashboard.json");
const HTML_PATH = "codegress-dashboard.html";

async function getGitHistory(limit: number): Promise<CommitActivity[]> {
  const log = await execGitCommand(
    `git log -n ${limit} --pretty=format:"%H|%cd|%s" --date=short`
  );
  if (!log) return [];

  return log.split("\n").map((line) => {
    const [hash, date, ...messageParts] = line.split("|");
    return { hash, date, message: messageParts.join("|") };
  });
}

async function getLatestCommit(): Promise<CommitActivity | null> {
  const log = await execGitCommand(
    `git log -1 --pretty=format:"%H|%cd|%s" --date=short`
  );
  if (!log) return null;
  const [hash, date, ...messageParts] = log.split("|");
  return { hash, date, message: messageParts.join("|") };
}

async function generateAIFeatures(
  commit: CommitActivity
): Promise<string[]> {
  const genAI = getGeminiClient();
  const commitMessage = `- ${commit.message}`;
  
  if (genAI) {
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash-exp",
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
        },
      });

      const prompt = `You are a strict project manager analyzing developer activity. I have the following git commit message.
Provide a professional, formal breakdown of exactly what was accomplished, what changes were made, and the overall impact.
Do not use technical jargon if a simple term works. 
Output 1-3 formal bullet points summarizing the work done. Do not output anything other than the bullet points.

Commit:
${commitMessage}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      return text
        .split("\n")
        .map((line) => line.replace(/^[-*]\s*/, "").trim())
        .filter((line) => line.length > 0);
    } catch (error) {
      console.error("Gemini AI failed:", error);
    }
  }

  // Fallback to Cloudflare Worker Proxy
  try {
    const proxyUrl = process.env.AI_PROXY_URL || "https://codegress-ai.akinrinadetobilobasb.workers.dev";
    
    const prompt = `You are a strict project manager analyzing developer activity. I have the following git commit message.
Provide a professional, formal breakdown of exactly what was accomplished, what changes were made, and the overall impact.
Do not use technical jargon if a simple term works. 
Summarize the work done in 1-3 formal bullet points. 
Return ONLY a valid JSON array of strings, like: ["bullet 1", "bullet 2"]

Commit:
${commitMessage}`;

    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    if (!res.ok) {
      throw new Error(`Proxy error: ${res.status}`);
    }

    const data = await res.json() as any;
    if (data.success && data.text) {
      if (Array.isArray(data.text)) {
        return data.text.map((item: any) => String(item).trim());
      }
      
      try {
        let cleanText = typeof data.text === "string" ? data.text.trim() : JSON.stringify(data.text);
        if (cleanText.startsWith("```json")) {
          cleanText = cleanText.replace(/```json/g, "").replace(/```/g, "").trim();
        } else if (cleanText.startsWith("```")) {
          cleanText = cleanText.replace(/```/g, "").trim();
        }
        
        const parsed = JSON.parse(cleanText);
        if (Array.isArray(parsed)) {
          return parsed.map((item: any) => String(item).trim());
        }
      } catch (e) {
        console.error("Failed to parse JSON from proxy:", data.text);
        if (typeof data.text === "string") {
          return data.text.split("\n").map((l: string) => l.replace(/^[-*]\s*/, "").replace(/[\[\]"]/g, "").trim()).filter(Boolean);
        } else if (Array.isArray(data.text)) {
          return data.text.map((item: any) => String(item).trim());
        }
      }
    }
  } catch (error) {
    console.error("Proxy AI failed:", error);
  }

  return ["AI Summary disabled or failed. Raw commit shown."];
}

export async function autoInitialize(): Promise<void> {
  try {
    const configExists = await fileExists(CONFIG_PATH);
    if (configExists) {
      logSuccess("Already initialized.");
      return;
    }

    logSuccess("Initializing Codegress Dashboard...");

    const genAI = getGeminiClient();
    const config: Config = {
      ignoredFolders: ["node_modules", ".git", "dist", ".codegress"],
      autoAI: !!genAI,
    };

    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await writeJson(CONFIG_PATH, config);
    logSuccess("Config created.");

    // Generate Initial Dashboard
    const commits = await getGitHistory(10); // Limit to 10 for initial so we don't spam AI

    let projectName = path.basename(process.cwd());
    try {
      const pkg = JSON.parse(await readFile("package.json"));
      if (pkg.name) projectName = pkg.name;
    } catch {}

    const dashboardData: DashboardData = {
      projectName,
      lastUpdated: new Date().toISOString(),
      commits: [],
    };

    logSuccess(`Found ${commits.length} commits in recent history.`);
    
    for (const commit of commits) {
      logSuccess(`Generating summary for commit: ${commit.hash.substring(0, 7)}...`);
      const features = await generateAIFeatures(commit);
      dashboardData.commits.push({
        ...commit,
        aiSummary: features,
      });
    }

    await writeJson(DASHBOARD_JSON_PATH, dashboardData);
    await generateDashboardHTML(dashboardData);
    logSuccess(`Dashboard generated at ${HTML_PATH}`);
  } catch (err) {
    console.error("Codegress: FATAL ERROR in autoInitialize:", err);
    process.exit(1);
  }
}

export async function updateAndRefresh(): Promise<void> {
  try {
    const dashboardExists = await fileExists(DASHBOARD_JSON_PATH);
    if (!dashboardExists) {
      logError("No dashboard found. Run 'codegress install' first.");
      return;
    }

    const content = await readFile(DASHBOARD_JSON_PATH);
    const dashboardData: DashboardData = JSON.parse(content);

    const latestCommit = await getLatestCommit();
    if (!latestCommit) return;

    // Check if commit already exists
    if (dashboardData.commits.some(c => c.hash === latestCommit.hash)) {
      return; // Already processed
    }
    
    logSuccess(`Generating summary for new commit: ${latestCommit.hash.substring(0, 7)}...`);
    const features = await generateAIFeatures(latestCommit);
    
    dashboardData.commits.unshift({
      ...latestCommit,
      aiSummary: features
    });

    dashboardData.lastUpdated = new Date().toISOString();
    
    await writeJson(DASHBOARD_JSON_PATH, dashboardData);
    await generateDashboardHTML(dashboardData);
    logSuccess("Dashboard updated with latest commit.");
  } catch (err) {
    logError("Failed to update dashboard.");
  }
}

async function generateDashboardHTML(data: DashboardData): Promise<void> {
  const totalCommits = data.commits.length;
  const activeDays = new Set(data.commits.map(c => c.date)).size;
  const lastCommitDate = data.commits.length > 0 ? new Date(data.commits[0].date).toLocaleDateString() : 'N/A';

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Codegress - ${data.projectName}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            /* Light Mode Variables */
            --bg-body: #f8fafc;
            --bg-surface: #ffffff;
            --text-primary: #0f172a;
            --text-secondary: #64748b;
            --border: #e2e8f0;
            --accent: #b45309; /* Brownish yellow / amber */
            --accent-bg: #fef3c7;
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
            --card-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .dark-mode {
            /* Dark Mode Variables */
            --bg-body: #0f172a;
            --bg-surface: #1e293b;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --border: #334155;
            --accent: #fbbf24;
            --accent-bg: #451a03;
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -2px rgba(0, 0, 0, 0.5);
            --card-shadow: 0 1px 3px rgba(0,0,0,0.5);
        }

        @media (prefers-color-scheme: dark) {
            :root:not(.light-mode) {
                --bg-body: #0f172a;
                --bg-surface: #1e293b;
                --text-primary: #f8fafc;
                --text-secondary: #94a3b8;
                --border: #334155;
                --accent: #fbbf24;
                --accent-bg: #451a03;
                --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -2px rgba(0, 0, 0, 0.5);
                --card-shadow: 0 1px 3px rgba(0,0,0,0.5);
            }
        }

        * { box-sizing: border-box; margin: 0; padding: 0; transition: background-color 0.2s, color 0.2s, border-color 0.2s; }
        body { font-family: 'Inter', sans-serif; background: var(--bg-body); color: var(--text-primary); padding: 2rem 1rem; line-height: 1.5; }
        .container { max-width: 1200px; margin: 0 auto; }
        
        /* Header & Brand */
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2.5rem; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { width: 40px; height: 40px; background: var(--accent-bg); color: var(--accent); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; }
        .brand-text h1 { font-size: 22px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.5px; }
        .brand-text p { font-size: 14px; color: var(--text-secondary); font-weight: 500; }
        
        .header-actions { display: flex; align-items: center; gap: 16px; }
        .last-updated { font-size: 13px; color: var(--text-secondary); }
        .theme-toggle { background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-primary); padding: 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .theme-toggle:hover { background: var(--border); }
        .theme-toggle svg { width: 18px; height: 18px; }

        /* Stat Cards */
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 3rem; }
        .stat-card { background: var(--bg-surface); border: 1px solid var(--border); padding: 1.5rem; border-radius: 12px; box-shadow: var(--card-shadow); display: flex; flex-direction: column; gap: 8px; }
        .stat-card .label { font-size: 13px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .stat-card .value { font-size: 32px; font-weight: 700; color: var(--text-primary); }
        
        /* Table */
        .table-container { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th { background: rgba(0,0,0,0.02); color: var(--text-secondary); font-weight: 600; font-size: 12px; text-transform: uppercase; padding: 16px 24px; border-bottom: 1px solid var(--border); letter-spacing: 0.5px; }
        .dark-mode th { background: rgba(255,255,255,0.02); }
        td { padding: 24px; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 14px; }
        tr:last-child td { border-bottom: none; }
        
        .col-date { width: 15%; white-space: nowrap; font-weight: 500; }
        .col-hash { width: 15%; }
        .hash-badge { background: var(--accent-bg); color: var(--accent); padding: 4px 8px; border-radius: 6px; font-family: monospace; font-size: 13px; font-weight: 600; display: inline-block; }
        .col-commits { width: 30%; color: var(--text-primary); font-weight: 500; }
        .col-summary { width: 40%; }
        
        .summary-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
        .summary-list li { position: relative; padding-left: 20px; color: var(--text-secondary); }
        .summary-list li::before { content: ""; position: absolute; left: 0; top: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); opacity: 0.8; }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <div class="header">
            <div class="brand">
                <div class="logo">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="16 18 22 12 16 6"></polyline>
                        <polyline points="8 6 2 12 8 18"></polyline>
                    </svg>
                </div>
                <div class="brand-text">
                    <h1>Codegress</h1>
                    <p>${data.projectName}</p>
                </div>
            </div>
            <div class="header-actions">
                <span class="last-updated">Updated: ${new Date(data.lastUpdated).toLocaleString()}</span>
                <button class="theme-toggle" id="themeToggle" aria-label="Toggle Dark Mode">
                    <svg id="moonIcon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                    <svg id="sunIcon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                </button>
            </div>
        </div>

        <!-- Stat Cards -->
        <div class="stats-grid">
            <div class="stat-card">
                <span class="label">Total Commits</span>
                <span class="value">${totalCommits}</span>
            </div>
            <div class="stat-card">
                <span class="label">Active Days</span>
                <span class="value">${activeDays}</span>
            </div>
            <div class="stat-card">
                <span class="label">Last Activity</span>
                <span class="value">${lastCommitDate}</span>
            </div>
        </div>
        
        <!-- Main Table -->
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th class="col-date">Date</th>
                        <th class="col-hash">Commit Hash</th>
                        <th class="col-commits">Commit Message</th>
                        <th class="col-summary">Breakdown AI Summary</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.commits.length === 0 ? '<tr><td colspan="4" style="text-align:center; padding:3rem; color: var(--text-secondary);">No activity found. Start coding!</td></tr>' : ''}
                    ${data.commits.map(c => `
                        <tr>
                            <td class="col-date">${new Date(c.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                            <td class="col-hash"><span class="hash-badge">${c.hash.substring(0, 7)}</span></td>
                            <td class="col-commits">${c.message}</td>
                            <td class="col-summary">
                                <ul class="summary-list">
                                    ${c.aiSummary && c.aiSummary.length > 0 ? c.aiSummary.map(s => `<li>${s}</li>`).join('') : '<li>No summary available.</li>'}
                                </ul>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        // Dark Mode Toggle Logic
        const toggleBtn = document.getElementById('themeToggle');
        const sunIcon = document.getElementById('sunIcon');
        const moonIcon = document.getElementById('moonIcon');
        
        function setTheme(isDark) {
            if (isDark) {
                document.body.classList.add('dark-mode');
                document.body.classList.remove('light-mode');
                sunIcon.style.display = 'block';
                moonIcon.style.display = 'none';
                localStorage.setItem('theme', 'dark');
            } else {
                document.body.classList.add('light-mode');
                document.body.classList.remove('dark-mode');
                sunIcon.style.display = 'none';
                moonIcon.style.display = 'block';
                localStorage.setItem('theme', 'light');
            }
        }

        // Initialize
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            setTheme(true);
        } else {
            setTheme(false);
        }

        toggleBtn.addEventListener('click', () => {
            const isDark = document.body.classList.contains('dark-mode');
            setTheme(!isDark);
        });
    </script>
</body>
</html>`;

  await writeHtml(HTML_PATH, html);
}
