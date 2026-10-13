#!/usr/bin/env node
import { runCli } from "../dist/cli.js";

const res = runCli(process.argv.slice(2));
for (const line of res.lines) console.log(line);
process.exit(res.code);
