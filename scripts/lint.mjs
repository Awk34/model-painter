import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DEFAULT_TSCONFIGS = [
  'tsconfig.app.json',
  'tsconfig.spec.json',
  'tsconfig.browser.spec.ts',
  'functions/tsconfig.json',
];

const LEGACY_CONTROL_FLOW_ATTRS = new Set([
  '*ngIf',
  '*ngFor',
  '*ngSwitch',
  '*ngSwitchCase',
  '*ngSwitchDefault',
  '[ngSwitch]',
]);

const FORBIDDEN_STYLE_CLASS_ATTRS = new Set([
  'ngClass',
  '[ngClass]',
  'ngStyle',
  '[ngStyle]',
]);

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function getLineAndCol(text, offset) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

function getPropertyNameText(nameNode) {
  if (!nameNode) {
    return null;
  }
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  return null;
}

function isNonSpecSrcAppFile(filePath) {
  const norm = normalizePath(filePath);
  const inSrcApp =
    norm === 'src/app' ||
    norm.startsWith('src/app/') ||
    norm.includes('/src/app/');
  if (!inSrcApp) {
    return false;
  }
  return !norm.endsWith('.spec.ts') && !norm.endsWith('.browser.spec.ts');
}

function scanComments(sourceText) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    sourceText
  );
  const tsSuppressions = [];
  const ignoredAnyLines = new Set();

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const text = scanner.getTokenText();
      const start = scanner.getTokenPos();
      const { line, column } = getLineAndCol(sourceText, start);

      if (/@ts-ignore\b|@ts-nocheck\b/.test(text)) {
        tsSuppressions.push({
          line,
          column,
          rule: 'no-ts-suppression',
          message: "TypeScript suppression comment ('@ts-ignore' / '@ts-nocheck') is prohibited.",
        });
      }

      if (/lint-ignore-any:\s*\S+/.test(text)) {
        ignoredAnyLines.add(line);
      }
    }
    token = scanner.scan();
  }

  return { tsSuppressions, ignoredAnyLines };
}

/**
 * Lint a TypeScript source file against project AST and style invariants.
 * @param {string} filePath
 * @param {string} sourceText
 * @returns {Array<{file: string, line: number, column: number, rule: string, message: string}>}
 */
export function lintTypeScriptSource(filePath, sourceText) {
  const violations = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const { tsSuppressions, ignoredAnyLines } = scanComments(sourceText);
  for (const item of tsSuppressions) {
    violations.push({ file: filePath, ...item });
  }

  const checkNonSpecApp = isNonSpecSrcAppFile(filePath);

  function addViolation(node, rule, message) {
    const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({
      file: filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      rule,
      message,
    });
  }

  function visit(node) {
    if (ts.isDecorator(node)) {
      let decoratorName = null;
      let firstArg = null;
      if (ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        decoratorName = node.expression.expression.text;
        firstArg = node.expression.arguments[0] ?? null;
      } else if (ts.isIdentifier(node.expression)) {
        decoratorName = node.expression.text;
      }

      if (decoratorName === 'HostBinding' || decoratorName === 'HostListener') {
        addViolation(
          node,
          'no-host-decorator',
          `@${decoratorName} decorator is prohibited by AGENTS.md; use the host metadata object instead.`
        );
      }

      if (
        (decoratorName === 'Component' ||
          decoratorName === 'Directive' ||
          decoratorName === 'Pipe') &&
        firstArg &&
        ts.isObjectLiteralExpression(firstArg)
      ) {
        for (const prop of firstArg.properties) {
          if (
            !ts.isPropertyAssignment(prop) &&
            !ts.isShorthandPropertyAssignment(prop) &&
            !ts.isMethodDeclaration(prop)
          ) {
            continue;
          }
          const propName = getPropertyNameText(prop.name);
          if (decoratorName === 'Component' && propName === 'template') {
            addViolation(
              prop,
              'no-inline-template',
              'Inline template is prohibited by AGENTS.md; use templateUrl with a separate .ng.html file.'
            );
          }
          if (decoratorName === 'Component' && propName === 'styles') {
            addViolation(
              prop,
              'no-inline-styles',
              'Inline styles are prohibited by AGENTS.md; use styleUrl with a separate .css/.scss file.'
            );
          }
          if (
            propName === 'standalone' &&
            ts.isPropertyAssignment(prop) &&
            prop.initializer.kind === ts.SyntaxKind.TrueKeyword
          ) {
            addViolation(
              prop,
              'no-standalone-true',
              'Explicit standalone: true is prohibited (default in Angular v20+).'
            );
          }
        }
      }
    }

    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const line = pos.line + 1;
      if (!ignoredAnyLines.has(line) && !ignoredAnyLines.has(line - 1)) {
        violations.push({
          file: filePath,
          line,
          column: pos.character + 1,
          rule: 'no-explicit-any',
          message:
            "Explicit 'any' type is prohibited; use 'unknown' or a specific type (or document with '// lint-ignore-any: <reason>').",
        });
      }
    }

    if (ts.isDebuggerStatement(node)) {
      addViolation(node, 'no-debugger', "'debugger' statement is prohibited.");
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'mutate'
    ) {
      addViolation(
        node.expression.name,
        'no-signal-mutate',
        "Signal '.mutate(' is prohibited; use '.update(' or '.set('."
      );
    }

    if (
      checkNonSpecApp &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console' &&
      node.expression.name.text === 'log'
    ) {
      addViolation(
        node.expression,
        'no-console-log',
        "'console.log' is prohibited in non-spec src/app/ files."
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function stripHtmlCommentsPreservingLines(htmlText) {
  return htmlText.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * Lint an Angular HTML template against AGENTS.md template invariants.
 * @param {string} filePath
 * @param {string} htmlText
 * @returns {Array<{file: string, line: number, column: number, rule: string, message: string}>}
 */
export function lintHtmlTemplate(filePath, htmlText) {
  const violations = [];
  const cleaned = stripHtmlCommentsPreservingLines(htmlText);
  const len = cleaned.length;
  let i = 0;

  while (i < len) {
    if (cleaned[i] !== '<') {
      i++;
      continue;
    }
    const next = cleaned[i + 1];
    if (!next || !/[A-Za-z]/.test(next)) {
      i++;
      continue;
    }

    // Advance past tag name
    i += 2;
    while (i < len && /[A-Za-z0-9:_-]/.test(cleaned[i])) {
      i++;
    }

    // Scan attributes until unquoted '>'
    while (i < len) {
      while (i < len && /\s/.test(cleaned[i])) {
        i++;
      }
      if (i >= len) {
        break;
      }
      if (cleaned[i] === '>') {
        i++;
        break;
      }
      if (cleaned[i] === '/' && cleaned[i + 1] === '>') {
        i += 2;
        break;
      }

      // Read attribute name
      const attrStart = i;
      while (i < len && !/[\s=/>]/.test(cleaned[i])) {
        i++;
      }
      const attrName = cleaned.slice(attrStart, i);

      if (LEGACY_CONTROL_FLOW_ATTRS.has(attrName)) {
        const { line, column } = getLineAndCol(htmlText, attrStart);
        violations.push({
          file: filePath,
          line,
          column,
          rule: 'no-legacy-control-flow',
          message: `Legacy directive '${attrName}' is prohibited; use Angular @if/@for/@switch control flow.`,
        });
      } else if (FORBIDDEN_STYLE_CLASS_ATTRS.has(attrName)) {
        const { line, column } = getLineAndCol(htmlText, attrStart);
        violations.push({
          file: filePath,
          line,
          column,
          rule: 'no-ngClass-ngStyle',
          message: `'${attrName}' is prohibited; use [class.foo] or [style.prop] bindings instead.`,
        });
      }

      // Skip optional '=value'
      while (i < len && /\s/.test(cleaned[i])) {
        i++;
      }
      if (cleaned[i] === '=') {
        i++;
        while (i < len && /\s/.test(cleaned[i])) {
          i++;
        }
        const quote = cleaned[i];
        if (quote === '"' || quote === "'") {
          i++;
          while (i < len && cleaned[i] !== quote) {
            i++;
          }
          if (cleaned[i] === quote) {
            i++;
          }
        } else {
          while (i < len && !/[\s>]/.test(cleaned[i])) {
            i++;
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Run TypeScript semantic/unused diagnostics for a tsconfig with noUnusedLocals and noUnusedParameters enabled.
 * @param {string} tsconfigPath
 * @param {string} repoRoot
 * @returns {Array<{file: string, line: number, column: number, rule: string, message: string}>}
 */
export function checkTsconfigDiagnostics(tsconfigPath, repoRoot) {
  const absConfigPath = path.resolve(repoRoot, tsconfigPath);
  const configResult = ts.readConfigFile(absConfigPath, ts.sys.readFile);
  if (configResult.error) {
    const msg = ts.flattenDiagnosticMessageText(configResult.error.messageText, '\n');
    return [
      {
        file: tsconfigPath,
        line: 1,
        column: 1,
        rule: 'tsc-config',
        message: `Failed to read ${tsconfigPath}: ${msg}`,
      },
    ];
  }

  const parsed = ts.parseJsonConfigFileContent(
    configResult.config,
    ts.sys,
    path.dirname(absConfigPath)
  );
  if (parsed.errors.length > 0) {
    return parsed.errors.map((diag) => ({
      file: tsconfigPath,
      line: 1,
      column: 1,
      rule: 'tsc-config',
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
    }));
  }

  const options = {
    ...parsed.options,
    noEmit: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
  };

  const program = ts.createProgram(parsed.fileNames, options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const violations = [];

  for (const diag of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diag.messageText, ' ');
    const code = `TS${diag.code}`;
    if (diag.file && typeof diag.start === 'number') {
      const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
      const relFile = normalizePath(path.relative(repoRoot, diag.file.fileName));
      violations.push({
        file: relFile,
        line: pos.line + 1,
        column: pos.character + 1,
        rule: `tsc(${code})`,
        message,
      });
    } else {
      violations.push({
        file: tsconfigPath,
        line: 1,
        column: 1,
        rule: `tsc(${code})`,
        message,
      });
    }
  }

  return violations;
}

function collectFilesRecursive(dirPath, extensions, out = []) {
  if (!fs.existsSync(dirPath)) {
    return out;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib') {
        continue;
      }
      collectFilesRecursive(full, extensions, out);
    } else if (entry.isFile()) {
      if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Run all repository lint checks across src/ and functions/src/.
 */
export function runLint({
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  tsconfigs = DEFAULT_TSCONFIGS,
  includeTsconfigDiagnostics = true,
} = {}) {
  const violations = [];
  const targetDirs = [path.join(repoRoot, 'src'), path.join(repoRoot, 'functions', 'src')];

  const tsFiles = targetDirs.flatMap((dir) => collectFilesRecursive(dir, ['.ts'])).sort();
  const htmlFiles = targetDirs.flatMap((dir) => collectFilesRecursive(dir, ['.html'])).sort();

  for (const absFile of tsFiles) {
    const relFile = normalizePath(path.relative(repoRoot, absFile));
    const sourceText = fs.readFileSync(absFile, 'utf8');
    violations.push(...lintTypeScriptSource(relFile, sourceText));
  }

  for (const absFile of htmlFiles) {
    const relFile = normalizePath(path.relative(repoRoot, absFile));
    const htmlText = fs.readFileSync(absFile, 'utf8');
    violations.push(...lintHtmlTemplate(relFile, htmlText));
  }

  if (includeTsconfigDiagnostics) {
    for (const tsconfig of tsconfigs) {
      violations.push(...checkTsconfigDiagnostics(tsconfig, repoRoot));
    }
  }

  return {
    violations,
    filesChecked: {
      ts: tsFiles.length,
      html: htmlFiles.length,
      tsconfigs: includeTsconfigDiagnostics ? tsconfigs.length : 0,
    },
  };
}

function main() {
  const result = runLint();
  if (result.violations.length === 0) {
    console.log(
      `[lint] OK (${result.filesChecked.ts} TS files, ${result.filesChecked.html} HTML templates, ${result.filesChecked.tsconfigs} tsconfigs)`
    );
    process.exitCode = 0;
    return;
  }

  for (const v of result.violations) {
    console.error(`${v.file}:${v.line}:${v.column} [${v.rule}] ${v.message}`);
  }
  console.error(`[lint] Found ${result.violations.length} violation(s).`);
  process.exitCode = 1;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
