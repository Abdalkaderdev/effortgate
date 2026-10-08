import * as core from "@actions/core";
import { run } from "./main.js";
import { PolicyError } from "./policy.js";

run().catch((e: unknown) => {
  core.setFailed(e instanceof PolicyError ? e.message : `effortgate failed: ${(e as Error).stack ?? String(e)}`);
});
