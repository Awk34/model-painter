import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkTsconfigDiagnostics,
  lintHtmlTemplate,
  lintTypeScriptSource,
  runLint,
} from './lint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('lintTypeScriptSource enforces AGENTS.md decorator and signal rules', () => {
  const badComponent = `
    import { Component, HostBinding, HostListener, signal } from '@angular/core';
    @Component({
      standalone: true,
      selector: 'app-bad',
      template: '<p>hi</p>',
      styles: ['p { color: red; }'],
    })
    export class BadComponent {
      @HostBinding('class.active') active = true;
      @HostListener('click') onClick() {}
      readonly items = signal<string[]>([]);
      add(v: string) {
        this.items.mutate((arr) => arr.push(v));
      }
    }
  `;

  const violations = lintTypeScriptSource('src/app/bad/bad.component.ts', badComponent);
  const rules = violations.map((v) => v.rule);
  assert.ok(rules.includes('no-standalone-true'));
  assert.ok(rules.includes('no-inline-template'));
  assert.ok(rules.includes('no-inline-styles'));
  assert.ok(rules.includes('no-host-decorator'));
  assert.equal(rules.filter((r) => r === 'no-host-decorator').length, 2);
  assert.ok(rules.includes('no-signal-mutate'));

  const goodComponent = `
    import { Component, signal } from '@angular/core';
    @Component({
      selector: 'app-good',
      templateUrl: './good.component.ng.html',
      styleUrl: './good.component.css',
      host: { '[class.active]': 'active' },
    })
    export class GoodComponent {
      active = true;
      readonly items = signal<string[]>([]);
      add(v: string) {
        this.items.update((arr) => [...arr, v]);
      }
    }
  `;
  assert.deepEqual(lintTypeScriptSource('src/app/good/good.component.ts', goodComponent), []);
});

test('lintTypeScriptSource enforces no-explicit-any with documented lint-ignore-any exemption', () => {
  const unannotatedAny = `
    export function parse(input: any): unknown {
      return input as any;
    }
  `;
  const v1 = lintTypeScriptSource('src/app/core/parse.ts', unannotatedAny);
  assert.equal(v1.filter((v) => v.rule === 'no-explicit-any').length, 2);

  const emptyReason = `
    // lint-ignore-any:
    export function parse(input: any): unknown { return input; }
  `;
  const v2 = lintTypeScriptSource('src/app/core/parse.ts', emptyReason);
  assert.equal(v2.filter((v) => v.rule === 'no-explicit-any').length, 1);

  const validExemption = `
    // lint-ignore-any: third-party SDK callback signature
    export function parse(input: any): unknown {
      return input as unknown;
    }
    export const x = (v: unknown) => v;
    export const y = 1 as any; // lint-ignore-any: interop cast
    /*
     * lint-ignore-any: justified
     */
    export const z: any = 1;
  `;
  assert.deepEqual(lintTypeScriptSource('src/app/core/parse.ts', validExemption), []);

  const emptyBlockReason = `
    /*
     * lint-ignore-any:
     */
    export const badMulti: any = 1;
    /* lint-ignore-any: */
    export const badInline: any = 2;
  `;
  const v3 = lintTypeScriptSource('src/app/core/parse.ts', emptyBlockReason);
  assert.equal(v3.filter((v) => v.rule === 'no-explicit-any').length, 2);
});

test('lintTypeScriptSource enforces no-ts-suppression, no-debugger, and scoped no-console-log', () => {
  const badCode = `
    // @ts-ignore
    const a = 1;
    /* @ts-nocheck */
    export function debugFn() {
      console.log('debug', a);
      console.warn('allowed warning');
      debugger;
    }
  `;
  const violations = lintTypeScriptSource('src/app/core/debug.ts', badCode);
  const rules = violations.map((v) => v.rule);
  assert.equal(rules.filter((r) => r === 'no-ts-suppression').length, 2);
  assert.equal(rules.filter((r) => r === 'no-console-log').length, 1);
  assert.equal(rules.filter((r) => r === 'no-debugger').length, 1);

  // String literals mentioning @ts-ignore must not trigger
  const stringMention = `export const doc = 'never use @ts-ignore or @ts-nocheck';`;
  assert.deepEqual(lintTypeScriptSource('src/app/core/doc.ts', stringMention), []);

  // console.log is allowed in *.spec.ts and functions/src/
  const specCode = `console.log('spec output');`;
  assert.deepEqual(lintTypeScriptSource('src/app/core/debug.spec.ts', specCode), []);
  assert.deepEqual(lintTypeScriptSource('functions/src/index.ts', specCode), []);
});

test('lintHtmlTemplate rejects legacy control flow and ngClass/ngStyle while allowing comments & modern syntax', () => {
  const badHtml = `
    <div *ngIf="ready" [ngClass]="{ active: isActive }" [ngStyle]="{ color: tint }">
      <ul [ngSwitch]="mode" *ngSwitch="mode">
        <li *ngSwitchCase="'a'" *ngFor="let item of items">{{ item }}</li>
        <li *ngSwitchDefault ngClass="fallback" ngStyle="color:red">None</li>
      </ul>
    </div>
  `;
  const violations = lintHtmlTemplate('src/app/bad/bad.component.ng.html', badHtml);
  const rules = violations.map((v) => v.rule);
  assert.equal(rules.filter((r) => r === 'no-legacy-control-flow').length, 6);
  assert.equal(rules.filter((r) => r === 'no-ngClass-ngStyle').length, 4);

  const goodHtml = `
    <!-- Legacy syntax in comment: <div *ngIf="false" [ngClass]="'old'"></div> -->
    @if (ready()) {
      <div [class.active]="isActive()" [style.color]="tint()" title="Example *ngIf text">
        @for (item of items(); track item.id) {
          <span>{{ item.name }}</span>
        }
      </div>
    }
  `;
  assert.deepEqual(lintHtmlTemplate('src/app/good/good.component.ng.html', goodHtml), []);
});

test('lintHtmlTemplate handles stray slashes and < inside Angular interpolations without hanging', () => {
  assert.deepEqual(
    lintHtmlTemplate('src/app/interp.component.ng.html', '<span>{{ a<b }}</span>'),
    []
  );

  const afterInterp = lintHtmlTemplate(
    'src/app/interp-bad.component.ng.html',
    '<span>{{ a<b }}</span><div *ngIf="x"></div>'
  );
  assert.equal(afterInterp.length, 1);
  assert.equal(afterInterp[0].rule, 'no-legacy-control-flow');

  assert.deepEqual(
    lintHtmlTemplate('src/app/stray-slash.component.ng.html', '<div / class="a"></div>'),
    []
  );

  const straySlashBad = lintHtmlTemplate(
    'src/app/stray-slash-bad.component.ng.html',
    '<div / *ngIf="x"></div>'
  );
  assert.equal(straySlashBad.length, 1);
  assert.equal(straySlashBad[0].rule, 'no-legacy-control-flow');
});

test('checkTsconfigDiagnostics flags unused imports, locals, and parameters', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-painter-lint-test-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'tsconfig.test.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ES2022',
        },
        include: ['src/**/*.ts'],
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'a.ts'),
      `export const usedValue = 1;\nexport const extraUnusedExport = 2;\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'b.ts'),
      `import { usedValue, extraUnusedExport } from './a';\nexport function fn(unusedParam: number): number {\n  const unusedLocal = 42;\n  return usedValue;\n}\n`
    );

    const diags = checkTsconfigDiagnostics('tsconfig.test.json', tmpDir);
    const messages = diags.map((d) => `${d.rule}:${d.message}`);
    assert.ok(messages.some((m) => m.includes('extraUnusedExport')));
    assert.ok(messages.some((m) => m.includes('unusedParam')));
    assert.ok(messages.some((m) => m.includes('unusedLocal')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('repository passes runLint() and CLI node scripts/lint.mjs exits 0', () => {
  const result = runLint({ repoRoot });
  assert.deepEqual(result.violations, []);
  assert.ok(result.filesChecked.ts >= 139);
  assert.ok(result.filesChecked.html >= 49);
  assert.equal(result.filesChecked.tsconfigs, 4);

  const output = execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'lint.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.match(output, /\[lint\] OK/);
});
