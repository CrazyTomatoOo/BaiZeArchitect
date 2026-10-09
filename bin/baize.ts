#!/usr/bin/env node
import { run } from "../src/cli.ts";

const { exitCode, stdout } = await run(process.argv.slice(2));
process.stdout.write(stdout);
process.exitCode = exitCode;
