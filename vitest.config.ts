import path from 'node:path';
import { angularJitApplicationTransform } from '@angular/compiler-cli';
import { playwright } from '@vitest/browser-playwright';
import ts from 'typescript';
import { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Compiles Angular components with `angularJitApplicationTransform` (supporting signal `input()`,
 * `output()`, `model()`, and decorator downleveling) and rewrites external `templateUrl` /
 * `styleUrl` metadata into Vite `?raw` / `?inline` imports for browser tests.
 */
function angularJitPlugin(): Plugin {
  let cachedProgram: ts.Program | null = null;
  let compilerOptions: ts.CompilerOptions = {};

  function getProgramForFile(filePath: string): ts.Program {
    if (!cachedProgram || !cachedProgram.getSourceFile(filePath)) {
      const configFile = ts.readConfigFile('tsconfig.spec.json', ts.sys.readFile);
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
      cachedProgram = ts.createProgram(rootNames, compilerOptions, undefined, cachedProgram ?? undefined);
    }
    return cachedProgram;
  }

  return {
    name: 'angular-jit-plugin',
    enforce: 'pre',
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
        launchOptions: {
          executablePath:
            process.env['CHROME_BIN'] ||
            '/home/korol/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
        },
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
