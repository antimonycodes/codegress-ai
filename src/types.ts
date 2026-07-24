export interface Config {
  ignoredFolders: string[];
  autoAI: boolean;
}

export interface CommitActivity {
  hash: string;
  message: string;
  date: string;
  aiSummary?: string[];
}

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  commitCount: number;
  commits: CommitActivity[];
  features: string[]; // AI generated features from commits
}

export interface DashboardData {
  projectName: string;
  lastUpdated: string;
  commits: CommitActivity[];
}
