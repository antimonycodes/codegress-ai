#!/usr/bin/env node

import { Command } from "commander";
import { autoInitialize, updateAndRefresh } from "./core";
import { installGitHooks } from "./gitHooks";

const program = new Command("codegress").version("1.0.0");

program
  .command("install")
  .description("One-time setup: auto-init + AI + Git hook + badge")
  .action(async () => {
    console.log("Codegress: Installing..."); 

    await autoInitialize();

    console.log("Codegress: Installing Git hooks..."); 
    await installGitHooks();

    console.log("Codegress: Ready! Just code and commit. Open codegress-dashboard.html to view your dashboard.");
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
