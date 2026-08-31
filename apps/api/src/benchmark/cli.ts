import { formatBenchmarkReport, formatBenchmarkReportJson } from './format.js';
import { runBenchmark } from './run.js';

const report = runBenchmark();
const asJson = process.argv.includes('--json');

console.log(asJson ? formatBenchmarkReportJson(report) : formatBenchmarkReport(report));

if (report.overall.falseNotAffectedSafetyFailures > 0) {
  console.error(
    `\n${report.overall.falseNotAffectedSafetyFailures} false NOT_AFFECTED safety failure(s) -- this is never acceptable.`,
  );
  process.exit(1);
}
