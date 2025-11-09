export interface Config {
  projectVision: string;
  ignoredFolders: string[];
  autoAI: boolean;
}

export interface Task {
  task: string;
  done: boolean;
}

export interface ModuleTasks {
  tasks: Task[];
  progress: number;
}

export interface TasksData {
  modules: Record<string, ModuleTasks>;
  overallProgress: number;
}
