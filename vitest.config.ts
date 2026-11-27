import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { angularJitApplicationTransform } from '@angular/compiler-cli';
import { playwright } from '@vitest/browser-playwright';
import { chromium } from 'playwright';
import ts from 'typescript';
import { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const CHROMIUM_PATH_BINARIES = [
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
];

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findExecutableOnPath(names: readonly string[]): string | undefined {
  const pathEnv = process.env['PATH'] ?? '';
  if (!pathEnv) {
    return undefined;
  }
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function parsePlaywrightRevision(dirName: string): number {
  const match = dirName.match(/-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function findPlaywrightCachedBrowser(): string | undefined {
  const cacheDirs = Array.from(
    new Set(
      [
        process.env['XDG_CACHE_HOME']
          ? path.join(process.env['XDG_CACHE_HOME'], 'ms-playwright')
          : null,
        path.join(os.homedir(), '.cache', 'ms-playwright'),
      ].filter((dir): dir is string => Boolean(dir))
    )
  );

  for (const cacheRoot of cacheDirs) {
    if (!fs.existsSync(cacheRoot)) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    const browserDirs = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name.startsWith('chromium-') ||
            entry.name.startsWith('chromium_headless_shell-'))
      )
      .sort((a, b) => {
        const aIsFull = a.name.startsWith('chromium-') ? 0 : 1;
        const bIsFull = b.name.startsWith('chromium-') ? 0 : 1;
        if (aIsFull !== bIsFull) {
          return aIsFull - bIsFull;
        }
        return parsePlaywrightRevision(b.name) - parsePlaywrightRevision(a.name);
      });

    for (const dir of browserDirs) {
      const dirPath = path.join(cacheRoot, dir.name);
      let subEntries: fs.Dirent[];
      try {
        subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of subEntries) {
        if (!sub.isDirectory()) {
          continue;
        }
        if (sub.name.startsWith('chrome-linux')) {
          const candidate = path.join(dirPath, sub.name, 'chrome');
          if (isExecutableFile(candidate)) {
            return candidate;
          }
        }
        if (sub.name.startsWith('chrome-headless-shell-linux')) {
          const candidate = path.join(dirPath, sub.name, 'chrome-headless-shell');
          if (isExecutableFile(candidate)) {
            return candidate;
          }
        }
      }
    }
  }
  return undefined;
}

export function resolveChromiumExecutablePath(): string | undefined {
  const chromeBin = process.env['CHROME_BIN']?.trim();
  if (chromeBin && isExecutableFile(chromeBin)) {
    return chromeBin;
  }

  try {
    const pwPath = chromium.executablePath();
    if (pwPath && isExecutableFile(pwPath)) {
      return pwPath;
    }
  } catch {
    // Ignore if Playwright fails to compute a path; fall back to PATH and cache scan.
  }

  const onPath = findExecutableOnPath(CHROMIUM_PATH_BINARIES);
  if (onPath) {
    return onPath;
  }

  return findPlaywrightCachedBrowser();
}

/**
 * Compiles Angular components with `angularJitApplicationTransform` (supporting signal `input()`,
 * `output()`, `model()`, and decorator downleveling) and rewrites external `templateUrl` /
 * `styleUrl` metadata into Vite `?raw` / `?inline` imports for browser tests.
 */
function angularJitPlugin(): Plugin {
  let cachedProgram: ts.Program | null = null;
  let cacheDirty = true;
  let compilerOptions: ts.CompilerOptions = {};

  function getProgramForFile(filePath: string): ts.Program {
    if (cacheDirty || !cachedProgram || !cachedProgram.getSourceFile(filePath)) {
      const configFile = ts.readConfigFile('tsconfig.browser.spec.ts', ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
      compilerOptions = {
        ...parsed.options,
        sourceMap: false,
        inlineSourceMap: false,
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        useDefineForClassFields: false,
      };
      const rootNames = parsed.fileNames.includes(filePath)
        ? parsed.fileNames
        : [...parsed.fileNames, filePath];
      cachedProgram = ts.createProgram(
        rootNames,
        compilerOptions,
        undefined,
        cachedProgram ?? undefined
      );
      cacheDirty = false;
    }
    return cachedProgram;
  }

  return {
    name: 'angular-jit-plugin',
    enforce: 'pre',
    watchChange(id) {
      const cleanId = id.split('?')[0];
      if (
        cleanId.endsWith('.ts') ||
        cleanId.endsWith('.json') ||
        cleanId.endsWith('.ng.html') ||
        cleanId.endsWith('.css')
      ) {
        cacheDirty = true;
      }
    },
    transform(code, id) {
      const cleanId = id.split('?')[0];
      if (cleanId.includes('/node_modules/') || !cleanId.endsWith('.ts')) {
        return null;
      }
      if (!/@(Component|Directive|Injectable|Pipe|NgModule)\s*\(/.test(code)) {
        return null;
      }

      const absPath = path.resolve(cleanId);
      const program = getProgramForFile(absPath);
      const sourceFile = program.getSourceFile(absPath);
      if (!sourceFile) {
        return null;
      }

      let emittedCode = '';
      program.emit(
        sourceFile,
        (fileName, text) => {
          if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) {
            emittedCode = text;
          }
        },
        undefined,
        false,
        { before: [angularJitApplicationTransform(program)] }
      );

      if (!emittedCode) {
        return null;
      }

      const imports: string[] = [];
      let transformed = emittedCode.replace(
        /templateUrl\s*:\s*(['"])([^'"]+)\1/g,
        (_match, _quote, relPath: string) => {
          const varName = `__ng_tpl_${imports.length}`;
          imports.push(`import ${varName} from ${JSON.stringify(`${relPath}?raw`)};`);
          return `template: ${varName}`;
        }
      );

      transformed = transformed.replace(
        /styleUrl\s*:\s*(['"])([^'"]+)\1/g,
        (_match, _quote, relPath: string) => {
          const varName = `__ng_style_${imports.length}`;
          imports.push(`import ${varName} from ${JSON.stringify(`${relPath}?inline`)};`);
          return `styles: [${varName}]`;
        }
      );

      const finalCode = imports.length > 0 ? `${imports.join('\n')}\n${transformed}` : transformed;
      return { code: finalCode, map: null };
    },
  };
}

function isDirectoryWritable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function buildChromiumLaunchOptions(): {
  executablePath?: string;
  args?: string[];
  env?: Record<string, string>;
} {
  const resolvedChromiumPath = resolveChromiumExecutablePath();
  const options: {
    executablePath?: string;
    args?: string[];
    env?: Record<string, string>;
  } = {
    ...(process.platform === 'linux' ? { args: ['--no-sandbox'] } : {}),
    ...(resolvedChromiumPath ? { executablePath: resolvedChromiumPath } : {}),
  };

  if (process.platform === 'linux') {
    const configDir = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
    const cacheDir = process.env['XDG_CACHE_HOME'] || path.join(os.homedir(), '.cache');
    if (!isDirectoryWritable(configDir) || !isDirectoryWritable(cacheDir)) {
      const cleanEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === 'string') {
          cleanEnv[k] = v;
        }
      }
      cleanEnv['XDG_CONFIG_HOME'] = isDirectoryWritable(configDir)
        ? configDir
        : path.join(os.tmpdir(), 'chrome-cfg');
      cleanEnv['XDG_CACHE_HOME'] = isDirectoryWritable(cacheDir)
        ? cacheDir
        : path.join(os.tmpdir(), 'chrome-cache');
      options.env = cleanEnv;
    }
  }

  return options;
}

const launchOptions = buildChromiumLaunchOptions();

export default defineConfig({
  plugins: [angularJitPlugin()],
  optimizeDeps: {
    include: ['tslib'],
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    include: ['src/**/*.browser.spec.ts'],
    setupFiles: ['src/test-setup.vitest.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions,
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
