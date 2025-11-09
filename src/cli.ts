#!/usr/bin/env node

import { Command } from "commander";
import { autoInitialize, updateAndRefresh } from "./core";
import { installGitHooks } from "./gitHooks";

const program = new Command("codegress").version("1.0.0");

program
  .command("install")
  .description("One-time setup: auto-init + AI + Git hook + badge")
  .action(async () => {
    console.log("Codegress: Installing..."); // STEP 1

    console.log("Codegress: Running autoInitialize..."); // DEBUG
    await autoInitialize();
    console.log("Codegress: autoInitialize DONE"); // DEBUG

    console.log("Codegress: Installing Git hooks..."); // DEBUG
    await installGitHooks();
    console.log("Codegress: Git hooks DONE"); // DEBUG

    console.log("Codegress: Refreshing tasks & badge..."); // DEBUG
    await updateAndRefresh();
    console.log("Codegress: Refresh DONE"); // DEBUG

    console.log("Codegress: Ready! Just code and commit.");
  });

program.command("update-and-refresh").action(async () => {
  console.log("Codegress: Running update-and-refresh (hook)"); // DEBUG
  await updateAndRefresh();
  console.log("Codegress: Hook update DONE");
});

program.parse(process.argv);

// Default to install
if (process.argv.length === 2) {
  program.parse([process.argv[0], process.argv[1], "install"]);
}
