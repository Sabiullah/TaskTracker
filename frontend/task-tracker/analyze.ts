/**
 * ------------------------------------------------------------
 * 🧠 TS + ESLint Analyzer CLI
 * ------------------------------------------------------------
 *
 * Analyze TypeScript files using:
 *  - TypeScript Compiler API (tsc diagnostics)
 *  - ESLint (with optional auto-fix)
 *
 * ------------------------------------------------------------
 * 📦 Usage
 * ------------------------------------------------------------
 *
 * Run on single file:
 *   npx ts-node analyze.ts src/file.ts
 *
 * Run on multiple files:
 *   npx ts-node analyze.ts src/a.ts src/b.ts
 *
 * Enable ESLint auto-fix:
 *   npx ts-node analyze.ts src/file.ts --fix
 *
 * Show table output:
 *   npx ts-node analyze.ts src/file.ts --format table
 *
 * Combine flags:
 *   npx ts-node analyze.ts src/file.ts --fix --format table
 *
 * ------------------------------------------------------------
 * ⚙️ Requirements
 * ------------------------------------------------------------
 *
 * npm install typescript eslint
 * npm install -D ts-node @types/node
 *
 * For TypeScript ESLint:
 * npm install -D @typescript-eslint/parser @typescript-eslint/eslint-plugin
 *
 * ------------------------------------------------------------
 * 📄 Output
 * ------------------------------------------------------------
 *
 * Generates:
 *   analysis-report.json
 *
 * ------------------------------------------------------------
 */

import ts from "typescript";
import { ESLint } from "eslint";
import * as path from "path";
import * as fs from "fs";

// ----------------------------
// TYPES
// ----------------------------
type Issue = {
  source: "tsc" | "eslint";
  file: string;
  line: number;
  column: number;
  message: string;
  code?: number;
  ruleId?: string | null;
  severity: "error" | "warning";
};

type Report = {
  summary: {
    totalFiles: number;
    totalIssues: number;
    tscIssues: number;
    eslintIssues: number;
  };
  files: Record<string, Issue[]>;
};

// ----------------------------
// UTIL
// ----------------------------
function isTsFile(file: string): boolean {
  return file.endsWith(".ts") || file.endsWith(".tsx");
}

// ----------------------------
// LOAD FULL PROGRAM
// ----------------------------
function createFullProgram(): ts.Program {
  // tsconfig.json may only contain project references (no fileNames of its own).
  // Walk the references until we find one that actually includes source files.
  const candidates = [
    "tsconfig.app.json",
    "tsconfig.json",
    "tsconfig.src.json",
  ];

  for (const candidate of candidates) {
    const configPath = ts.findConfigFile(
      process.cwd(),
      ts.sys.fileExists,
      candidate
    );
    if (!configPath) continue;

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) continue;

    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    );

    if (parsed.fileNames.length > 0) {
      return ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
      });
    }
  }

  throw new Error(
    "❌ Could not find a tsconfig with source files. Tried: " +
      candidates.join(", ")
  );
}

// ----------------------------
// TSC
// ----------------------------
function runTscAnalysis(targetFiles: string[]): Issue[] {
  const program = createFullProgram();
  const diagnostics = ts.getPreEmitDiagnostics(program);

  const normalizedTargets = targetFiles.map((f) => path.resolve(f));

  return diagnostics
    .filter((diag) => {
      if (!diag.file || diag.start === undefined) return false;
      return normalizedTargets.includes(path.resolve(diag.file.fileName));
    })
    .map((diag) => {
      const file = diag.file!;
      const { line, character } =
        file.getLineAndCharacterOfPosition(diag.start!);

      return {
        source: "tsc" as const,
        file: path.resolve(file.fileName),
        line: line + 1,
        column: character + 1,
        message: ts.flattenDiagnosticMessageText(
          diag.messageText,
          "\n"
        ),
        code: diag.code,
        severity:
          diag.category === ts.DiagnosticCategory.Error
            ? "error"
            : "warning",
      };
    });
}

// ----------------------------
// ESLINT
// ----------------------------
async function runEslintAnalysis(
  files: string[],
  fix: boolean
): Promise<Issue[]> {
  const eslint = new ESLint({
    fix,
    errorOnUnmatchedPattern: false,
  });

  const results = await eslint.lintFiles(files);

  if (fix) {
    await ESLint.outputFixes(results);
  }

  const issues: Issue[] = [];

  for (const result of results) {
    for (const msg of result.messages) {
      issues.push({
        source: "eslint",
        file: path.resolve(result.filePath),
        line: msg.line,
        column: msg.column,
        message: msg.message,
        ruleId: msg.ruleId,
        severity: msg.severity === 2 ? "error" : "warning",
      });
    }
  }

  return issues;
}

// ----------------------------
// TABLE FORMATTER
// ----------------------------
function printTable(report: Report) {
  console.log("\n📊 Issue Table\n");

  for (const [file, issues] of Object.entries(report.files)) {
    console.log(`\n📁 ${file}`);
    console.log("--------------------------------------------------");

    issues.forEach((i) => {
      console.log(
        `${i.severity.toUpperCase()} | ${i.source} | ${i.line}:${i.column} | ${i.message}`
      );
    });
  }
}

// ----------------------------
// MAIN
// ----------------------------
async function runAnalysis(
  files: string[],
  fix: boolean
): Promise<Report> {
  const tscIssues = runTscAnalysis(files);
  const eslintIssues = await runEslintAnalysis(files, fix);

  const allIssues = [...tscIssues, ...eslintIssues];

  const grouped: Record<string, Issue[]> = {};

  for (const issue of allIssues) {
    if (!grouped[issue.file]) grouped[issue.file] = [];
    grouped[issue.file].push(issue);
  }

  return {
    summary: {
      totalFiles: Object.keys(grouped).length,
      totalIssues: allIssues.length,
      tscIssues: tscIssues.length,
      eslintIssues: eslintIssues.length,
    },
    files: grouped,
  };
}

// ----------------------------
// CLI ENTRY
// ----------------------------
async function main() {
  const args = process.argv.slice(2);

  const fix = args.includes("--fix");
  const formatTable = args.includes("--format=table");

  const fileArgs = args.filter(
    (a) => !a.startsWith("--")
  );

  if (fileArgs.length === 0) {
    console.error("❌ Provide TS files");
    process.exit(1);
  }

  const files = fileArgs.map((f) => path.resolve(f));

  const invalid = files.filter((f) => !isTsFile(f));
  if (invalid.length > 0) {
    console.error("❌ Only .ts/.tsx allowed:");
    invalid.forEach(console.error);
    process.exit(1);
  }

  console.log("🔍 Running analysis...");
  if (fix) console.log("🛠 ESLint auto-fix enabled");

  const report = await runAnalysis(files, fix);

  fs.writeFileSync(
    "analysis-report.json",
    JSON.stringify(report, null, 2)
  );

  if (formatTable) {
    printTable(report);
  }

  console.log("\n✅ Done");
  console.log(`Issues: ${report.summary.totalIssues}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
