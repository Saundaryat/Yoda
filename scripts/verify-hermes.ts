import { runHermes } from '../packages/hermes/runner.ts';
const report = await runHermes();
if (!report.verification.passed) process.exitCode = 1;
