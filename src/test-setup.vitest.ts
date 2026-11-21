import 'zone.js';
import 'zone.js/testing';
import '@angular/compiler';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import './styles.css';

try {
  getTestBed().initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting()
  );
} catch {
  // Environment already initialized across browser test runs.
}
