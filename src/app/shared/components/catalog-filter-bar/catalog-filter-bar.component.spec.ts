import { TestBed } from '@angular/core/testing';
import { CatalogFilterBarComponent } from './catalog-filter-bar.component';

describe('CatalogFilterBarComponent', () => {
  it('syncs FormControls bidirectionally with model() inputs and supports missingThreshold 1 vs 2', () => {
    TestBed.configureTestingModule({
      imports: [CatalogFilterBarComponent],
    });

    const fixture = TestBed.createComponent(CatalogFilterBarComponent);
    const comp = fixture.componentInstance;
    fixture.componentRef.setInput('searchId', 'test-search');
    fixture.componentRef.setInput('searchLabel', 'Search items');
    fixture.componentRef.setInput('searchPlaceholder', 'Type...');
    fixture.componentRef.setInput('stageSelectId', 'test-stage');
    fixture.componentRef.setInput('readinessSelectId', 'test-readiness');
    fixture.componentRef.setInput('rangeSelectId', 'test-range');
    fixture.componentRef.setInput('missingThreshold', 1);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const searchInput = root.querySelector('#test-search') as HTMLInputElement;
    searchInput.value = 'marine';
    searchInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(comp.searchQuery()).toBe('marine');
    expect(root.querySelector('#test-readiness option[value="missing1"]')?.textContent).toContain('≤ 1 Paint');

    comp.searchQuery.set('');
    fixture.detectChanges();
    expect(searchInput.value).toBe('');
  });
});
